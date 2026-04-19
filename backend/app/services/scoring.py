from app.services.matching import MatchResultCandidate


def band_for_quality(score: float) -> str:
    if score >= 85:
        return "green"
    if score >= 60:
        return "yellow"
    return "red"


def calculate_quality_score(
    *,
    total_candidates: int,
    matched: list[MatchResultCandidate],
    no_match: bool,
    audio_clarity: float,
    video_clarity: float,
) -> float:
    if total_candidates <= 0:
        return 0.0

    identity_score = (len(matched) / total_candidates) * 100
    avg_match = sum(m.score for m in matched) / len(matched) if matched else 0.0
    no_score = 100.0 if no_match else 0.0

    weighted = (
        identity_score * 0.45
        + avg_match * 0.25
        + no_score * 0.15
        + audio_clarity * 0.1
        + video_clarity * 0.05
    )
    return round(max(0.0, min(100.0, weighted)), 2)
