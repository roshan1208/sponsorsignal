"""Tests for the industry classifier.

Industries are not in the official register; they are inferred from the
employer's name. These tests pin the behaviour that matters: the longer word
forms that an earlier version silently missed, and the ordering that decides
which rule wins when a name matches several.

Run from the repo root:
    python -m unittest discover -s pipeline -v
"""

import unittest

from refresh import classify


class LongerWordFormsTests(unittest.TestCase):
    """These all returned "Other" before, because the patterns required an
    exact word: \\bhealth\\b never matched "healthcare"."""

    def test_healthcare(self):
        self.assertEqual(classify("Sunrise Healthcare Ltd"), "Healthcare & Care")

    def test_technology_and_technologies(self):
        for name in ["Orbit Technology Ltd", "Orbit Technologies Ltd"]:
            self.assertEqual(classify(name), "Tech & Software")

    def test_pharmacy(self):
        self.assertEqual(classify("High Street Pharmacy Ltd"), "Healthcare & Care")

    def test_consultancy(self):
        self.assertEqual(classify("Meridian Consultancy Ltd"),
                         "Finance & Professional")

    def test_engineers_and_engineering(self):
        for name in ["Vale Engineering Ltd", "Vale Engineers Ltd"]:
            self.assertEqual(classify(name), "Construction & Engineering")


class OrderingTests(unittest.TestCase):
    """When a name matches several rules, the first wins. These pin the
    orderings that were wrong at some point."""

    def test_a_hotel_with_a_spa_is_hospitality_not_beauty(self):
        self.assertEqual(classify("Barton Manor Hotel & Spa Ltd"),
                         "Hospitality & Food")

    def test_a_medical_recruiter_is_a_recruiter(self):
        self.assertEqual(classify("Medical Recruitment Ltd"),
                         "Recruitment & Staffing")

    def test_a_medical_centre_is_still_healthcare(self):
        self.assertEqual(classify("Bridge Medical Centre"), "Healthcare & Care")

    def test_a_care_home_is_healthcare_not_property(self):
        self.assertEqual(classify("Oakwood Care Homes Ltd"), "Healthcare & Care")

    def test_property_management_is_property_not_finance(self):
        self.assertEqual(classify("Apex Property Management Ltd"),
                         "Property & Real Estate")


class NewCategoryTests(unittest.TestCase):

    def test_recognises_the_new_sectors(self):
        cases = {
            "Jo Properties Ltd": "Property & Real Estate",
            "Spen Motors": "Motor & Automotive",
            "Dream Beauty Studio Ltd": "Beauty & Wellbeing",
            "BGN Security Services Limited": "Security & Facilities",
            "Qube Renewables Limited": "Energy & Utilities",
            "Stomp Productions Ltd": "Media & Creative",
            "Reed & Mackay Travel Limited": "Travel & Tourism",
            "Stourbridge Cricket Club": "Sport & Leisure",
            "Manchester City Council": "Public Sector",
            "The Beck Veterinary Practice Ltd": "Healthcare & Care",
            "FirstRand Bank Ltd": "Finance & Professional",
            "Beirut BBQ Ltd": "Hospitality & Food",
        }
        for name, expected in cases.items():
            self.assertEqual(classify(name), expected, name)


class RestraintTests(unittest.TestCase):
    """A wrong tag is worse than no tag, so a name with no signal must
    stay in Other rather than be guessed at."""

    def test_a_name_with_no_signal_stays_other(self):
        for name in ["Speckles Limited", "Mattel UK Limited",
                     "Free Brands Ltd", "Yuvi Private Limited"]:
            self.assertEqual(classify(name), "Other", name)

    def test_matching_is_case_insensitive(self):
        self.assertEqual(classify("SUNRISE HEALTHCARE LTD"), "Healthcare & Care")

    def test_taxi_is_not_a_tax_adviser(self):
        # \btax\b must not fire on "taxi".
        self.assertNotEqual(classify("Kwik Taxis Ltd"), "Finance & Professional")

    def test_empty_name_is_other(self):
        self.assertEqual(classify(""), "Other")


if __name__ == "__main__":
    unittest.main()
