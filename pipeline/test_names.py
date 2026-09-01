"""Tests for repairing the damaged characters in the published register.

GOV.UK's CSV contains employer names where a right single quote was already
broken before publication: the bytes are 0xE2 followed by two literal '?'.
It cannot be fixed by decoding differently, so it is repaired by hand.

Run from the repo root:
    python -m unittest discover -s pipeline -v
"""

import unittest

from refresh import repair_name

BROKEN = chr(0xE2) + "??"          # what the file actually contains
APOSTROPHE = chr(0x2019)           # what it should be


class RepairNameTests(unittest.TestCase):

    def test_repairs_the_published_damage(self):
        self.assertEqual(repair_name("BANKY" + BROKEN + "S KITCHEN"),
                         "BANKY" + APOSTROPHE + "S KITCHEN")

    def test_repairs_double_encoded_apostrophe(self):
        broken = chr(0xE2) + chr(0x20AC) + chr(0x2122)
        self.assertEqual(repair_name("Don Alberto" + broken + "s"),
                         "Don Alberto" + APOSTROPHE + "s")

    def test_repairs_every_occurrence_in_one_name(self):
        got = repair_name(f"A{BROKEN}s and B{BROKEN}s")
        self.assertEqual(got, f"A{APOSTROPHE}s and B{APOSTROPHE}s")

    def test_leaves_clean_names_alone(self):
        for name in ["Acme Ltd", "M&S Ltd", "O'Brien Care Ltd", "24 7 Property"]:
            self.assertEqual(repair_name(name), name)

    def test_leaves_legitimate_accents_alone(self):
        # A real accented character must not be mistaken for damage.
        for name in ["Café Solutions", "Málaga Foods",
                     "Crème Ltd"]:
            self.assertEqual(repair_name(name), name)

    def test_leaves_a_lone_question_mark_alone(self):
        self.assertEqual(repair_name("What? Ltd"), "What? Ltd")

    def test_leaves_a_bare_accented_a_alone(self):
        # 0xE2 on its own is a normal letter, not damage.
        self.assertEqual(repair_name("Bâtiment Ltd"), "Bâtiment Ltd")

    def test_is_idempotent(self):
        once = repair_name("BANKY" + BROKEN + "S")
        self.assertEqual(repair_name(once), once)

    def test_handles_an_empty_string(self):
        self.assertEqual(repair_name(""), "")


if __name__ == "__main__":
    unittest.main()
