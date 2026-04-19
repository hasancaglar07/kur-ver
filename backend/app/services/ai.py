from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import httpx

from app.core.config import get_settings
from app.models import DonorRecord, VideoSubmission
from app.services.matching import ExtractedName, fuzzy_ratio, normalize_name

settings = get_settings()
LOW_CONFIDENCE_THRESHOLD = 0.80


class ProviderInvocationError(RuntimeError):
    pass


@dataclass
class AIAnalysisOutput:
    transcript_text: str
    ocr_text: str
    extracted_no: str | None
    extracted_names: list[ExtractedName]
    audio_clarity: float
    video_clarity: float
    analysis_mode: str


def _tokenize_normalized(value: str) -> list[str]:
    return re.findall(r"[A-Z0-9]+", normalize_name(value))


def _best_window_similarity(target_name: str, transcript_tokens: list[str]) -> float:
    target_tokens = target_name.split()
    if not target_tokens or not transcript_tokens:
        return 0.0

    sizes = {max(1, len(target_tokens) - 1), len(target_tokens), len(target_tokens) + 1}
    best = 0.0

    for size in sizes:
        if len(transcript_tokens) < size:
            continue
        for i in range(0, len(transcript_tokens) - size + 1):
            candidate = " ".join(transcript_tokens[i : i + size])
            score = fuzzy_ratio(target_name, candidate)
            if score > best:
                best = score

    return best


def _extract_no_from_text(text: str, donors: list[DonorRecord]) -> str | None:
    normalized = normalize_name(text)

    patterns = [
        r"\bBOLGE\s*NO\s*([0-9]{1,4})\b",
        r"\bNO\s*([0-9]{1,4})\b",
        r"\bBOLGE\s*NUMARASI\s*([0-9]{1,4})\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, normalized)
        if match:
            return match.group(1)

    known_nos = {str(d.no).strip() for d in donors if str(d.no).strip()}
    for number in re.findall(r"\b[0-9]{1,4}\b", normalized):
        if number in known_nos:
            return number

    return None


def _extract_no_from_transcript(transcript: str, donors: list[DonorRecord]) -> str | None:
    return _extract_no_from_text(transcript, donors)


def _extract_names_from_transcript(transcript: str, donors: list[DonorRecord], threshold: float) -> list[ExtractedName]:
    transcript_normalized = normalize_name(transcript)
    transcript_tokens = _tokenize_normalized(transcript)

    ranked: list[tuple[float, str, str]] = []
    seen: set[str] = set()

    for donor in donors:
        original_full = f"{donor.first_name} {donor.last_name}".strip()
        normalized_full = normalize_name(original_full)
        if not normalized_full or normalized_full in seen:
            continue

        if normalized_full in transcript_normalized:
            score = 1.0
        else:
            score = _best_window_similarity(normalized_full, transcript_tokens)

        if score >= threshold:
            seen.add(normalized_full)
            ranked.append((score, normalized_full, original_full))

    ranked.sort(key=lambda item: item[0], reverse=True)
    return [ExtractedName(full_name=original, source="audio", confidence=round(score, 2)) for score, _, original in ranked]


def _estimate_audio_clarity(transcript: str, extracted_name_count: int) -> float:
    words = len(transcript.split())
    score = 48.0
    if words >= 40:
        score += 30.0
    elif words >= 20:
        score += 21.0
    elif words >= 8:
        score += 12.0

    score += min(extracted_name_count, 8) * 2.6
    return max(30.0, min(96.0, round(score, 2)))


def _estimate_video_clarity(ocr_text: str, frame_count: int) -> float:
    words = len(ocr_text.split())
    score = 50.0
    if words >= 20:
        score += 26.0
    elif words >= 8:
        score += 16.0
    elif words >= 3:
        score += 9.0

    score += min(frame_count, 8) * 1.8
    return max(35.0, min(95.0, round(score, 2)))


def _shared_codefast_key() -> str | None:
    return (settings.codefast_api_key or settings.anthropic_api_key or "").strip() or None


def _provider_order() -> list[str]:
    raw = settings.ai_provider_order.strip() or "claude-main,glm-main,vertex-main"
    order = [x.strip().lower() for x in raw.split(",") if x.strip()]
    return order or ["claude-main", "glm-main", "vertex-main"]


def _build_prompt(submission: VideoSubmission, donors: list[DonorRecord]) -> str:
    unique_names: list[str] = []
    seen: set[str] = set()
    for donor in donors:
        full = f"{donor.first_name} {donor.last_name}".strip()
        n_full = normalize_name(full)
        if not n_full or n_full in seen:
            continue
        seen.add(n_full)
        unique_names.append(full)
        if len(unique_names) >= 220:
            break

    known_nos = sorted({str(d.no).strip() for d in donors if str(d.no).strip()})[:100]

    return (
        "Sen kurban kesim videosu kalite-asistani olarak calisiyorsun. "
        "Gorevin videodaki ses ve goruntuye bakip isimleri ve bolge NO bilgisini bulmak. "
        "Cevabi SADECE gecerli JSON olarak don. Aciklama yazma.\n\n"
        "JSON semasi:\n"
        "{\n"
        '  "transcript_text": "string",\n'
        '  "ocr_text": "string",\n'
        '  "extracted_no": "string veya null",\n'
        '  "extracted_names": ["AD SOYAD", "..."]\n'
        "}\n\n"
        "Kurallar:\n"
        "- transcript_text: sesli okumadan anladigin metin\n"
        "- ocr_text: ekranda gordugun yazi\n"
        "- extracted_no: NO bilgisini bulursan yaz\n"
        "- extracted_names: sadece kisi isimleri (AD SOYAD)\n"
        "- Emin degilsen null veya bos dizi don\n\n"
        f"Beklenen ulke/il/bolge: {submission.country} / {submission.city} / {submission.region}\n"
        f"Yukleyen kullanicinin girdigi NO: {submission.no}\n"
        f"Aday NO listesi: {', '.join(known_nos) if known_nos else '-'}\n"
        f"Aday isim listesi: {', '.join(unique_names) if unique_names else '-'}\n"
    )


def _clean_text_response(value: str) -> str:
    text = value.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _extract_json_payload(value: str) -> dict:
    clean = _clean_text_response(value)
    try:
        parsed = json.loads(clean)
        if isinstance(parsed, dict):
            return parsed
    except Exception:  # noqa: BLE001
        pass

    first = clean.find("{")
    last = clean.rfind("}")
    if first >= 0 and last > first:
        candidate = clean[first : last + 1]
        parsed = json.loads(candidate)
        if isinstance(parsed, dict):
            return parsed

    raise ProviderInvocationError("Model output is not valid JSON")


def _coerce_confidence(raw: object) -> float | None:
    if raw is None:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if value > 1:
        value = value / 100.0
    return max(0.0, min(1.0, value))


def _normalize_name_list(raw: object) -> list[ExtractedName]:
    if not isinstance(raw, list):
        return []

    names: list[ExtractedName] = []
    seen: set[str] = set()
    for item in raw:
        value = ""
        source = "audio"
        confidence: float | None = None
        if isinstance(item, str):
            value = item.strip()
        elif isinstance(item, dict):
            for key in ("full_name", "name", "ad_soyad"):
                v = item.get(key)
                if isinstance(v, str) and v.strip():
                    value = v.strip()
                    break
            maybe_source = item.get("source")
            if isinstance(maybe_source, str) and maybe_source.strip():
                source = maybe_source.strip().lower()
            confidence = _coerce_confidence(item.get("confidence"))

        if not value:
            continue

        normalized = normalize_name(value)
        if normalized in seen:
            continue
        seen.add(normalized)
        resolved_confidence = confidence if confidence is not None else 0.86
        names.append(
            ExtractedName(
                full_name=value,
                source=source,
                confidence=resolved_confidence,
                low_confidence=resolved_confidence < LOW_CONFIDENCE_THRESHOLD,
            )
        )

    return names


def _merge_to_extracted_names(
    transcript_text: str,
    ocr_text: str,
    names: list[ExtractedName],
    donors: list[DonorRecord],
) -> list[ExtractedName]:
    transcript_norm = normalize_name(transcript_text)
    ocr_norm = normalize_name(ocr_text)
    transcript_tokens = _tokenize_normalized(transcript_text)
    ocr_tokens = _tokenize_normalized(ocr_text)
    priority = {"both": 3, "audio": 2, "ocr": 1}
    merged: dict[str, ExtractedName] = {}

    def estimate_name_confidence(normalized_name: str) -> float:
        if not normalized_name:
            return 0.55
        scores: list[float] = []
        if normalized_name in transcript_norm:
            scores.append(0.97)
        if normalized_name in ocr_norm:
            scores.append(0.94)
        scores.append(_best_window_similarity(normalized_name, transcript_tokens))
        scores.append(_best_window_similarity(normalized_name, ocr_tokens))
        best = max(scores) if scores else 0.55
        return max(0.50, min(0.99, round(best, 2)))

    def pick_source(normalized_name: str, default_source: str) -> str:
        in_transcript = bool(normalized_name and normalized_name in transcript_norm)
        in_ocr = bool(normalized_name and normalized_name in ocr_norm)
        if in_transcript and in_ocr:
            return "both"
        if in_transcript:
            return "audio"
        if in_ocr:
            return "ocr"
        return default_source

    def add_name(full_name: str, default_source: str, confidence: float | None = None) -> None:
        clean = full_name.strip()
        normalized = normalize_name(clean)
        if not normalized or len(normalized.split()) < 2:
            return

        source = pick_source(normalized, default_source)
        resolved_confidence = confidence if confidence is not None else estimate_name_confidence(normalized)
        resolved_confidence = max(0.0, min(1.0, float(resolved_confidence)))
        existing = merged.get(normalized)
        if not existing:
            merged[normalized] = ExtractedName(
                full_name=clean,
                source=source,
                confidence=resolved_confidence,
                low_confidence=resolved_confidence < LOW_CONFIDENCE_THRESHOLD,
            )
            return

        best_confidence = max(existing.confidence, resolved_confidence)
        best_source = source if priority.get(source, 0) > priority.get(existing.source, 0) else existing.source
        merged[normalized] = ExtractedName(
            full_name=clean if priority.get(source, 0) >= priority.get(existing.source, 0) else existing.full_name,
            source=best_source,
            confidence=best_confidence,
            low_confidence=best_confidence < LOW_CONFIDENCE_THRESHOLD,
        )

    for item in names:
        add_name(item.full_name, item.source or "audio", item.confidence)

    for item in _extract_names_from_transcript(transcript_text, donors, threshold=settings.ai_name_detection_threshold):
        add_name(item.full_name, "audio", item.confidence)
    for item in _extract_names_from_transcript(ocr_text, donors, threshold=settings.ai_name_detection_threshold):
        add_name(item.full_name, "ocr", item.confidence)
    for item in _extract_names_from_transcript(
        f"{transcript_text}\n{ocr_text}",
        donors,
        threshold=settings.ai_name_detection_threshold,
    ):
        add_name(item.full_name, "both", item.confidence)

    return sorted(list(merged.values()), key=lambda x: x.confidence, reverse=True)


def _is_viable_output(output: AIAnalysisOutput) -> bool:
    has_names = len(output.extracted_names) > 0
    has_no = bool(output.extracted_no)
    transcript_words = len(output.transcript_text.split())
    has_transcript = transcript_words >= settings.ai_min_viable_transcript_words
    has_ocr = len(output.ocr_text.split()) >= 2
    return has_names and (has_no or has_transcript or has_ocr)


def _frame_to_jpeg_b64(frame: object) -> str:
    try:
        from PIL import Image
    except Exception as exc:  # noqa: BLE001
        raise ProviderInvocationError("Pillow is required for OCR frame encoding") from exc

    image = Image.fromarray(frame)
    if image.mode != "RGB":
        image = image.convert("RGB")

    buf = BytesIO()
    image.save(buf, format="JPEG", quality=settings.ai_frame_jpeg_quality, optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _sample_video_frame_b64(video_path: Path) -> list[str]:
    try:
        import imageio.v2 as imageio
    except Exception as exc:  # noqa: BLE001
        raise ProviderInvocationError("imageio is required for OCR frame extraction") from exc

    frame_limit = max(2, settings.ai_frame_sample_count)
    frames: list[object] = []
    reader = None
    try:
        reader = imageio.get_reader(str(video_path), "ffmpeg")
        frame_count = None
        try:
            frame_count = reader.count_frames()
        except Exception:  # noqa: BLE001
            frame_count = None

        if frame_count and frame_count > 0 and frame_count < 1_000_000:
            indices = sorted({int(i * (frame_count - 1) / max(1, frame_limit - 1)) for i in range(frame_limit)})
            for idx in indices:
                try:
                    frames.append(reader.get_data(idx))
                except Exception:  # noqa: BLE001
                    continue
        else:
            stride = 45
            for idx, frame in enumerate(reader):
                if idx % stride == 0:
                    frames.append(frame)
                if len(frames) >= frame_limit:
                    break

        if not frames:
            try:
                frames.append(reader.get_data(0))
            except Exception:  # noqa: BLE001
                pass
    finally:
        if reader is not None:
            reader.close()

    return [_frame_to_jpeg_b64(frame) for frame in frames[:frame_limit]]


def _parse_provider_output(
    provider_name: str,
    raw_text: str,
    submission: VideoSubmission,
    donors: list[DonorRecord],
    sampled_frame_count: int,
) -> AIAnalysisOutput:
    payload = _extract_json_payload(raw_text)

    transcript_text = str(payload.get("transcript_text") or "").strip()
    ocr_text = str(payload.get("ocr_text") or "").strip()

    extracted_no = payload.get("extracted_no")
    if extracted_no is not None:
        extracted_no = str(extracted_no).strip() or None

    if not extracted_no:
        extracted_no = _extract_no_from_text(f"{transcript_text}\n{ocr_text}", donors)
    if not extracted_no:
        extracted_no = str(submission.no).strip() if str(submission.no).strip() else None

    raw_names = _normalize_name_list(payload.get("extracted_names"))
    extracted_names = _merge_to_extracted_names(transcript_text, ocr_text, raw_names, donors)

    audio_clarity = _estimate_audio_clarity(transcript_text, len(extracted_names))
    video_clarity = _estimate_video_clarity(ocr_text, sampled_frame_count)

    return AIAnalysisOutput(
        transcript_text=transcript_text,
        ocr_text=ocr_text,
        extracted_no=extracted_no,
        extracted_names=extracted_names,
        audio_clarity=audio_clarity,
        video_clarity=video_clarity,
        analysis_mode=provider_name,
    )


def _call_claude_compatible_provider(
    *,
    provider_name: str,
    base_url: str,
    model: str,
    api_key: str,
    prompt: str,
    frame_images_b64: list[str],
) -> str:
    endpoint = f"{base_url.rstrip('/')}/v1/messages"
    content: list[dict] = [{"type": "text", "text": prompt}]
    for image_b64 in frame_images_b64:
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/jpeg",
                    "data": image_b64,
                },
            }
        )

    payload = {
        "model": model,
        "max_tokens": 1400,
        "temperature": 0,
        "messages": [{"role": "user", "content": content}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    with httpx.Client(timeout=120.0) as client:
        response = client.post(endpoint, headers=headers, json=payload)

    if response.status_code >= 400:
        raise ProviderInvocationError(
            f"{provider_name} HTTP {response.status_code}: {response.text[:260]}"
        )

    data = response.json()

    text_parts: list[str] = []
    for item in data.get("content", []):
        if isinstance(item, dict) and item.get("type") == "text":
            value = item.get("text")
            if isinstance(value, str) and value.strip():
                text_parts.append(value.strip())

    if not text_parts:
        try:
            choice_content = data["choices"][0]["message"]["content"]
            if isinstance(choice_content, str) and choice_content.strip():
                text_parts.append(choice_content.strip())
        except Exception:  # noqa: BLE001
            pass

    if not text_parts:
        raise ProviderInvocationError(f"{provider_name} returned empty text")

    return "\n".join(text_parts)


def _build_vertex_url(model: str, api_key: str) -> str:
    project_id = (settings.vertex_project_id or "").strip()
    location = (settings.vertex_location or "us-central1").strip() or "us-central1"

    if project_id:
        return (
            f"https://{location}-aiplatform.googleapis.com/v1/projects/{project_id}/locations/{location}"
            f"/publishers/google/models/{model}:generateContent?key={api_key}"
        )

    return f"https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent?key={api_key}"


def _call_vertex_model(
    *,
    model: str,
    api_key: str,
    prompt: str,
    frame_images_b64: list[str],
    video_path: Path,
) -> str:
    parts: list[dict] = [{"text": prompt}]

    file_size = video_path.stat().st_size
    if file_size <= settings.ai_vertex_inline_video_max_bytes:
        video_b64 = base64.b64encode(video_path.read_bytes()).decode("ascii")
        parts.append(
            {
                "inline_data": {
                    "mime_type": "video/mp4",
                    "data": video_b64,
                }
            }
        )

    for image_b64 in frame_images_b64[:4]:
        parts.append(
            {
                "inline_data": {
                    "mime_type": "image/jpeg",
                    "data": image_b64,
                }
            }
        )

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": parts,
            }
        ],
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": 1400,
        },
    }

    url = _build_vertex_url(model, api_key)
    with httpx.Client(timeout=180.0) as client:
        response = client.post(url, json=payload)

    if response.status_code >= 400:
        raise ProviderInvocationError(f"vertex-main/{model} HTTP {response.status_code}: {response.text[:260]}")

    data = response.json()
    text_parts: list[str] = []
    for candidate in data.get("candidates", []):
        content = candidate.get("content") if isinstance(candidate, dict) else None
        if not isinstance(content, dict):
            continue
        for part in content.get("parts", []):
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                value = part["text"].strip()
                if value:
                    text_parts.append(value)

    if not text_parts:
        raise ProviderInvocationError(f"vertex-main/{model} returned empty text")

    return "\n".join(text_parts)


def _call_vertex_provider(prompt: str, frame_images_b64: list[str], video_path: Path) -> str:
    api_key = (settings.vertex_api_key or settings.google_api_key or "").strip()
    if not api_key:
        raise ProviderInvocationError("vertex-main missing GOOGLE_API_KEY / VERTEX_API_KEY")

    models = [
        settings.vertex_main_model.strip() or "gemini-2.5-flash-lite",
        settings.vertex_fallback_model.strip() or "gemini-2.5-flash",
    ]

    errors: list[str] = []
    seen: set[str] = set()
    for model in models:
        if model in seen:
            continue
        seen.add(model)
        try:
            return _call_vertex_model(
                model=model,
                api_key=api_key,
                prompt=prompt,
                frame_images_b64=frame_images_b64,
                video_path=video_path,
            )
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{model}: {exc}")

    raise ProviderInvocationError(" | ".join(errors) if errors else "vertex-main failed")


def mock_ai_analyze(submission: VideoSubmission, donors: list[DonorRecord], *, reason: str | None = None) -> AIAnalysisOutput:
    extracted_names: list[ExtractedName] = []

    for donor in donors[:7]:
        full = f"{donor.first_name} {donor.last_name}".strip()
        if full:
            extracted_names.append(ExtractedName(full_name=full, source="audio", confidence=0.96))

    transcript_name_str = ", ".join(name.full_name for name in extracted_names)
    reason_text = f" (fallback: {reason})" if reason else ""
    transcript = (
        f"MOCK_ANALYSIS{reason_text}. Bolge no {submission.no}. "
        f"Kesim kaydinda gecen isimler: {transcript_name_str}."
    )
    ocr_text = f"MOCK_OCR BOLGE NO {submission.no}"

    return AIAnalysisOutput(
        transcript_text=transcript,
        ocr_text=ocr_text,
        extracted_no=submission.no,
        extracted_names=extracted_names,
        audio_clarity=70.0,
        video_clarity=75.0,
        analysis_mode="mock",
    )


def analyze_submission_video(submission: VideoSubmission, video_path: Path, donors: list[DonorRecord]) -> AIAnalysisOutput:
    provider_mode = settings.ai_provider.strip().lower()
    if provider_mode == "mock":
        return mock_ai_analyze(submission, donors, reason="AI_PROVIDER=mock")

    frame_images_b64 = _sample_video_frame_b64(video_path)
    prompt = _build_prompt(submission, donors)

    errors: list[str] = []
    codefast_key = _shared_codefast_key()

    for provider in _provider_order():
        try:
            if provider == "claude-main":
                if not codefast_key:
                    raise ProviderInvocationError("claude-main missing CODEFAST_API_KEY/ANTHROPIC_API_KEY")
                raw = _call_claude_compatible_provider(
                    provider_name=provider,
                    base_url=settings.claude_main_base_url,
                    model=settings.claude_main_model,
                    api_key=codefast_key,
                    prompt=prompt,
                    frame_images_b64=frame_images_b64,
                )
            elif provider == "glm-main":
                if not codefast_key:
                    raise ProviderInvocationError("glm-main missing CODEFAST_API_KEY/ANTHROPIC_API_KEY")
                raw = _call_claude_compatible_provider(
                    provider_name=provider,
                    base_url=settings.glm_main_base_url,
                    model=settings.glm_main_model,
                    api_key=codefast_key,
                    prompt=prompt,
                    frame_images_b64=frame_images_b64,
                )
            elif provider == "vertex-main":
                raw = _call_vertex_provider(prompt=prompt, frame_images_b64=frame_images_b64, video_path=video_path)
            else:
                errors.append(f"{provider}: unsupported provider")
                continue

            output = _parse_provider_output(
                provider_name=provider,
                raw_text=raw,
                submission=submission,
                donors=donors,
                sampled_frame_count=len(frame_images_b64),
            )
            if _is_viable_output(output):
                return output

            errors.append(f"{provider}: non-viable extraction")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{provider}: {exc}")

    if settings.ai_allow_mock_fallback:
        return mock_ai_analyze(submission, donors, reason=" | ".join(errors[-3:]))

    raise RuntimeError("AI provider chain failed: " + " | ".join(errors))
