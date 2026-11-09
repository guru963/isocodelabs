import unittest

from scoring import character_error_rate, normalize, word_error_rate


class ScoringTest(unittest.TestCase):
    def test_identical_text_scores_zero(self):
        self.assertEqual(word_error_rate("இரண்டு மெஷின் பழுது", "இரண்டு மெஷின் பழுது"), 0)
        self.assertEqual(character_error_rate("இரண்டு மெஷின் பழுது", "இரண்டு மெஷின் பழுது"), 0)

    def test_punctuation_and_spacing_do_not_count(self):
        self.assertEqual(word_error_rate("இரண்டு மெஷின்", "இரண்டு,   மெஷின்."), 0)

    def test_one_wrong_word_of_three(self):
        self.assertAlmostEqual(word_error_rate("இரண்டு மெஷின் பழுது", "இரண்டு மிஷின் பழுது"), 1 / 3)

    def test_missing_and_extra_words_count(self):
        self.assertEqual(word_error_rate("a b", "a"), 0.5)
        self.assertEqual(word_error_rate("a", "a b"), 1)

    def test_character_rate_is_gentler_on_a_small_slip(self):
        reference, hypothesis = "இரண்டு மெஷின் பழுது", "இரண்டு மிஷின் பழுது"
        self.assertLess(character_error_rate(reference, hypothesis), word_error_rate(reference, hypothesis))

    def test_empty_reference(self):
        self.assertEqual(word_error_rate("", ""), 0)
        self.assertEqual(word_error_rate("", "invented words"), 1)

    def test_tamil_vowel_signs_survive_normalizing(self):
        self.assertEqual(normalize("  மெஷின்! "), "மெஷின்")


if __name__ == "__main__":
    unittest.main()
