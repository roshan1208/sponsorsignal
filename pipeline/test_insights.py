"""Tests for the insights page generator.

Run from the repo root:
    python -m unittest discover -s pipeline -v
"""

import re
import unittest

import insights


def row(name, town="London", county="", industry="Tech & Software",
        routes=("Skilled Worker",), rating="A"):
    return [name, town, county, industry, list(routes), rating]


class SummariseTests(unittest.TestCase):

    def setUp(self):
        self.rows = (
            [row(f"T{i}", town="London", industry="Tech & Software")
             for i in range(5)]
            + [row(f"C{i}", town="Leeds", industry="Healthcare & Care",
                   routes=("Skilled Worker", "Charity Worker")) for i in range(3)]
            + [row("Unknown Ltd", town="Hull", industry="Other", rating="B")]
        )

    def test_counts_the_register(self):
        self.assertEqual(insights.summarise(self.rows)["total"], 9)

    def test_counts_distinct_towns(self):
        self.assertEqual(insights.summarise(self.rows)["towns"], 3)

    def test_counts_b_rated(self):
        self.assertEqual(insights.summarise(self.rows)["b_rated"], 1)

    def test_cities_ranked_by_count(self):
        self.assertEqual(insights.summarise(self.rows)["cities"][0],
                         ("London", 5))

    def test_routes_counted_per_employer_not_per_row(self):
        routes = dict(insights.summarise(self.rows)["routes"])
        self.assertEqual(routes["Skilled Worker"], 9)
        self.assertEqual(routes["Charity Worker"], 3)

    def test_industry_chart_excludes_unclassified(self):
        stats = insights.summarise(self.rows)
        self.assertNotIn("Other", dict(stats["industries"]))

    def test_reports_classified_and_unclassified_totals(self):
        stats = insights.summarise(self.rows)
        self.assertEqual(stats["classified"], 8)
        self.assertEqual(stats["unclassified"], 1)
        self.assertEqual(stats["classified"] + stats["unclassified"],
                         stats["total"])

    def test_added_and_removed_are_passed_through(self):
        stats = insights.summarise(self.rows, added=[row("A")],
                                   removed=[row("B"), row("C")])
        self.assertEqual((stats["added"], stats["removed"]), (1, 2))

    def test_empty_register_does_not_crash(self):
        stats = insights.summarise([])
        self.assertEqual(stats["total"], 0)
        self.assertEqual(stats["cities"], [])


class BarPathTests(unittest.TestCase):

    def test_data_end_is_rounded_and_baseline_is_square(self):
        # Two quadratic curves at the data end, none at the baseline.
        d = insights._bar_path(10, 0, 200, 20)
        self.assertEqual(d.count("Q"), 2)
        self.assertTrue(d.startswith("M10,0"))

    def test_a_bar_narrower_than_the_radius_stays_square(self):
        # Rounding a 2px bar by 4px would invert it.
        self.assertNotIn("Q", insights._bar_path(10, 0, 2, 20))

    def test_widths_scale_against_the_largest_value(self):
        svg = insights.bar_chart([("Big", 100), ("Small", 50)], "c", "Chart")
        # The H coordinate stops a radius short of the data end, so add it back.
        ends = [float(m) + 4 for m in re.findall(r"H(\d+\.\d)", svg)]
        big, small = ends[0] - 232, ends[1] - 232
        self.assertAlmostEqual(big, 2 * small, delta=0.5)
        self.assertAlmostEqual(big, 400, delta=0.5)   # longest bar fills the plot


class ShortenTests(unittest.TestCase):

    def test_leaves_a_label_that_fits(self):
        self.assertEqual(insights.shorten("London"), "London")

    def test_shortens_a_long_label(self):
        got = insights.shorten("Newcastle upon Tyne and Surrounding Districts")
        self.assertLessEqual(len(got), insights.LABEL_CHARS)
        self.assertTrue(got.endswith("…"))

    def test_abbreviation_can_remove_the_need_to_truncate(self):
        # "GBM: Senior or Specialist Worker" fits, so nothing is lost.
        got = insights.shorten("Global Business Mobility: Senior or Specialist Worker")
        self.assertEqual(got, "GBM: Senior or Specialist Worker")
        self.assertNotIn("…", got)

    def test_breaks_at_a_word_boundary(self):
        got = insights.shorten("Global Business Mobility: Graduate Trainee")
        self.assertNotIn(" …", got)
        self.assertFalse(got[:-1].endswith(" "))

    def test_does_not_leave_dangling_punctuation(self):
        got = insights.shorten("Global Business Mobility: Something Long Here")
        self.assertFalse(got[:-1].rstrip().endswith(":"))

    def test_shared_prefixes_are_abbreviated_so_labels_stay_distinct(self):
        # Raw truncation made two different routes render identically.
        a = insights.shorten("Global Business Mobility: Senior or Specialist Worker")
        b = insights.shorten("Global Business Mobility: Graduate Trainee")
        self.assertNotEqual(a, b)
        self.assertTrue(a.startswith("GBM:"))

    def test_no_two_bars_in_a_chart_render_the_same_label(self):
        rows = [("Global Business Mobility: Senior or Specialist Worker", 9),
                ("Global Business Mobility: Graduate Trainee", 8),
                ("Global Business Mobility: UK Expansion Worker", 7)]
        svg = insights.bar_chart(rows, "r", "Routes")
        labels = re.findall(r'class="cat"[^>]*>([^<]+)<', svg)
        self.assertEqual(len(labels), len(set(labels)))

    def test_full_name_survives_in_the_hover_title(self):
        long = "Global Business Mobility: Senior or Specialist Worker"
        svg = insights.bar_chart([(long, 10)], "r", "Routes")
        self.assertIn(f"<title>{long}: 10 employers</title>", svg)

    def test_no_rendered_label_can_overflow_its_column(self):
        rows = [("Global Business Mobility: Senior or Specialist Worker", 10),
                ("Tier 2 Ministers of Religion", 5)]
        svg = insights.bar_chart(rows, "r", "Routes")
        for label in re.findall(r'class="cat"[^>]*>([^<]+)<', svg):
            self.assertLessEqual(len(label), insights.LABEL_CHARS)


class SplitDominantTests(unittest.TestCase):

    def test_pulls_out_a_runaway_leader(self):
        lead, rest = insights.split_dominant(
            [("London", 36463), ("Birmingham", 3078), ("Leeds", 1081)])
        self.assertEqual(lead, ("London", 36463))
        self.assertEqual([n for n, _ in rest], ["Birmingham", "Leeds"])

    def test_leaves_a_balanced_field_alone(self):
        items = [("A", 10), ("B", 9), ("C", 8)]
        lead, rest = insights.split_dominant(items)
        self.assertIsNone(lead)
        self.assertEqual(rest, items)

    def test_does_not_split_a_short_list(self):
        lead, _ = insights.split_dominant([("A", 100), ("B", 1)])
        self.assertIsNone(lead)

    def test_handles_empty_input(self):
        self.assertEqual(insights.split_dominant([]), (None, []))


class BarChartTests(unittest.TestCase):

    def setUp(self):
        self.svg = insights.bar_chart(
            [("London", 36463), ("Leeds", 1081)], "cities", "By city")

    def test_is_labelled_for_screen_readers(self):
        self.assertIn('role="img"', self.svg)
        self.assertIn('aria-labelledby="cities-t"', self.svg)
        self.assertIn('<title id="cities-t">By city</title>', self.svg)

    def test_every_bar_is_direct_labelled_so_no_value_needs_a_hover(self):
        self.assertIn(">36,463<", self.svg)
        self.assertIn(">1,081<", self.svg)

    def test_each_bar_carries_a_hover_title(self):
        self.assertIn("<title>London: 36,463 employers</title>", self.svg)

    def test_uses_a_single_hue_for_every_bar(self):
        # Nominal categories must not be coloured by their own value.
        self.assertEqual(len(re.findall(r'fill="#', self.svg)), 0)

    def test_escapes_category_names(self):
        svg = insights.bar_chart([("<script>x</script>", 1)], "c", "C")
        self.assertNotIn("<script>x</script>", svg)

    def test_empty_data_renders_nothing(self):
        self.assertEqual(insights.bar_chart([], "c", "C"), "")


class TableTwinTests(unittest.TestCase):

    def test_renders_every_row(self):
        html = insights.table_twin([("London", 10), ("Leeds", 5)], "Table", "City")
        self.assertIn("<td>London</td><td>10</td>", html)
        self.assertIn("<td>Leeds</td><td>5</td>", html)

    def test_adds_a_share_column_when_a_total_is_given(self):
        html = insights.table_twin([("London", 25)], "Table", "City", total=100)
        self.assertIn("<th>Share</th>", html)
        self.assertIn("25.0%", html)

    def test_omits_share_when_no_total(self):
        html = insights.table_twin([("London", 25)], "Table", "City")
        self.assertNotIn("<th>Share</th>", html)


class RenderTests(unittest.TestCase):

    def page(self):
        rows = [row(f"E{i}") for i in range(10)] + [row("X", industry="Other")]
        return insights.render(insights.summarise(rows, added=[row("N")]),
                               updated="2026-09-01 10:20 UTC")

    def test_has_one_hero_figure(self):
        self.assertEqual(self.page().count('class="hero"'), 1)

    def test_states_the_unclassified_caveat_with_a_percentage(self):
        page = self.page()
        self.assertIn("Read this before quoting these figures", page)
        self.assertIn("9%", page)

    def test_has_canonical_and_analytics(self):
        page = self.page()
        self.assertIn('rel="canonical" href="'
                      'https://roshan1208.github.io/sponsorsignal/insights/"', page)
        self.assertIn("goatcounter", page)

    def test_links_back_to_the_search(self):
        self.assertIn('href="../"', self.page())

    def test_every_chart_has_a_table_twin(self):
        page = self.page()
        self.assertEqual(page.count('class="chart"'), page.count('class="twin"'))

    def test_no_emoji_in_the_markup(self):
        # Icons must be SVG or text, never emoji.
        for ch in self.page():
            self.assertLess(ord(ch), 0x1F000, f"emoji found: {ch!r}")


if __name__ == "__main__":
    unittest.main()
