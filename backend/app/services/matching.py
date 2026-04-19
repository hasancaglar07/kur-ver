from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher

from app.models import DonorRecord


TURKISH_MAP = str.maketrans(
    {
        "İ": "I",
        "I": "I",
        "ı": "i",
        "Ş": "S",
        "ş": "s",
        "Ğ": "G",
        "ğ": "g",
        "Ü": "U",
        "ü": "u",
        "Ö": "O",
        "ö": "o",
        "Ç": "C",
        "ç": "c",
    }
)


@dataclass
class ExtractedName:
    full_name: str
    source: str
    confidence: float = 1.0
    low_confidence: bool = False


@dataclass
class MatchResultCandidate:
    donor_id: int
    match_type: str
    score: float
    evidence_source: str


def normalize_name(value: str) -> str:
    value = value.strip().translate(TURKISH_MAP)
    return " ".join(value.upper().split())


def fuzzy_ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, normalize_name(a), normalize_name(b)).ratio()


def match_names(
    donors: list[DonorRecord],
    extracted_names: list[ExtractedName],
    fuzzy_threshold: float = 0.82,
) -> list[MatchResultCandidate]:
    matches: list[MatchResultCandidate] = []
    normalized_extracted = [(normalize_name(x.full_name), x.source) for x in extracted_names]

    for donor in donors:
        donor_full = normalize_name(f"{donor.first_name} {donor.last_name}")
        best_score = 0.0
        best_source = "audio"
        best_type = "none"

        for extracted, source in normalized_extracted:
            if donor_full == extracted:
                best_score = 1.0
                best_source = source
                best_type = "exact"
                break

            score = fuzzy_ratio(donor_full, extracted)
            if score > best_score:
                best_score = score
                best_source = source
                best_type = "fuzzy" if score >= fuzzy_threshold else "none"

        if best_type != "none":
            matches.append(
                MatchResultCandidate(
                    donor_id=donor.id,
                    match_type=best_type,
                    score=round(best_score * 100, 2),
                    evidence_source=best_source,
                )
            )

    return matches
