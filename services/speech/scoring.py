"""Measures how close a transcript is to what was actually said. Lower is better."""

import re
import string

_PUNCTUATION = str.maketrans("", "", string.punctuation + "।…“”‘’")


def normalize(text):
    return re.sub(r"\s+", " ", text.translate(_PUNCTUATION)).strip().lower()


def _edit_distance(reference, hypothesis):
    previous = list(range(len(hypothesis) + 1))
    for i, ref_item in enumerate(reference, start=1):
        current = [i]
        for j, hyp_item in enumerate(hypothesis, start=1):
            current.append(
                min(
                    previous[j] + 1,
                    current[j - 1] + 1,
                    previous[j - 1] + (ref_item != hyp_item),
                )
            )
        previous = current
    return previous[-1]


def _rate(reference, hypothesis):
    if not reference:
        return 0.0 if not hypothesis else 1.0
    return _edit_distance(reference, hypothesis) / len(reference)


def word_error_rate(reference, hypothesis):
    """The share of words that are wrong. 0 is perfect."""
    return _rate(normalize(reference).split(), normalize(hypothesis).split())


def character_error_rate(reference, hypothesis):
    """The share of characters that are wrong. Fairer for Tamil, where one suffix can fail a whole word."""
    return _rate(normalize(reference), normalize(hypothesis))
