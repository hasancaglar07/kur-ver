from app.services.matching import MatchResultCandidate
from app.services.scoring import band_for_quality, calculate_quality_score


def test_band_for_quality() -> None:
    assert band_for_quality(90) == "green"
    assert band_for_quality(70) == "yellow"
    assert band_for_quality(40) == "red"


def test_calculate_quality_score() -> None:
    matches = [
        MatchResultCandidate(donor_id=1, match_type="exact", score=100, evidence_source="audio"),
        MatchResultCandidate(donor_id=2, match_type="fuzzy", score=88, evidence_source="ocr"),
    ]
    score = calculate_quality_score(
        total_candidates=2,
        matched=matches,
        no_match=True,
        audio_clarity=80,
        video_clarity=75,
    )
    assert score >= 85
