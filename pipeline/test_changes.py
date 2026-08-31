"""Unit tests for change tracking and the publish safety checks.

Run from the repo root:
    python -m unittest discover -s pipeline -v
"""

import json
import tempfile
import unittest
from pathlib import Path

import changes


def row(name, town="London", county="", industry="Tech & Software",
        routes=("Skilled Worker",), rating="A"):
    return [name, town, county, industry, list(routes), rating]


class SponsorKeyTests(unittest.TestCase):

    def test_key_is_case_and_space_insensitive(self):
        self.assertEqual(changes.sponsor_key(row("  Acme Ltd ", " London ")),
                         changes.sponsor_key(row("acme ltd", "london")))

    def test_same_name_in_two_towns_is_two_sponsors(self):
        self.assertNotEqual(changes.sponsor_key(row("Acme Ltd", "London")),
                            changes.sponsor_key(row("Acme Ltd", "Leeds")))


class DiffTests(unittest.TestCase):

    def test_detects_additions(self):
        added, removed = changes.diff([row("A")], [row("A"), row("B")])
        self.assertEqual([r[0] for r in added], ["B"])
        self.assertEqual(removed, [])

    def test_detects_removals(self):
        added, removed = changes.diff([row("A"), row("B")], [row("A")])
        self.assertEqual(added, [])
        self.assertEqual([r[0] for r in removed], ["B"])

    def test_no_change_yields_nothing(self):
        added, removed = changes.diff([row("A")], [row("A")])
        self.assertEqual((added, removed), ([], []))

    def test_same_name_different_town_counts_as_a_move(self):
        added, removed = changes.diff([row("A", "London")], [row("A", "Leeds")])
        self.assertEqual([r[1] for r in added], ["Leeds"])
        self.assertEqual([r[1] for r in removed], ["London"])

    def test_first_run_against_empty_previous_is_not_all_additions(self):
        # An empty previous list means no history, not 127k new sponsors.
        # The caller must skip the diff; this documents diff's own behaviour.
        added, removed = changes.diff([], [row("A"), row("B")])
        self.assertEqual(len(added), 2)
        self.assertEqual(removed, [])

    def test_results_are_sorted_for_stable_output(self):
        added, _ = changes.diff([], [row("Zeta"), row("Alpha")])
        self.assertEqual([r[0] for r in added], ["Alpha", "Zeta"])


class CheckTotalsTests(unittest.TestCase):

    def test_accepts_a_normal_day(self):
        self.assertEqual(changes.check_totals(127_600, 127_574), "")

    def test_rejects_an_implausibly_small_parse(self):
        reason = changes.check_totals(3, 127_574)
        self.assertIn("expected at least", reason)

    def test_rejects_a_large_drop(self):
        reason = changes.check_totals(90_000, 127_574)
        self.assertIn("moved down", reason)
        self.assertIn("127,574", reason)

    def test_rejects_a_large_jump(self):
        reason = changes.check_totals(200_000, 127_574)
        self.assertIn("moved up", reason)

    def test_allows_any_total_on_a_first_run(self):
        # No previous total to compare against, but the floor still applies.
        self.assertEqual(changes.check_totals(127_574, 0), "")
        self.assertIn("expected at least", changes.check_totals(5, 0))

    def test_boundary_just_inside_the_limit_is_allowed(self):
        self.assertEqual(changes.check_totals(110_000, 100_000), "")

    def test_boundary_just_outside_the_limit_is_refused(self):
        self.assertNotEqual(changes.check_totals(110_001, 100_000), "")


class HistoryTests(unittest.TestCase):

    def test_append_records_a_day(self):
        h = changes.append_day([], "2026-09-01", [row("A")], [row("B")])
        self.assertEqual(len(h), 1)
        self.assertEqual(h[0]["date"], "2026-09-01")
        self.assertEqual([r[0] for r in h[0]["added"]], ["A"])
        self.assertEqual([r[0] for r in h[0]["removed"]], ["B"])

    def test_rerunning_the_same_day_replaces_it(self):
        h = changes.append_day([], "2026-09-01", [row("A")], [])
        h = changes.append_day(h, "2026-09-01", [row("A"), row("B")], [])
        self.assertEqual(len(h), 1)
        self.assertEqual(len(h[0]["added"]), 2)

    def test_history_is_trimmed_to_the_window(self):
        h = []
        for day in range(1, 29):
            h = changes.append_day(h, f"2026-09-{day:02d}", [row("A")], [],
                                   keep_days=7)
        self.assertLessEqual(len(h), 8)
        self.assertEqual(h[-1]["date"], "2026-09-28")

    def test_days_are_kept_in_order(self):
        h = changes.append_day([], "2026-09-02", [], [])
        h = changes.append_day(h, "2026-09-01", [], [])
        self.assertEqual([d["date"] for d in h], ["2026-09-01", "2026-09-02"])

    def test_per_day_entries_are_capped(self):
        many = [row(f"C{i:04d}") for i in range(50)]
        h = changes.append_day([], "2026-09-01", many, [], cap=10)
        self.assertEqual(len(h[0]["added"]), 10)


class LoadTests(unittest.TestCase):

    def _write(self, text):
        f = Path(tempfile.mkdtemp()) / "changes.json"
        f.write_text(text, encoding="utf-8")
        return f

    def test_reads_a_valid_file(self):
        f = self._write(json.dumps({"days": [{"date": "2026-09-01",
                                              "added": [], "removed": []}]}))
        self.assertEqual(len(changes.load(f)), 1)

    def test_missing_file_gives_empty_history(self):
        self.assertEqual(changes.load(Path("nope/changes.json")), [])

    def test_corrupt_file_gives_empty_history(self):
        # Losing history is bad; refusing to publish today is worse.
        self.assertEqual(changes.load(self._write("{not json")), [])

    def test_entries_without_a_date_are_dropped(self):
        f = self._write(json.dumps({"days": [{"added": []},
                                             {"date": "2026-09-01"}]}))
        self.assertEqual(len(changes.load(f)), 1)


class RecentTests(unittest.TestCase):

    def setUp(self):
        self.history = [
            {"date": "2026-08-20", "added": [row("Old")], "removed": []},
            {"date": "2026-08-30", "added": [row("Recent")], "removed": []},
            {"date": "2026-09-01", "added": [row("Today")],
             "removed": [row("Gone")]},
        ]

    def test_only_returns_rows_inside_the_window(self):
        got = changes.recent(self.history, "added", today="2026-09-01", days=7)
        self.assertEqual([r[0] for r in got], ["Today", "Recent"])

    def test_most_recent_first(self):
        got = changes.recent(self.history, "added", today="2026-09-01", days=30)
        self.assertEqual(got[0][0], "Today")

    def test_reads_the_removed_field_too(self):
        got = changes.recent(self.history, "removed", today="2026-09-01")
        self.assertEqual([r[0] for r in got], ["Gone"])

    def test_deduplicates_a_sponsor_seen_on_several_days(self):
        history = [
            {"date": "2026-08-30", "added": [row("Acme")], "removed": []},
            {"date": "2026-09-01", "added": [row("Acme")], "removed": []},
        ]
        got = changes.recent(history, "added", today="2026-09-01")
        self.assertEqual(len(got), 1)

    def test_empty_history_is_fine(self):
        self.assertEqual(changes.recent([], "added", today="2026-09-01"), [])


if __name__ == "__main__":
    unittest.main()
