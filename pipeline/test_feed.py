"""Tests for the RSS feed of register changes.

Run from the repo root:
    python -m unittest discover -s pipeline -v
"""

import unittest
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import feed


def row(name, town="London"):
    return [name, town, "", "Tech & Software", ["Skilled Worker"], "A"]


def day(date, added=(), removed=()):
    return {"date": date, "added": list(added), "removed": list(removed)}


STAMP = datetime(2026, 9, 2, 6, 0, tzinfo=timezone.utc)


class TitleTests(unittest.TestCase):

    def test_both_directions(self):
        t = feed.item_title(day("2026-09-01", [row("A"), row("B")], [row("C")]))
        self.assertEqual(t, "2 sponsors added and 1 sponsor removed, 1 September 2026")

    def test_additions_only(self):
        self.assertEqual(feed.item_title(day("2026-09-01", [row("A")])),
                         "1 sponsor added, 1 September 2026")

    def test_removals_only(self):
        self.assertEqual(feed.item_title(day("2026-09-01", [], [row("A")])),
                         "1 sponsor removed, 1 September 2026")

    def test_date_has_no_leading_zero(self):
        # %-d is not available on Windows, so the day is built by hand.
        self.assertIn("1 September", feed.item_title(day("2026-09-01", [row("A")])))
        self.assertIn("15 September", feed.item_title(day("2026-09-15", [row("A")])))


class DescriptionTests(unittest.TestCase):

    def test_names_additions_with_their_town(self):
        d = feed.item_description(day("2026-09-01", [row("Acme Ltd", "Leeds")]))
        self.assertIn("Newly licensed: Acme Ltd (Leeds).", d)

    def test_spells_out_what_removal_means(self):
        d = feed.item_description(day("2026-09-01", [], [row("Gone Ltd")]))
        self.assertIn("cannot sponsor a visa now", d)

    def test_caps_the_list_and_says_how_many_more(self):
        rows = [row(f"Company {i:03d}") for i in range(40)]
        d = feed.item_description(day("2026-09-01", rows))
        self.assertIn(f"and {40 - feed.NAMED_IN_ITEM} more", d)

    def test_always_credits_the_source_and_disclaims(self):
        d = feed.item_description(day("2026-09-01", [row("A")]))
        self.assertIn("GOV.UK", d)
        self.assertIn("Not immigration advice", d)

    def test_handles_a_missing_town(self):
        d = feed.item_description(day("2026-09-01", [row("Acme Ltd", "")]))
        self.assertIn("Acme Ltd.", d)
        self.assertNotIn("()", d)


class RenderTests(unittest.TestCase):

    def feed_xml(self, history):
        return feed.render(history, updated=STAMP)

    def test_is_valid_xml_with_a_channel(self):
        root = ET.fromstring(self.feed_xml([day("2026-09-01", [row("A")])]))
        self.assertEqual(root.tag, "rss")
        self.assertIsNotNone(root.find("channel/title"))

    def test_skips_days_with_no_movement(self):
        # An empty item teaches people to ignore the feed.
        xml = self.feed_xml([day("2026-08-31"), day("2026-09-01", [row("A")])])
        root = ET.fromstring(xml)
        self.assertEqual(len(root.findall("channel/item")), 1)

    def test_newest_item_first(self):
        xml = self.feed_xml([day("2026-08-30", [row("Old")]),
                             day("2026-09-01", [row("New")])])
        titles = [e.text for e in ET.fromstring(xml).findall("channel/item/title")]
        self.assertIn("1 September", titles[0])

    def test_each_item_has_a_stable_unique_guid(self):
        xml = self.feed_xml([day("2026-08-30", [row("A")]),
                             day("2026-09-01", [row("B")])])
        guids = [e.text for e in ET.fromstring(xml).findall("channel/item/guid")]
        self.assertEqual(len(guids), len(set(guids)))
        self.assertIn("2026-09-01", guids[0])

    def test_pubdate_is_midday_so_timezones_cannot_shift_the_day(self):
        xml = self.feed_xml([day("2026-09-01", [row("A")])])
        pub = ET.fromstring(xml).find("channel/item/pubDate").text
        self.assertIn("12:00:00", pub)
        self.assertIn("01 Sep 2026", pub)

    def test_declares_itself_with_an_atom_self_link(self):
        xml = self.feed_xml([day("2026-09-01", [row("A")])])
        self.assertIn("feed.xml", xml)
        self.assertIn('rel="self"', xml)

    def test_escapes_employer_names(self):
        xml = self.feed_xml([day("2026-09-01", [row("A & B <Ltd>")])])
        ET.fromstring(xml)          # would raise if the entities were broken
        self.assertNotIn("<Ltd>", xml)

    def test_an_empty_history_is_still_a_valid_feed(self):
        root = ET.fromstring(self.feed_xml([]))
        self.assertEqual(root.findall("channel/item"), [])
        self.assertIsNotNone(root.find("channel/title"))

    def test_limits_how_far_back_it_publishes(self):
        history = [day(f"2026-07-{d:02d}", [row("A")]) for d in range(1, 32)]
        root = ET.fromstring(feed.render(history, updated=STAMP, days=10))
        self.assertEqual(len(root.findall("channel/item")), 10)


if __name__ == "__main__":
    unittest.main()
