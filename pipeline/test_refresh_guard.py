"""Integration tests for the publish guard in refresh.main().

The unit tests in test_changes.py check the decision. These check the thing
that actually matters: that a bad run leaves the live data untouched.

Run from the repo root:
    python -m unittest discover -s pipeline -v
"""

import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import refresh


@contextlib.contextmanager
def quiet():
    """Swallow the pipeline's progress output so test logs stay readable."""
    with contextlib.redirect_stdout(io.StringIO()):
        yield


def org(name, town="London"):
    return {"n": name, "t": town, "c": "", "routes": set(), "rating": "A"}


def sponsor_row(name, town="London"):
    return [name, town, "", "Other", [], "A"]


class PublishGuardTests(unittest.TestCase):

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.data = self.root / "data"
        self.data.mkdir()

        # A healthy previous run to compare against.
        self.previous = {
            "updated": "2026-08-31 21:00 UTC",
            "sponsors": [sponsor_row(f"Employer {i:06d}") for i in range(50_000)],
        }
        self.sponsors_file = self.data / "sponsors.json"
        self.sponsors_file.write_text(json.dumps(self.previous), encoding="utf-8")
        self.before = self.sponsors_file.read_text(encoding="utf-8")

    def run_pipeline(self, orgs):
        """Run main() against the temp dir with the network stubbed out."""
        return mock.patch.multiple(
            refresh,
            DATA=self.data,
            ROOT=self.root,
            find_latest_csv_url=lambda: "https://example.invalid/register.csv",
            download_csv=lambda url: "irrelevant, parse is stubbed",
            parse_register=lambda text: orgs,
        )

    def test_refuses_a_collapsed_parse(self):
        # GOV.UK changes its layout and we scrape almost nothing.
        with quiet(), self.run_pipeline({("a", "london"): org("A Ltd")}):
            with self.assertRaises(SystemExit) as caught:
                refresh.main()
        self.assertIn("Refusing to publish", str(caught.exception))
        self.assertIn("expected at least", str(caught.exception))

    def test_refuses_a_large_drop(self):
        orgs = {(f"e{i}", "london"): org(f"Employer {i:06d}")
                for i in range(30_000)}
        with quiet(), self.run_pipeline(orgs):
            with self.assertRaises(SystemExit) as caught:
                refresh.main()
        self.assertIn("moved down", str(caught.exception))

    def test_a_refusal_leaves_the_existing_data_untouched(self):
        with quiet(), self.run_pipeline({("a", "london"): org("A Ltd")}):
            with self.assertRaises(SystemExit):
                refresh.main()
        self.assertEqual(self.sponsors_file.read_text(encoding="utf-8"),
                         self.before)
        for name in ("changes.json", "new_sponsors.json", "digest.md"):
            self.assertFalse((self.data / name).exists(),
                             f"{name} should not have been written")

    def test_a_refusal_generates_no_landing_pages(self):
        with quiet(), self.run_pipeline({("a", "london"): org("A Ltd")}):
            with self.assertRaises(SystemExit):
                refresh.main()
        self.assertFalse((self.root / "sitemap.xml").exists())

    def test_override_lets_a_genuine_big_change_through(self):
        orgs = {(f"e{i}", "london"): org(f"Employer {i:06d}")
                for i in range(30_000)}
        with quiet(), self.run_pipeline(orgs), \
                mock.patch.dict(os.environ, {"ALLOW_BIG_CHANGE": "1"}), \
                mock.patch.object(refresh.pages, "write_all",
                                  lambda *a, **k: []):
            refresh.main()
        written = json.loads(self.sponsors_file.read_text(encoding="utf-8"))
        self.assertEqual(len(written["sponsors"]), 30_000)

    def test_a_normal_day_publishes_and_records_the_changes(self):
        orgs = {(f"e{i}", "london"): org(f"Employer {i:06d}")
                for i in range(50_000)}
        orgs[("new", "london")] = org("Brand New Ltd")      # one addition
        del orgs[("e0", "london")]                          # one removal

        with quiet(), self.run_pipeline(orgs), \
                mock.patch.object(refresh.pages, "write_all",
                                  lambda *a, **k: []):
            refresh.main()

        history = json.loads((self.data / "changes.json").read_text("utf-8"))
        day = history["days"][-1]
        self.assertEqual([r[0] for r in day["added"]], ["Brand New Ltd"])
        self.assertEqual([r[0] for r in day["removed"]], ["Employer 000000"])

        recent = json.loads((self.data / "new_sponsors.json").read_text("utf-8"))
        self.assertEqual([r[0] for r in recent["new"]], ["Brand New Ltd"])

        gone = json.loads((self.data / "removed_sponsors.json").read_text("utf-8"))
        self.assertEqual([r[0] for r in gone["removed"]], ["Employer 000000"])

        digest = (self.data / "digest.md").read_text("utf-8")
        self.assertIn("Brand New Ltd", digest)
        self.assertIn("No longer on the register", digest)


if __name__ == "__main__":
    unittest.main()
