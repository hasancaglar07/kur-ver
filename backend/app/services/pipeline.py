from __future__ import annotations

import json
import shutil
from collections import defaultdict
from pathlib import Path

from redis import Redis
from rq import Queue
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.config import get_settings
from app.core.roles import SubmissionStatus
from app.models import AnalysisResult, DonorRecord, MatchResult, VideoSubmission
from app.services.ai import analyze_submission_video
from app.services.audit import write_audit
from app.services.matching import match_names
from app.services.media import MediaValidationError, parse_mp4_duration_seconds
from app.services.scoring import calculate_quality_score
from app.services.storage import LocalStorageService

storage = LocalStorageService()
settings = get_settings()


def _process_submission(db: Session, submission: VideoSubmission) -> None:
    submission.status = SubmissionStatus.PROCESSING
    db.add(submission)
    db.commit()
    db.refresh(submission)

    raw_path = storage.raw_path(submission.raw_object_key)
    if not raw_path.exists():
        submission.status = SubmissionStatus.FAILED
        submission.failure_reason = "Raw video not found"
        write_audit(
            db,
            action="submission_failed",
            entity_type="video_submission",
            entity_id=str(submission.id),
            actor_id=None,
            org_id=submission.org_id,
            metadata={"stage": "raw_file_check", "error": submission.failure_reason},
        )
        db.commit()
        return

    try:
        duration = parse_mp4_duration_seconds(raw_path)
        submission.duration_seconds = duration
        if duration < settings.min_duration_seconds or duration > settings.max_duration_seconds:
            raise MediaValidationError(
                f"Video duration must be between {settings.min_duration_seconds}-{settings.max_duration_seconds} seconds"
            )

        # In production this should perform ffmpeg prepend and transcode.
        storage.ensure_intro()
        processed_key = f"processed_submission_{submission.id}.mp4"
        processed_path = storage.processed_path(processed_key)
        shutil.copy2(raw_path, processed_path)
        storage.upload_processed_archive(processed_path, processed_key)

        submission.processed_object_key = processed_key
        submission.intro_version = "v1"

        candidate_scope = (
            db.query(DonorRecord)
            .filter(
                DonorRecord.org_id == submission.org_id,
                DonorRecord.country == submission.country,
                DonorRecord.city == submission.city,
                DonorRecord.region == submission.region,
            )
            .all()
        )
        if not candidate_scope:
            candidate_scope = (
                db.query(DonorRecord)
                .filter(DonorRecord.org_id == submission.org_id, DonorRecord.no == submission.no)
                .all()
            )
        if not candidate_scope:
            candidate_scope = db.query(DonorRecord).filter(DonorRecord.org_id == submission.org_id).all()
        if not candidate_scope:
            raise RuntimeError("No donor records found. Import db.xlsx before processing videos")

        ai_output = analyze_submission_video(submission, raw_path, candidate_scope)

        model_extracted_no = (ai_output.extracted_no or "").strip()
        target_no = model_extracted_no or str(submission.no).strip()
        donors = [item for item in candidate_scope if str(item.no).strip() == str(target_no).strip()]
        if not donors:
            donors = [item for item in candidate_scope if str(item.no).strip() == str(submission.no).strip()]
        if not donors:
            donors = candidate_scope

        matches = match_names(donors, ai_output.extracted_names)
        inferred_no_from_names: str | None = None
        if not matches and ai_output.extracted_names:
            global_matches = match_names(candidate_scope, ai_output.extracted_names)
            if global_matches:
                donor_by_id = {item.id: item for item in candidate_scope}
                per_no: dict[str, list[float]] = defaultdict(list)
                for item in global_matches:
                    donor = donor_by_id.get(item.donor_id)
                    if not donor:
                        continue
                    per_no[str(donor.no).strip()].append(float(item.score))

                if per_no:
                    # Önce eşleşme adedi, sonra ortalama skor önceliği ile en güçlü NO adayını seç.
                    inferred_no_from_names = sorted(
                        per_no.items(),
                        key=lambda kv: (-len(kv[1]), -(sum(kv[1]) / len(kv[1]))),
                    )[0][0]
                    inferred_donors = [item for item in candidate_scope if str(item.no).strip() == inferred_no_from_names]
                    if inferred_donors:
                        inferred_matches = match_names(inferred_donors, ai_output.extracted_names)
                        if inferred_matches:
                            donors = inferred_donors
                            matches = inferred_matches
                            target_no = inferred_no_from_names
                            # Detay ekranında doğru donor grubunun açılması için efektif NO'yu güncelle.
                            ai_output.extracted_no = inferred_no_from_names

        quality_score = calculate_quality_score(
            total_candidates=len(donors),
            matched=matches,
            no_match=bool(model_extracted_no and model_extracted_no == str(target_no).strip()),
            audio_clarity=ai_output.audio_clarity,
            video_clarity=ai_output.video_clarity,
        )

        db.query(MatchResult).filter(MatchResult.submission_id == submission.id).delete()
        for item in matches:
            db.add(
                MatchResult(
                    submission_id=submission.id,
                    donor_record_id=item.donor_id,
                    org_id=submission.org_id,
                    match_type=item.match_type,
                    score=item.score,
                    evidence_source=item.evidence_source,
                )
            )

        existing_analysis = db.query(AnalysisResult).filter(AnalysisResult.submission_id == submission.id).first()
        payload_names = [
            {
                "full_name": x.full_name,
                "source": x.source,
                "confidence": x.confidence,
                "low_confidence": x.low_confidence,
            }
            for x in ai_output.extracted_names
        ]
        low_confidence_count = sum(1 for x in ai_output.extracted_names if x.low_confidence)
        payload_conf = {
            "analysis_mode": ai_output.analysis_mode,
            "audio_clarity": ai_output.audio_clarity,
            "video_clarity": ai_output.video_clarity,
            "matched_count": len(matches),
            "candidate_count": len(donors),
            "extracted_names_count": len(ai_output.extracted_names),
            "low_confidence_name_count": low_confidence_count,
            "input_no": submission.no,
            "model_extracted_no": model_extracted_no or None,
            "selected_no": target_no,
            "inferred_no_from_names": inferred_no_from_names,
        }

        if existing_analysis:
            existing_analysis.org_id = submission.org_id
            existing_analysis.transcript_text = ai_output.transcript_text
            existing_analysis.ocr_text = ai_output.ocr_text
            existing_analysis.extracted_no = ai_output.extracted_no
            existing_analysis.extracted_names_json = json.dumps(payload_names, ensure_ascii=False)
            existing_analysis.confidence_json = json.dumps(payload_conf, ensure_ascii=False)
            existing_analysis.quality_score = quality_score
        else:
            db.add(
                AnalysisResult(
                    submission_id=submission.id,
                    org_id=submission.org_id,
                    transcript_text=ai_output.transcript_text,
                    ocr_text=ai_output.ocr_text,
                    extracted_no=ai_output.extracted_no,
                    extracted_names_json=json.dumps(payload_names, ensure_ascii=False),
                    confidence_json=json.dumps(payload_conf, ensure_ascii=False),
                    quality_score=quality_score,
                )
            )

        extracted_no_for_check = (ai_output.extracted_no or "").strip()
        input_no = str(submission.no).strip()
        if extracted_no_for_check and extracted_no_for_check != input_no:
            raw_codes = []
            try:
                parsed = json.loads(submission.risk_codes_json) if submission.risk_codes_json else []
                if isinstance(parsed, list):
                    raw_codes = [str(item) for item in parsed]
            except Exception:  # noqa: BLE001
                raw_codes = []
            merged_codes = sorted(set(raw_codes + ["no_mismatch_ai_vs_operator"]))
            submission.risk_codes_json = json.dumps(merged_codes, ensure_ascii=False)
            submission.risk_locked = True
            submission.risk_lock_note = f"operator_no={input_no}, detected_no={extracted_no_for_check}"

        submission.status = SubmissionStatus.REVIEW_READY
        submission.failure_reason = None
        write_audit(
            db,
            action="submission_processed",
            entity_type="video_submission",
            entity_id=str(submission.id),
            actor_id=None,
            org_id=submission.org_id,
            metadata={"quality_score": quality_score},
        )
        db.commit()
    except MediaValidationError as exc:
        submission.status = SubmissionStatus.FAILED
        submission.failure_reason = str(exc)
        write_audit(
            db,
            action="submission_failed",
            entity_type="video_submission",
            entity_id=str(submission.id),
            actor_id=None,
            org_id=submission.org_id,
            metadata={"stage": "media_validation", "error": submission.failure_reason},
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001
        submission.status = SubmissionStatus.FAILED
        submission.failure_reason = f"Pipeline error: {exc}"
        write_audit(
            db,
            action="submission_failed",
            entity_type="video_submission",
            entity_id=str(submission.id),
            actor_id=None,
            org_id=submission.org_id,
            metadata={"stage": "pipeline_exception", "error": submission.failure_reason},
        )
        db.commit()


def process_submission_by_id(submission_id: int) -> None:
    db = SessionLocal()
    try:
        submission = db.query(VideoSubmission).filter(VideoSubmission.id == submission_id).first()
        if not submission:
            return
        _process_submission(db, submission)
    finally:
        db.close()


def enqueue_submission_processing(submission_id: int) -> None:
    queue_mode = settings.queue_mode.strip().lower()
    if queue_mode == "inline":
        process_submission_by_id(submission_id)
        return

    redis_conn = Redis.from_url(settings.redis_url)
    queue = Queue(name=settings.redis_queue_name, connection=redis_conn, default_timeout=settings.queue_job_timeout_seconds)
    queue.enqueue(
        "app.services.pipeline.process_submission_by_id",
        submission_id,
        job_timeout=settings.queue_job_timeout_seconds,
    )


def save_uploaded_file(source_file: Path, destination_key: str) -> None:
    destination = storage.raw_path(destination_key)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_file, destination)
    storage.upload_raw_archive(destination, destination_key)
