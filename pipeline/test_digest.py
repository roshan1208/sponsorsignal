"""Unit tests for the digest renderer in refresh.py.

Run from the repo root:
    python -m unittest discover -s pipeline -v
"""

import unittest

from refresh import build_digest

DATE = "01 September 2026"


def row(name, town="London", county="", industry="Tech & Software",
        routes=("Skilled Worker",), rating="A"):
    """Build a sponsor record in the same shape as sponsors.json."""
    return [name, town, county, industry, list(routes), rating]


class BuildDigestTests(unittest.TestCase):

    def test_empty_input_states_nothing_was_added(self):
        out = build_digest([], DATE)
        self.assertIn(f"# New UK visa sponsors, {DATE}", out)
        self.assertIn("No new employers were added", out)
        self.assertNotIn("##", out)

    def test_singular_wording_for_one_sponsor(self):
        out = build_digest([row("Acme Ltd")], DATE)
        self.assertIn("**1 employer** was added", out)

    def test_plural_wording_and_total(self):
        out = build_digest([row("Acme Ltd"), row("Beta Ltd")], DATE)
        self.assertIn("**2 employers** were added", out)

    def test_groups_by_industry_with_counts(self):
        rows = [
            row("Acme Ltd", industry="Tech & Software"),
            row("Beta Ltd", industry="Tech & Software"),
            row("Gamma Care", industry="Healthcare & Care"),
        ]
        out = build_digest(rows, DATE)
        self.assertIn("## Tech & Software (2)", out)
        self.assertIn("## Healthcare & Care (1)", out)
        # Larger group is listed first.
        self.assertLess(out.index("## Tech & Software"),
                        out.index("## Healthcare & Care"))

    def test_entry_shows_name_location_and_routes(self):
        rows = [row("Acme Ltd", town="Leeds", county="West Yorkshire",
                    routes=("Skilled Worker", "Global Business Mobility"))]
        out = build_digest(rows, DATE)
        self.assertIn(
            "- **Acme Ltd** — Leeds, West Yorkshire · "
            "Skilled Worker / Global Business Mobility",
            out,
        )

    def test_entry_without_location_or_routes_has_no_dangling_separator(self):
        out = build_digest([row("Acme Ltd", town="", county="", routes=())], DATE)
        self.assertIn("- **Acme Ltd**", out)
        self.assertNotIn("- **Acme Ltd** —", out)
        self.assertNotIn(" · ", out)

    def test_caps_entries_but_reports_true_total(self):
        rows = [row(f"Company {i:03d}") for i in range(250)]
        out = build_digest(rows, DATE, cap=100)
        self.assertIn("**250 employers** were added", out)
        self.assertIn("Showing the first 100, in alphabetical order.", out)
        self.assertEqual(out.count("\n- **"), 100)

    def test_no_truncation_note_when_under_cap(self):
        out = build_digest([row("Acme Ltd")], DATE, cap=100)
        self.assertNotIn("Showing the first", out)

    def test_blank_industry_falls_back_to_other(self):
        out = build_digest([row("Acme Ltd", industry="")], DATE)
        self.assertIn("## Other (1)", out)

    def test_output_is_deterministic(self):
        rows = [row("Zeta Ltd"), row("Alpha Ltd", industry="Healthcare & Care")]
        self.assertEqual(build_digest(rows, DATE), build_digest(rows, DATE))

    def test_handles_non_ascii_names(self):
        out = build_digest([row("Café Solutions Ltd")], DATE)
        self.assertIn("- **Café Solutions Ltd**", out)

    def test_includes_source_link(self):
        out = build_digest([row("Acme Ltd")], DATE)
        self.assertIn(
            "https://www.gov.uk/government/publications/"
            "register-of-licensed-sponsors-workers",
            out,
        )


if __name__ == "__main__":
    unittest.main()
