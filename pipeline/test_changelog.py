"""Tests for the /changes/ page and the regional feed.

Run from the repo root:
    python -m unittest discover -s pipeline -v
"""

import json
import re
import unittest

import changelog


def row(name, town="London", county="", industry="Tech & Software",
        routes=("Skilled Worker",), rating="A"):
    return [name, town, county, industry, list(routes), rating]


class GroupByRegionTests(unittest.TestCase):

    def test_groups_and_orders_by_size(self):
        rows = [row("A", "London"), row("B", "London"), row("C", "Leeds")]
        regions, tail = changelog.group_by_region(rows)
        self.assertEqual([(n, len(g)) for n, g in regions],
                         [("London", 2), ("Leeds", 1)])
        self.assertEqual(tail, [])

    def test_employers_within_a_region_are_alphabetical(self):
        rows = [row("Zeta", "Leeds"), row("Alpha", "Leeds")]
        regions, _ = changelog.group_by_region(rows)
        self.assertEqual([r[0] for r in regions[0][1]], ["Alpha", "Zeta"])

    def test_a_blank_town_is_labelled_not_dropped(self):
        regions, _ = changelog.group_by_region([row("A", town="")])
        self.assertEqual(regions[0][0], changelog.UNKNOWN_REGION)

    def test_tail_beyond_the_limit_is_collected_not_lost(self):
        rows = [row(f"E{i}", town=f"Town{i}") for i in range(20)]
        regions, tail = changelog.group_by_region(rows, limit=5)
        self.assertEqual(len(regions), 5)
        self.assertEqual(len(tail), 15)
        self.assertEqual(len(rows), sum(len(g) for _, g in regions) + len(tail))

    def test_empty_input(self):
        self.assertEqual(changelog.group_by_region([]), ([], []))


class RegionalFeedTests(unittest.TestCase):

    def setUp(self):
        self.feed = changelog.regional_feed(
            added=[row("New A", "London"), row("New B", "Leeds")],
            removed=[row("Gone", "London")],
            updated="2026-09-01 10:20 UTC")

    def test_reports_totals(self):
        self.assertEqual(self.feed["totals"], {"added": 2, "removed": 1})

    def test_splits_added_and_removed_per_region(self):
        london = self.feed["regions"]["London"]
        self.assertEqual([r[0] for r in london["added"]], ["New A"])
        self.assertEqual([r[0] for r in london["removed"]], ["Gone"])

    def test_a_region_with_only_additions_still_appears(self):
        self.assertEqual(self.feed["regions"]["Leeds"]["removed"], [])

    def test_each_region_carries_a_slug_for_linking(self):
        self.assertEqual(self.feed["regions"]["London"]["slug"], "london")

    def test_is_json_serialisable(self):
        json.dumps(self.feed)

    def test_empty_week_is_valid(self):
        feed = changelog.regional_feed([], [])
        self.assertEqual(feed["totals"], {"added": 0, "removed": 0})
        self.assertEqual(feed["regions"], {})


class RenderTests(unittest.TestCase):

    def page(self, added=None, removed=None):
        return changelog.render(
            added if added is not None else [row("New Co", "London")],
            removed if removed is not None else [row("Gone Co", "Leeds")],
            updated="2026-09-01 10:20 UTC")

    def test_shows_both_counts(self):
        page = self.page()
        self.assertIn("Newly licensed", page)
        self.assertIn("Lost their licence", page)

    def test_region_anchors_are_linkable_and_unique(self):
        page = self.page([row("A", "London"), row("B", "Leeds")], [])
        ids = re.findall(r'id="(added-[a-z-]+)"', page)
        self.assertIn("added-london", ids)
        self.assertIn("added-leeds", ids)
        self.assertEqual(len(ids), len(set(ids)))

    def test_added_and_removed_anchors_do_not_collide(self):
        page = self.page([row("A", "London")], [row("B", "London")])
        self.assertIn('id="added-london"', page)
        self.assertIn('id="removed-london"', page)

    def test_routes_are_shown_for_additions_only(self):
        # A removed employer's old routes would read as though it still holds
        # them, which is the opposite of what the section means.
        page = self.page([row("A", routes=("Skilled Worker",))], [])
        self.assertIn("Visa routes", page)
        page = self.page([], [row("B", routes=("Skilled Worker",))])
        self.assertNotIn("Visa routes", page)

    def test_a_quiet_week_explains_itself(self):
        page = self.page([], [])
        self.assertIn("does not change every day", page)
        self.assertIn("good news", page)

    def test_escapes_employer_names(self):
        page = self.page([row("<script>x</script>")], [])
        self.assertNotIn("<script>x</script>", page)
        self.assertIn("&lt;script&gt;", page)

    def test_has_canonical_and_analytics(self):
        page = self.page()
        self.assertIn('rel="canonical" href="'
                      'https://roshan1208.github.io/sponsorsignal/changes/"', page)
        self.assertIn("goatcounter", page)

    def test_keeps_the_not_advice_disclaimer(self):
        self.assertIn("not immigration advice", self.page())


if __name__ == "__main__":
    unittest.main()
