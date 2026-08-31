"""Unit tests for the landing-page generator.

Run from the repo root:
    python -m unittest discover -s pipeline -v
"""

import unittest
import xml.etree.ElementTree as ET

import pages


def row(name, town="London", county="", industry="Tech & Software",
        routes=("Skilled Worker",), rating="A"):
    return [name, town, county, industry, list(routes), rating]


class SlugifyTests(unittest.TestCase):

    def test_ampersand_and_spaces(self):
        self.assertEqual(pages.slugify("Tech & Software"), "tech-software")

    def test_lowercases_and_trims_punctuation(self):
        self.assertEqual(pages.slugify("Stoke-on-Trent!"), "stoke-on-trent")

    def test_strips_accents(self):
        self.assertEqual(pages.slugify("Málaga"), "malaga")

    def test_non_alphanumeric_only_yields_empty(self):
        self.assertEqual(pages.slugify("---"), "")


class TopValuesTests(unittest.TestCase):

    def test_orders_by_count_descending(self):
        rows = [row("a", town="London"), row("b", town="London"),
                row("c", town="Leeds")]
        self.assertEqual(pages.top_values(rows, pages.I_TOWN, 10),
                         [("London", 2), ("Leeds", 1)])

    def test_respects_limit(self):
        rows = [row("a", town="London"), row("b", town="Leeds"),
                row("c", town="Bath")]
        self.assertEqual(len(pages.top_values(rows, pages.I_TOWN, 2)), 2)

    def test_skips_blank_and_skipped_labels(self):
        rows = [row("a", industry="Other"), row("b", industry=""),
                row("c", industry="Tech & Software")]
        got = pages.top_values(rows, pages.I_INDUSTRY, 10,
                               skip=pages.SKIP_INDUSTRIES)
        self.assertEqual(got, [("Tech & Software", 1)])

    def test_ties_broken_alphabetically_for_stable_output(self):
        rows = [row("a", town="Zebra"), row("b", town="Apple")]
        self.assertEqual([label for label, _ in
                          pages.top_values(rows, pages.I_TOWN, 10)],
                         ["Apple", "Zebra"])


class BuildPagesTests(unittest.TestCase):

    def setUp(self):
        self.rows = (
            [row(f"Tech {i}", town="London", industry="Tech & Software")
             for i in range(5)]
            + [row(f"Care {i}", town="Leeds", industry="Healthcare & Care")
               for i in range(3)]
            + [row("Misc", town="", industry="Other")]
        )

    def test_builds_industry_and_town_pages(self):
        built = pages.build_pages(self.rows)
        kinds = {p["kind"] for p in built}
        self.assertEqual(kinds, {"industry", "town"})

    def test_excludes_other_industry(self):
        labels = [p["label"] for p in pages.build_pages(self.rows)
                  if p["kind"] == "industry"]
        self.assertNotIn("Other", labels)

    def test_excludes_blank_town(self):
        towns = [p["label"] for p in pages.build_pages(self.rows)
                 if p["kind"] == "town"]
        self.assertNotIn("", towns)

    def test_counts_match_the_data(self):
        by_label = {p["label"]: p["count"] for p in pages.build_pages(self.rows)}
        self.assertEqual(by_label["Tech & Software"], 5)
        self.assertEqual(by_label["London"], 5)

    def test_slugs_are_unique(self):
        slugs = [p["slug"] for p in pages.build_pages(self.rows)]
        self.assertEqual(len(slugs), len(set(slugs)))

    def test_examples_are_capped_and_alphabetical(self):
        many = [row(f"Company {i:03d}") for i in range(60)]
        page = pages.build_pages(many)[0]
        self.assertEqual(len(page["examples"]), pages.EXAMPLES_PER_PAGE)
        names = [e[pages.I_NAME] for e in page["examples"]]
        self.assertEqual(names, sorted(names, key=str.lower))


class FilterQueryTests(unittest.TestCase):

    def test_industry_uses_industry_param_and_is_encoded(self):
        self.assertEqual(pages.filter_query("industry", "Tech & Software"),
                         "industry=Tech+%26+Software")

    def test_town_falls_back_to_free_text_search(self):
        self.assertEqual(pages.filter_query("town", "Milton Keynes"),
                         "q=Milton+Keynes")


class RenderPageTests(unittest.TestCase):

    def page(self, **kw):
        base = {"kind": "town", "label": "London", "count": 1234,
                "slug": "london", "examples": [row("Acme Ltd")]}
        base.update(kw)
        return base

    def test_has_h1_canonical_and_cta(self):
        out = pages.render_page(self.page())
        self.assertIn("<h1>Companies that sponsor UK work visas in London</h1>", out)
        self.assertIn('rel="canonical" href="'
                      'https://roshan1208.github.io/sponsorsignal/london/"', out)
        self.assertIn("../?q=London", out)

    def test_lead_paragraphs_differ_between_pages(self):
        a = pages.lead_paragraph(self.page())
        b = pages.lead_paragraph(self.page(kind="industry",
                                           label="Tech & Software"))
        self.assertNotEqual(a, b)

    def test_escapes_html_in_organisation_names(self):
        out = pages.render_page(self.page(examples=[row("<script>x</script>")]))
        self.assertNotIn("<script>x</script>", out)
        self.assertIn("&lt;script&gt;", out)

    def test_escapes_ampersand_in_label(self):
        # Industry pages lowercase the label in prose ("...in tech & software").
        out = pages.render_page(self.page(kind="industry",
                                          label="Tech & Software",
                                          slug="tech-software"))
        self.assertIn("<h1>Companies that sponsor UK work visas in "
                      "tech &amp; software</h1>", out)
        self.assertNotIn("in tech & software", out)

    def test_reports_remaining_count(self):
        out = pages.render_page(self.page(count=1234, examples=[row("Acme Ltd")]))
        self.assertIn("1,233 more", out)


class BrowseNavTests(unittest.TestCase):

    def test_renders_both_groups_with_relative_links(self):
        built = [
            {"kind": "industry", "label": "Tech & Software", "slug": "tech-software"},
            {"kind": "town", "label": "London", "slug": "london"},
        ]
        nav = pages.render_browse_nav(built)
        self.assertIn('<a href="tech-software/">Tech &amp; Software</a>', nav)
        self.assertIn('<a href="london/">London</a>', nav)
        self.assertIn("Browse by industry", nav)
        self.assertIn("Browse by city", nav)

    def test_injection_replaces_marker_contents(self):
        doc = f"<footer>{pages.BROWSE_START}\nOLD\n{pages.BROWSE_END}</footer>"
        out = pages.inject_browse_links(doc, "NEW")
        self.assertIn("NEW", out)
        self.assertNotIn("OLD", out)

    def test_injection_is_idempotent(self):
        doc = f"<footer>{pages.BROWSE_START}\n{pages.BROWSE_END}</footer>"
        once = pages.inject_browse_links(doc, "NEW")
        twice = pages.inject_browse_links(once, "NEW")
        self.assertEqual(once, twice)

    def test_missing_markers_raise(self):
        with self.assertRaises(RuntimeError):
            pages.inject_browse_links("<footer></footer>", "NEW")


class SitemapTests(unittest.TestCase):

    def test_is_valid_xml_and_includes_homepage_and_pages(self):
        built = [{"kind": "town", "label": "London", "slug": "london",
                  "count": 1, "examples": []}]
        xml = pages.render_sitemap(built)
        root = ET.fromstring(xml)
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        locs = [e.text for e in root.findall(".//s:loc", ns)]
        self.assertIn("https://roshan1208.github.io/sponsorsignal/", locs)
        self.assertIn("https://roshan1208.github.io/sponsorsignal/london/", locs)


if __name__ == "__main__":
    unittest.main()
