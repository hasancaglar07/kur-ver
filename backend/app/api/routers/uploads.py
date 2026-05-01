import hashlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import require_org_id, require_roles
from app.core.config import get_settings
from app.core.database import get_db
from app.core.roles import SubmissionChangeRequestStatus, SubmissionChangeRequestType, SubmissionStatus, UserRole
from app.models import AnalysisResult, AuditEvent, ReviewDecision, SubmissionChangeRequest, User, VideoSubmission
from app.schemas import (
    OperatorLogsResponse,
    OperatorLogsSummaryOut,
    SubmissionChangeRequestOut,
    SubmissionListItem,
    UploadCancelRequestIn,
    UploadCompleteResponse,
    UploadInitRequest,
    UploadInitResponse,
)
from app.services.audit import write_audit
from app.services.pipeline import enqueue_submission_processing
from app.services.storage import LocalStorageService

router = APIRouter(prefix="/uploads", tags=["uploads"])
storage = LocalStorageService()
settings = get_settings()
STALE_UPLOAD_TIMEOUT_MINUTES = 30
DUPLICATE_WINDOW_HOURS = 24
ALLOWED_UPLOAD_EXTENSIONS = {".mp4"}
ALLOWED_UPLOAD_CONTENT_TYPES = {"video/mp4", "application/mp4", "application/octet-stream"}
ADMIN_ACTIONS = {
    "submission_reviewed",
    "sms_dispatched",
    "sms_dispatched_single",
    "sms_dispatched_selected",
    "sms_retry_failed",
    "submission_change_request_resolved",
    "submission_risk_overridden",
}


def _parse_risk_codes(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
        if not isinstance(parsed, list):
            return []
        return [str(item) for item in parsed if str(item).strip()]
    except Exception:  # noqa: BLE001
        return []


def _latest_request_info(
    db: Session, submission_id: int, org_id: int
) -> tuple[SubmissionChangeRequestStatus | None, str | None, datetime | None, SubmissionChangeRequestType | None]:
    row = (
        db.query(SubmissionChangeRequest)
        .filter(
            SubmissionChangeRequest.submission_id == submission_id,
            SubmissionChangeRequest.org_id == org_id,
        )
        .order_by(SubmissionChangeRequest.created_at.desc())
        .first()
    )
    if not row:
        return None, None, None, None
    return row.status, row.admin_note, row.resolved_at, row.reason_type


def _latest_admin_action_info(
    db: Session, submission_id: int, org_id: int
) -> tuple[str | None, int | None, str | None, datetime | None]:
    row = (
        db.query(AuditEvent)
        .filter(
            AuditEvent.org_id == org_id,
            AuditEvent.entity_type == "video_submission",
            AuditEvent.entity_id == str(submission_id),
            AuditEvent.actor_id.isnot(None),
            AuditEvent.action.in_(ADMIN_ACTIONS),
        )
        .order_by(AuditEvent.created_at.desc())
        .first()
    )
    if not row:
        return None, None, None, None
    actor = db.query(User).filter(User.id == row.actor_id, User.org_id == org_id).first() if row.actor_id else None
    return row.action, row.actor_id, actor.username if actor else None, row.created_at


def _mark_stale_uploads(db: Session, org_id: int) -> None:
    cutoff = datetime.now(UTC) - timedelta(minutes=STALE_UPLOAD_TIMEOUT_MINUTES)
    stale_rows = (
        db.query(VideoSubmission)
        .filter(
            VideoSubmission.org_id == org_id,
            VideoSubmission.status == SubmissionStatus.UPLOADED,
            VideoSubmission.created_at <= cutoff,
            VideoSubmission.upload_completed_at.is_(None),
        )
        .all()
    )
    if not stale_rows:
        return

    for row in stale_rows:
        row.status = SubmissionStatus.FAILED
        row.failure_reason = "upload_abandoned_timeout_30m"
        db.add(row)
        write_audit(
            db,
            action="upload_abandoned_timeout",
            entity_type="video_submission",
            entity_id=str(row.id),
            actor_id=None,
            org_id=org_id,
            metadata={"timeout_minutes": STALE_UPLOAD_TIMEOUT_MINUTES},
        )
    db.commit()


def _build_submission_context_maps(
    db: Session,
    org_id: int,
    submission_ids: list[int],
) -> tuple[
    dict[int, AnalysisResult],
    dict[int, ReviewDecision],
    dict[int, tuple[SubmissionChangeRequestStatus | None, str | None, datetime | None, SubmissionChangeRequestType | None]],
    dict[int, tuple[str | None, int | None, str | None, datetime | None]],
    dict[int, tuple[str | None, str | None, str | None]],
]:
    if not submission_ids:
        return {}, {}, {}, {}, {}

    analyses = (
        db.query(AnalysisResult)
        .filter(AnalysisResult.org_id == org_id, AnalysisResult.submission_id.in_(submission_ids))
        .all()
    )
    analysis_by_submission_id = {row.submission_id: row for row in analyses}

    reviews = (
        db.query(ReviewDecision)
        .filter(ReviewDecision.org_id == org_id, ReviewDecision.submission_id.in_(submission_ids))
        .all()
    )
    review_by_submission_id = {row.submission_id: row for row in reviews}

    requests = (
        db.query(SubmissionChangeRequest)
        .filter(SubmissionChangeRequest.org_id == org_id, SubmissionChangeRequest.submission_id.in_(submission_ids))
        .order_by(SubmissionChangeRequest.created_at.desc())
        .all()
    )
    latest_request_by_submission_id: dict[
        int,
        tuple[SubmissionChangeRequestStatus | None, str | None, datetime | None, SubmissionChangeRequestType | None],
    ] = {}
    for row in requests:
        if row.submission_id in latest_request_by_submission_id:
            continue
        latest_request_by_submission_id[row.submission_id] = (
            row.status,
            row.admin_note,
            row.resolved_at,
            row.reason_type,
        )

    try:
        audit_rows = (
            db.query(AuditEvent)
            .filter(
                AuditEvent.org_id == org_id,
                AuditEvent.entity_type == "video_submission",
                AuditEvent.entity_id.in_([str(item) for item in submission_ids]),
                AuditEvent.actor_id.isnot(None),
                AuditEvent.action.in_(ADMIN_ACTIONS),
            )
            .order_by(AuditEvent.created_at.desc())
            .all()
        )
    except SQLAlchemyError:
        # Corrupt audit rows should not block operator log listing.
        audit_rows = []
    actor_ids = sorted({row.actor_id for row in audit_rows if row.actor_id is not None})
    actor_usernames = {
        row.id: row.username
        for row in db.query(User.id, User.username).filter(User.org_id == org_id, User.id.in_(actor_ids)).all()
    }
    latest_admin_action_by_submission_id: dict[int, tuple[str | None, int | None, str | None, datetime | None]] = {}
    for row in audit_rows:
        try:
            submission_id = int(row.entity_id)
        except ValueError:
            continue
        if submission_id in latest_admin_action_by_submission_id:
            continue
        latest_admin_action_by_submission_id[submission_id] = (
            row.action,
            row.actor_id,
            actor_usernames.get(row.actor_id) if row.actor_id is not None else None,
            row.created_at,
        )

    uploader_ids = sorted(set(submission.uploader_id for submission in db.query(VideoSubmission).filter(VideoSubmission.id.in_(submission_ids)).all()))
    uploader_rows = db.query(User).filter(User.org_id == org_id, User.id.in_(uploader_ids)).all() if uploader_ids else []
    uploader_map: dict[int, tuple[str | None, str | None, str | None]] = {}
    for row in uploader_rows:
        uploader_map[row.id] = (row.username, row.first_name, row.last_name)

    return (
        analysis_by_submission_id,
        review_by_submission_id,
        latest_request_by_submission_id,
        latest_admin_action_by_submission_id,
        uploader_map,
    )


@router.post("/init", response_model=UploadInitResponse)
def upload_init(
    payload: UploadInitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(UserRole.OPERATOR, UserRole.SUPER_ADMIN)),
) -> UploadInitResponse:
    org_id = require_org_id(user)
    if user.role == UserRole.OPERATOR:
        assigned = (user.country, user.city, user.region)
        provided = (payload.country, payload.city, payload.region)
        if all(assigned) and assigned != provided:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Operator can only upload within assigned country/city/region",
            )

    ext = Path(payload.original_filename).suffix.lower() or ".mp4"
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only .mp4 uploads are supported")
    raw_key = f"raw_submission_{uuid4()}{ext}"

    submission = VideoSubmission(
        uploader_id=user.id,
        org_id=org_id,
        country=payload.country,
        city=payload.city,
        region=payload.region,
        no=payload.no,
        title=payload.title,
        note=payload.note,
        raw_object_key=raw_key,
        status=SubmissionStatus.UPLOADED,
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)

    write_audit(
        db,
        action="upload_init",
        entity_type="video_submission",
        entity_id=str(submission.id),
        actor_id=user.id,
        org_id=org_id,
        metadata={"raw_object_key": raw_key},
    )
    db.commit()

    return UploadInitResponse(
        submission_id=submission.id,
        upload_path=f"/api/uploads/{submission.id}/file",
        raw_object_key=raw_key,
        status=submission.status,
    )


@router.post("/{submission_id}/file")
def upload_file(
    submission_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(UserRole.OPERATOR, UserRole.SUPER_ADMIN)),
) -> dict:
    org_id = require_org_id(user)
    submission = db.query(VideoSubmission).filter(VideoSubmission.id == submission_id, VideoSubmission.org_id == org_id).first()
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    if submission.uploader_id != user.id and user.role == UserRole.OPERATOR:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot upload for another operator")
    if submission.status != SubmissionStatus.UPLOADED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Submission is not in upload state")
    if submission.upload_completed_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Submission already has completed upload")

    ext = Path(submission.raw_object_key).suffix.lower() or ".mp4"
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported upload extension")
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type and content_type not in ALLOWED_UPLOAD_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Only MP4 content type is supported")

    destination = storage.raw_path(submission.raw_object_key)
    destination.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    total_bytes = 0
    with destination.open("wb") as out:
        while chunk := file.file.read(1024 * 1024):
            total_bytes += len(chunk)
            if total_bytes > settings.max_upload_size_bytes:
                out.close()
                destination.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"Upload size exceeds limit ({settings.max_upload_size_bytes} bytes)",
                )
            out.write(chunk)
            digest.update(chunk)
    if total_bytes == 0:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")

    try:
        storage.upload_raw_archive(destination, submission.raw_object_key)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Video archive upload failed: {exc}") from exc

    submission.file_sha256 = digest.hexdigest()
    submission.file_size_bytes = total_bytes
    submission.upload_completed_at = datetime.now(UTC)

    risk_codes: list[str] = []
    duplicate_by_hash = (
        db.query(VideoSubmission.id)
        .filter(
            VideoSubmission.org_id == org_id,
            VideoSubmission.id != submission.id,
            VideoSubmission.file_sha256 == submission.file_sha256,
        )
        .first()
    )
    if duplicate_by_hash:
        risk_codes.append("duplicate_hash")

    since = datetime.now(UTC) - timedelta(hours=DUPLICATE_WINDOW_HOURS)
    duplicate_rule = (
        db.query(VideoSubmission.id)
        .filter(
            VideoSubmission.org_id == org_id,
            VideoSubmission.id != submission.id,
            VideoSubmission.uploader_id == submission.uploader_id,
            VideoSubmission.no == submission.no,
            VideoSubmission.country == submission.country,
            VideoSubmission.city == submission.city,
            VideoSubmission.region == submission.region,
            VideoSubmission.created_at >= since,
        )
        .first()
    )
    if duplicate_rule:
        risk_codes.append("duplicate_operator_no_region_24h")

    if risk_codes:
        existing_codes = _parse_risk_codes(submission.risk_codes_json)
        merged = sorted(set(existing_codes + risk_codes))
        submission.risk_locked = True
        submission.risk_codes_json = json.dumps(merged, ensure_ascii=False)
        submission.risk_lock_note = "auto_duplicate_detection"
        write_audit(
            db,
            action="submission_risk_locked",
            entity_type="video_submission",
            entity_id=str(submission.id),
            actor_id=user.id,
            org_id=org_id,
            metadata={"risk_codes": merged},
        )

    db.add(submission)
    db.commit()

    return {"submission_id": submission_id, "raw_object_key": submission.raw_object_key, "stored": True}


@router.post("/{submission_id}/complete", response_model=UploadCompleteResponse)
def upload_complete(
    submission_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(UserRole.OPERATOR, UserRole.SUPER_ADMIN)),
) -> UploadCompleteResponse:
    org_id = require_org_id(user)
    submission = db.query(VideoSubmission).filter(VideoSubmission.id == submission_id, VideoSubmission.org_id == org_id).first()
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    if submission.uploader_id != user.id and user.role == UserRole.OPERATOR:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot complete another operator submission")
    if submission.status != SubmissionStatus.UPLOADED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Submission is not in upload state")
    if submission.upload_completed_at is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload file step has not completed")

    if not storage.raw_path(submission.raw_object_key).exists():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Video file has not been uploaded")

    submission.status = SubmissionStatus.PROCESSING
    db.add(submission)
    write_audit(
        db,
        action="upload_complete",
        entity_type="video_submission",
        entity_id=str(submission.id),
        actor_id=user.id,
        org_id=org_id,
        metadata={"trigger": "manual_complete"},
    )
    db.commit()

    enqueue_submission_processing(submission.id)
    return UploadCompleteResponse(submission_id=submission.id, status=submission.status)


@router.get("/mine", response_model=list[SubmissionListItem])
def list_my_uploads(
    limit: int = 20,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(UserRole.OPERATOR, UserRole.SUPER_ADMIN)),
) -> list[SubmissionListItem]:
    org_id = require_org_id(user)
    _mark_stale_uploads(db, org_id)
    safe_limit = max(1, min(limit, 100))
    query = db.query(VideoSubmission).filter(VideoSubmission.org_id == org_id)
    if user.role == UserRole.OPERATOR:
        query = query.filter(VideoSubmission.uploader_id == user.id)
    rows = query.order_by(VideoSubmission.created_at.desc()).limit(safe_limit).all()
    submission_ids = [row.id for row in rows]
    (
        analysis_by_submission_id,
        review_by_submission_id,
        latest_request_by_submission_id,
        latest_admin_action_by_submission_id,
        uploader_map,
    ) = _build_submission_context_maps(db, org_id, submission_ids)

    output: list[SubmissionListItem] = []
    for row in rows:
        analysis = analysis_by_submission_id.get(row.id)
        review = review_by_submission_id.get(row.id)
        latest_request_status, latest_request_admin_note, latest_request_resolved_at, latest_request_reason_type = latest_request_by_submission_id.get(
            row.id, (None, None, None, None)
        )
        last_admin_action, last_admin_actor_id, last_admin_actor_username, last_admin_action_at = latest_admin_action_by_submission_id.get(
            row.id, (None, None, None, None)
        )
        uploader_username, uploader_first_name, uploader_last_name = uploader_map.get(row.uploader_id, (None, None, None))
        uploader_full_name = " ".join(part for part in [uploader_first_name, uploader_last_name] if part).strip() or None
        output.append(
            SubmissionListItem(
                id=row.id,
                country=row.country,
                city=row.city,
                region=row.region,
                no=row.no,
                title=row.title,
                note=row.note,
                uploader_username=uploader_username,
                uploader_full_name=uploader_full_name,
                status=row.status,
                quality_score=analysis.quality_score if analysis else None,
                sms_sent_count=0,
                sms_failed_count=0,
                sms_pending_count=0,
                sms_last_status=None,
                preview_watch_url=storage.build_signed_watch_url(row.processed_object_key) if row.processed_object_key else None,
                duration_seconds=row.duration_seconds,
                failure_reason=row.failure_reason,
                review_decision=review.decision if review else None,
                review_note=review.decision_note if review else None,
                risk_locked=row.risk_locked,
                risk_codes=_parse_risk_codes(row.risk_codes_json),
                risk_lock_note=row.risk_lock_note,
                latest_request_status=latest_request_status,
                latest_request_admin_note=latest_request_admin_note,
                latest_request_resolved_at=latest_request_resolved_at,
                latest_request_reason_type=latest_request_reason_type,
                last_admin_action=last_admin_action,
                last_admin_actor_id=last_admin_actor_id,
                last_admin_actor_username=last_admin_actor_username,
                last_admin_action_at=last_admin_action_at,
                created_at=row.created_at,
            )
        )

    return output


@router.get("/mine/logs", response_model=OperatorLogsResponse)
def list_my_upload_logs(
    limit: int = 50,
    offset: int = 0,
    status_filter: SubmissionStatus | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(UserRole.OPERATOR, UserRole.SUPER_ADMIN)),
) -> OperatorLogsResponse:
    org_id = require_org_id(user)
    _mark_stale_uploads(db, org_id)

    safe_limit = max(1, min(limit, 100))
    safe_offset = max(0, offset)

    query = db.query(VideoSubmission).filter(VideoSubmission.org_id == org_id)
    if user.role == UserRole.OPERATOR:
        query = query.filter(VideoSubmission.uploader_id == user.id)
    if status_filter:
        query = query.filter(VideoSubmission.status == status_filter)
    if date_from:
        query = query.filter(VideoSubmission.created_at >= date_from)
    if date_to:
        query = query.filter(VideoSubmission.created_at <= date_to)

    all_rows = query.order_by(VideoSubmission.created_at.desc()).all()
    paged_rows = all_rows[safe_offset : safe_offset + safe_limit]
    paged_submission_ids = [row.id for row in paged_rows]
    (
        analysis_by_submission_id,
        review_by_submission_id,
        latest_request_by_submission_id,
        latest_admin_action_by_submission_id,
        uploader_map,
    ) = _build_submission_context_maps(db, org_id, paged_submission_ids)

    by_region: dict[str, int] = {}
    by_status: dict[str, int] = {}
    durations: list[float] = []
    for row in all_rows:
        by_region[row.region] = by_region.get(row.region, 0) + 1
        key = row.status.value
        by_status[key] = by_status.get(key, 0) + 1
        if row.duration_seconds is not None:
            durations.append(float(row.duration_seconds))

    summary = OperatorLogsSummaryOut(
        total_uploads=len(all_rows),
        avg_duration_seconds=round(sum(durations) / len(durations), 2) if durations else None,
        by_region=by_region,
        by_status=by_status,
    )

    items: list[SubmissionListItem] = []
    for row in paged_rows:
        analysis = analysis_by_submission_id.get(row.id)
        review = review_by_submission_id.get(row.id)
        latest_request_status, latest_request_admin_note, latest_request_resolved_at, latest_request_reason_type = latest_request_by_submission_id.get(
            row.id, (None, None, None, None)
        )
        last_admin_action, last_admin_actor_id, last_admin_actor_username, last_admin_action_at = latest_admin_action_by_submission_id.get(
            row.id, (None, None, None, None)
        )
        uploader_username, uploader_first_name, uploader_last_name = uploader_map.get(row.uploader_id, (None, None, None))
        uploader_full_name = " ".join(part for part in [uploader_first_name, uploader_last_name] if part).strip() or None
        items.append(
            SubmissionListItem(
                id=row.id,
                country=row.country,
                city=row.city,
                region=row.region,
                no=row.no,
                title=row.title,
                note=row.note,
                uploader_username=uploader_username,
                uploader_full_name=uploader_full_name,
                status=row.status,
                quality_score=analysis.quality_score if analysis else None,
                sms_sent_count=0,
                sms_failed_count=0,
                sms_pending_count=0,
                sms_last_status=None,
                preview_watch_url=storage.build_signed_watch_url(row.processed_object_key) if row.processed_object_key else None,
                duration_seconds=row.duration_seconds,
                failure_reason=row.failure_reason,
                review_decision=review.decision if review else None,
                review_note=review.decision_note if review else None,
                risk_locked=row.risk_locked,
                risk_codes=_parse_risk_codes(row.risk_codes_json),
                risk_lock_note=row.risk_lock_note,
                latest_request_status=latest_request_status,
                latest_request_admin_note=latest_request_admin_note,
                latest_request_resolved_at=latest_request_resolved_at,
                latest_request_reason_type=latest_request_reason_type,
                last_admin_action=last_admin_action,
                last_admin_actor_id=last_admin_actor_id,
                last_admin_actor_username=last_admin_actor_username,
                last_admin_action_at=last_admin_action_at,
                created_at=row.created_at,
            )
        )

    return OperatorLogsResponse(summary=summary, items=items)


@router.post("/{submission_id}/requests/cancel", response_model=SubmissionChangeRequestOut)
def create_upload_cancel_request(
    submission_id: int,
    payload: UploadCancelRequestIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(UserRole.OPERATOR, UserRole.SUPER_ADMIN)),
) -> SubmissionChangeRequestOut:
    org_id = require_org_id(user)
    submission = db.query(VideoSubmission).filter(VideoSubmission.id == submission_id, VideoSubmission.org_id == org_id).first()
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    if user.role == UserRole.OPERATOR and submission.uploader_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot request cancel for another operator submission")

    open_request = (
        db.query(SubmissionChangeRequest)
        .filter(
            SubmissionChangeRequest.submission_id == submission_id,
            SubmissionChangeRequest.org_id == org_id,
            SubmissionChangeRequest.status == SubmissionChangeRequestStatus.OPEN,
        )
        .first()
    )
    if open_request:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Open request already exists for this submission")

    request_row = SubmissionChangeRequest(
        submission_id=submission.id,
        operator_id=submission.uploader_id,
        org_id=org_id,
        reason_type=payload.reason_type,
        note=payload.note.strip(),
        status=SubmissionChangeRequestStatus.OPEN,
    )
    db.add(request_row)

    existing_codes = _parse_risk_codes(submission.risk_codes_json)
    merged_codes = sorted(set(existing_codes + ["operator_cancel_request"]))
    submission.risk_locked = True
    submission.risk_codes_json = json.dumps(merged_codes, ensure_ascii=False)
    submission.risk_lock_note = "operator_requested_cancel_or_duplicate"
    db.add(submission)

    write_audit(
        db,
        action="submission_change_request_created",
        entity_type="video_submission",
        entity_id=str(submission.id),
        actor_id=user.id,
        org_id=org_id,
        metadata={"reason_type": payload.reason_type.value, "note": payload.note.strip()},
    )
    db.commit()
    db.refresh(request_row)

    operator = db.query(User).filter(User.id == request_row.operator_id).first()
    return SubmissionChangeRequestOut(
        id=request_row.id,
        submission_id=request_row.submission_id,
        operator_id=request_row.operator_id,
        operator_username=operator.username if operator else None,
        submission_no=submission.no,
        submission_region=submission.region,
        reason_type=request_row.reason_type,
        note=request_row.note,
        status=request_row.status,
        admin_note=request_row.admin_note,
        resolved_by=request_row.resolved_by,
        resolved_at=request_row.resolved_at,
        created_at=request_row.created_at,
    )
