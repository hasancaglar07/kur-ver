import json
import hashlib
import hmac
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import require_org_id, require_roles
from app.core.config import get_settings
from app.core.database import get_db
from app.core.roles import (
    ReviewDecisionType,
    SmsStatus,
    SubmissionChangeRequestStatus,
    SubmissionChangeRequestType,
    SubmissionStatus,
    UserRole,
)
from app.models import (
    AnalysisResult,
    AuditEvent,
    DonorRecord,
    MatchResult,
    ReviewDecision,
    SmsMessage,
    SubmissionChangeRequest,
    User,
    VideoSubmission,
)
from app.schemas import (
    AdminActionLogOut,
    AdminLogsResponse,
    AuditEventOut,
    DonorMatchOut,
    ExtractedNameOut,
    FailedSubmissionOut,
    MatchResultOut,
    MatchOverrideRequest,
    MatchOverrideResponse,
    OpsOverviewResponse,
    SmsBulkDispatchRequest,
    SmsBulkDispatchResponse,
    ReviewRequest,
    ReviewResponse,
    SubmissionNoUpdateRequest,
    SubmissionNoUpdateResponse,
    SmsDispatchResponse,
    SmsSingleDispatchRequest,
    SmsSingleDispatchResponse,
    SmsMessageOut,
    SubmissionDetail,
    SubmissionChangeRequestOut,
    SubmissionChangeRequestResolveIn,
    SubmissionListItem,
    RiskOverrideRequest,
    SubmissionClaimRequest,
    SubmissionClaimResponse,
)
from app.services.audit import write_audit
from app.services.matching import ExtractedName, match_names
from app.services.sms import get_sms_provider
from app.services.storage import LocalStorageService

router = APIRouter(prefix="/submissions", tags=["submissions"])
storage = LocalStorageService()
settings = get_settings()
ALLOWED_SMS_FILTERS = {"sent", "failed", "pending", "none"}
ALLOWED_CLAIM_FILTERS = {"none", "active", "mine", "other"}
STALE_UPLOAD_TIMEOUT_MINUTES = 30
CLAIM_TTL_MINUTES = 5
REVIEW_READY_SLA_MINUTES = 20
PROCESSING_SLA_MINUTES = 15
UPLOADED_SLA_MINUTES = 10
ADMIN_ACTIONS = {
    "submission_reviewed",
    "sms_dispatched",
    "sms_dispatched_single",
    "sms_dispatched_selected",
    "sms_retry_failed",
    "submission_change_request_resolved",
    "submission_risk_overridden",
}
SOFT_DELETED_NOTE = "__soft_deleted_by_super_admin__"


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _masked_phone(value: str) -> str:
    v = "".join(ch for ch in value if ch.isdigit())
    if len(v) < 4:
        return "****"
    return f"***{v[-4:]}"


def _normalized_digits(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit())


def _resolve_effective_no(submission: VideoSubmission, analysis: AnalysisResult | None) -> str:
    if analysis and analysis.extracted_no and analysis.extracted_no.strip():
        return analysis.extracted_no.strip()
    return str(submission.no).strip()


def _load_submission_donors(
    db: Session,
    submission: VideoSubmission,
    analysis: AnalysisResult | None,
) -> tuple[list[DonorRecord], str]:
    effective_no = _resolve_effective_no(submission, analysis)

    def by_no(no_value: str) -> list[DonorRecord]:
        rows = (
            db.query(DonorRecord)
            .filter(
                DonorRecord.org_id == submission.org_id,
                DonorRecord.no == no_value,
                DonorRecord.country == submission.country,
                DonorRecord.city == submission.city,
                DonorRecord.region == submission.region,
            )
            .all()
        )
        if rows:
            return rows
        return db.query(DonorRecord).filter(DonorRecord.org_id == submission.org_id, DonorRecord.no == no_value).all()

    donors = by_no(effective_no)
    if not donors and effective_no != str(submission.no).strip():
        donors = by_no(str(submission.no).strip())
        effective_no = str(submission.no).strip()

    return donors, effective_no


def _send_and_log_single_sms(
    *,
    db: Session,
    provider,
    submission: VideoSubmission,
    phone: str,
    message_text: str,
) -> tuple[SmsMessage, int]:
    normalized_phone = phone.strip()
    max_attempts = 3
    attempts = 0
    result = None
    while attempts < max_attempts:
        attempts += 1
        result = provider.send(phone=normalized_phone, message=message_text)
        if result.ok:
            break

    if result is None:
        raise RuntimeError("SMS provider returned no result")

    sms_row = SmsMessage(
        submission_id=submission.id,
        org_id=submission.org_id,
        phone=_masked_phone(normalized_phone),
        status=SmsStatus.SENT if result.ok else SmsStatus.FAILED,
        provider_ref=result.provider_ref,
        message_text=message_text,
    )
    db.add(sms_row)
    return sms_row, attempts


def _has_successful_sms(db: Session, submission_id: int, phone: str) -> bool:
    masked_phone = _masked_phone(phone)
    existing = (
        db.query(SmsMessage)
        .filter(
            SmsMessage.submission_id == submission_id,
            SmsMessage.phone == masked_phone,
            SmsMessage.status == SmsStatus.SENT,
        )
        .first()
    )
    return existing is not None


def _parse_metadata_json(value: str) -> dict:
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


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


def _submission_sms_stats(db: Session, submission_id: int) -> tuple[int, int, int, str | None]:
    rows = (
        db.query(SmsMessage.status)
        .filter(SmsMessage.submission_id == submission_id)
        .order_by(SmsMessage.created_at.desc())
        .all()
    )
    statuses = [row.status for row in rows]
    sent_count = sum(1 for status_value in statuses if status_value == SmsStatus.SENT)
    failed_count = sum(1 for status_value in statuses if status_value == SmsStatus.FAILED)
    pending_count = sum(1 for status_value in statuses if status_value == SmsStatus.PENDING)
    last_status = statuses[0].value if statuses else None
    return sent_count, failed_count, pending_count, last_status


def _build_submission_maps(
    db: Session,
    org_id: int,
    submission_ids: list[int],
) -> tuple[
    dict[int, AnalysisResult],
    dict[int, ReviewDecision],
    dict[int, tuple[int, int, int, str | None]],
    dict[int, tuple[SubmissionChangeRequestStatus | None, str | None, datetime | None, SubmissionChangeRequestType | None]],
    dict[int, tuple[str | None, int | None, str | None, datetime | None]],
    dict[int, tuple[str | None, str | None, str | None]],
]:
    if not submission_ids:
        return {}, {}, {}, {}, {}, {}

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

    sms_rows = (
        db.query(SmsMessage.submission_id, SmsMessage.status, SmsMessage.created_at)
        .filter(SmsMessage.org_id == org_id, SmsMessage.submission_id.in_(submission_ids))
        .order_by(SmsMessage.created_at.desc())
        .all()
    )
    sms_stats: dict[int, tuple[int, int, int, str | None]] = {}
    sms_counters: dict[int, dict[str, int]] = {}
    for row in sms_rows:
        stats = sms_counters.setdefault(row.submission_id, {"sent": 0, "failed": 0, "pending": 0})
        status_value = row.status.value
        if status_value in stats:
            stats[status_value] += 1
        if row.submission_id not in sms_stats:
            sms_stats[row.submission_id] = (0, 0, 0, status_value)
    for submission_id in submission_ids:
        counts = sms_counters.get(submission_id, {"sent": 0, "failed": 0, "pending": 0})
        _, _, _, last_status = sms_stats.get(submission_id, (0, 0, 0, None))
        sms_stats[submission_id] = (counts["sent"], counts["failed"], counts["pending"], last_status)

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
        latest_request_by_submission_id[row.submission_id] = (row.status, row.admin_note, row.resolved_at, row.reason_type)

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
        # Corrupt audit rows should not block queue listing.
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

    uploader_ids = sorted(
        {
            row.uploader_id
            for row in db.query(VideoSubmission.id, VideoSubmission.uploader_id)
            .filter(VideoSubmission.id.in_(submission_ids))
            .all()
        }
    )
    uploader_map: dict[int, tuple[str | None, str | None, str | None]] = {}
    if uploader_ids:
        uploader_rows = db.query(User).filter(User.org_id == org_id, User.id.in_(uploader_ids)).all()
        for row in uploader_rows:
            uploader_map[row.id] = (row.username, row.first_name, row.last_name)

    return (
        analysis_by_submission_id,
        review_by_submission_id,
        sms_stats,
        latest_request_by_submission_id,
        latest_admin_action_by_submission_id,
        uploader_map,
    )


def _build_short_watch_url(submission_id: int) -> str:
    sid = _to_base36(submission_id)
    data = f"share:{sid}".encode("utf-8")
    sig = hmac.new(settings.signed_url_secret.encode("utf-8"), data, hashlib.sha256).hexdigest()[:8]
    token = f"{sid}-{sig}"
    return f"{settings.public_share_base_url}/izle/{token}"


def _build_sms_text(submission: VideoSubmission) -> str:
    watch_url = _build_short_watch_url(submission.id)
    return f"Kurbaniniz kesilmistir. Videonuzu bu link uzerinden izleyebilirsiniz: {watch_url}"


def _to_base36(value: int) -> str:
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    if value <= 0:
        return "0"
    out = []
    current = value
    while current:
        current, rem = divmod(current, 36)
        out.append(alphabet[rem])
    return "".join(reversed(out))


def _get_submission_for_org(db: Session, submission_id: int, org_id: int) -> VideoSubmission | None:
    return db.query(VideoSubmission).filter(VideoSubmission.id == submission_id, VideoSubmission.org_id == org_id).first()


def _is_claim_active(submission: VideoSubmission) -> bool:
    claim_expires_at = _as_utc(submission.claim_expires_at)
    return (
        submission.claim_admin_id is not None
        and claim_expires_at is not None
        and claim_expires_at > datetime.now(UTC)
    )


def _latest_admin_action_info(
    db: Session, submission_id: int, org_id: int
) -> tuple[str | None, int | None, str | None, datetime | None]:
    try:
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
    except SQLAlchemyError:
        return None, None, None, None
    if not row:
        return None, None, None, None
    actor = db.query(User).filter(User.id == row.actor_id, User.org_id == org_id).first() if row.actor_id else None
    return row.action, row.actor_id, actor.username if actor else None, row.created_at


def _assert_claim_available(submission: VideoSubmission, actor: User) -> None:
    if not _is_claim_active(submission):
        return
    if submission.claim_admin_id == actor.id:
        return
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"Submission is currently claimed by admin #{submission.claim_admin_id} until {submission.claim_expires_at.isoformat()}",
    )


def _resolve_sla_due_at(submission: VideoSubmission) -> datetime | None:
    if submission.status == SubmissionStatus.REVIEW_READY:
        return submission.created_at + timedelta(minutes=REVIEW_READY_SLA_MINUTES)
    if submission.status == SubmissionStatus.PROCESSING:
        return submission.created_at + timedelta(minutes=PROCESSING_SLA_MINUTES)
    if submission.status == SubmissionStatus.UPLOADED:
        return submission.created_at + timedelta(minutes=UPLOADED_SLA_MINUTES)
    return None


def _compute_submission_priority_score(
    submission: VideoSubmission,
    now: datetime,
    latest_request_status: SubmissionChangeRequestStatus | None,
) -> tuple[float, datetime | None, bool, int]:
    created_at = _as_utc(submission.created_at) or now
    created_age_minutes = max(0, int((now - created_at).total_seconds() // 60))
    sla_due_at = _as_utc(_resolve_sla_due_at(submission))
    sla_breached = bool(sla_due_at and now > sla_due_at)
    claim_active = _is_claim_active(submission)

    score = 0.0
    if sla_breached:
        score += 100.0
    if submission.risk_locked:
        score += 70.0
    if latest_request_status == SubmissionChangeRequestStatus.OPEN:
        score += 45.0
    if submission.status == SubmissionStatus.REVIEW_READY:
        score += 20.0
    if claim_active:
        score += 12.0
    score += min(created_age_minutes / 6.0, 40.0)

    return score, sla_due_at, sla_breached, created_age_minutes


@router.get("", response_model=list[SubmissionListItem])
def list_submissions(
    status_filter: SubmissionStatus | None = Query(default=None, alias="status"),
    region: str | None = None,
    no: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    min_quality: float | None = Query(default=None, ge=0, le=100),
    max_quality: float | None = Query(default=None, ge=0, le=100),
    sms_status: str | None = None,
    risk_locked: bool | None = None,
    request_status: SubmissionChangeRequestStatus | None = None,
    claim_state: str | None = None,
    sla_breached: bool | None = None,
    priority_order: bool = Query(default=True, alias="priority"),
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)),
) -> list[SubmissionListItem]:
    org_id = require_org_id(actor)
    _mark_stale_uploads(db, org_id)
    sms_filter = sms_status.strip().lower() if sms_status else None
    if sms_filter and sms_filter not in ALLOWED_SMS_FILTERS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid sms_status filter")
    claim_filter = claim_state.strip().lower() if claim_state else None
    if claim_filter and claim_filter not in ALLOWED_CLAIM_FILTERS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid claim_state filter")

    query = db.query(VideoSubmission).filter(
        VideoSubmission.org_id == org_id,
        (VideoSubmission.note.is_(None) | (VideoSubmission.note != SOFT_DELETED_NOTE)),
    )
    if status_filter:
        query = query.filter(VideoSubmission.status == status_filter)
    if region:
        query = query.filter(VideoSubmission.region == region)
    if no:
        query = query.filter(VideoSubmission.no == no)
    if date_from:
        query = query.filter(VideoSubmission.created_at >= date_from)
    if date_to:
        query = query.filter(VideoSubmission.created_at <= date_to)
    if risk_locked is not None:
        query = query.filter(VideoSubmission.risk_locked.is_(risk_locked))

    rows = query.order_by(VideoSubmission.created_at.desc()).all()
    submission_ids = [row.id for row in rows]
    (
        analysis_by_submission_id,
        review_by_submission_id,
        sms_stats_by_submission_id,
        latest_request_by_submission_id,
        latest_admin_action_by_submission_id,
        uploader_map,
    ) = _build_submission_maps(db, org_id, submission_ids)
    now = datetime.now(UTC)
    output: list[SubmissionListItem] = []
    for row in rows:
        analysis = analysis_by_submission_id.get(row.id)
        review = review_by_submission_id.get(row.id)
        quality_score = analysis.quality_score if analysis else None
        if min_quality is not None and (quality_score is None or quality_score < min_quality):
            continue
        if max_quality is not None and (quality_score is None or quality_score > max_quality):
            continue

        sent_count, failed_count, pending_count, last_status = sms_stats_by_submission_id.get(row.id, (0, 0, 0, None))
        if sms_filter == "none" and (sent_count + failed_count + pending_count) > 0:
            continue
        if sms_filter == "sent" and sent_count == 0:
            continue
        if sms_filter == "failed" and failed_count == 0:
            continue
        if sms_filter == "pending" and pending_count == 0:
            continue

        latest_request_status, latest_request_admin_note, latest_request_resolved_at, latest_request_reason_type = latest_request_by_submission_id.get(
            row.id, (None, None, None, None)
        )
        if request_status and latest_request_status != request_status:
            continue

        claim_is_active = _is_claim_active(row)
        if claim_filter == "none" and claim_is_active:
            continue
        if claim_filter == "active" and not claim_is_active:
            continue
        if claim_filter == "mine" and not (claim_is_active and row.claim_admin_id == actor.id):
            continue
        if claim_filter == "other" and not (claim_is_active and row.claim_admin_id != actor.id):
            continue

        priority_score, sla_due_at, is_sla_breached, created_age_minutes = _compute_submission_priority_score(
            row, now, latest_request_status
        )
        if sla_breached is not None and is_sla_breached != sla_breached:
            continue

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
                quality_score=quality_score,
                sms_sent_count=sent_count,
                sms_failed_count=failed_count,
                sms_pending_count=pending_count,
                sms_last_status=last_status,
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
                claimed_by_admin_id=row.claim_admin_id,
                claim_expires_at=row.claim_expires_at,
                claim_note=row.claim_note,
                last_admin_action=last_admin_action,
                last_admin_actor_id=last_admin_actor_id,
                last_admin_actor_username=last_admin_actor_username,
                last_admin_action_at=last_admin_action_at,
                queue_priority_score=round(priority_score, 2),
                created_age_minutes=created_age_minutes,
                sla_due_at=sla_due_at,
                sla_breached=is_sla_breached,
                created_at=row.created_at,
            )
        )
    if priority_order:
        output.sort(
            key=lambda item: (
                item.queue_priority_score if item.queue_priority_score is not None else 0.0,
                item.created_age_minutes if item.created_age_minutes is not None else 0,
            ),
            reverse=True,
        )
    return output


@router.get("/ops/overview", response_model=OpsOverviewResponse)
def get_ops_overview(
    limit: int = Query(default=20, ge=5, le=100),
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)),
) -> OpsOverviewResponse:
    org_id = require_org_id(actor)
    _mark_stale_uploads(db, org_id)
    now = datetime.now(UTC)
    since = now - timedelta(hours=24)

    total_submissions = db.query(VideoSubmission).filter(VideoSubmission.org_id == org_id).count()
    processing_count = (
        db.query(VideoSubmission)
        .filter(VideoSubmission.org_id == org_id, VideoSubmission.status == SubmissionStatus.PROCESSING)
        .count()
    )
    failed_total = (
        db.query(VideoSubmission).filter(VideoSubmission.org_id == org_id, VideoSubmission.status == SubmissionStatus.FAILED).count()
    )
    failed_last_24h = (
        db.query(VideoSubmission)
        .filter(
            VideoSubmission.org_id == org_id,
            VideoSubmission.status == SubmissionStatus.FAILED,
            VideoSubmission.updated_at >= since,
        )
        .count()
    )

    failed_rows = (
        db.query(VideoSubmission)
        .filter(VideoSubmission.org_id == org_id, VideoSubmission.status == SubmissionStatus.FAILED)
        .order_by(VideoSubmission.updated_at.desc())
        .limit(limit)
        .all()
    )
    audit_rows = db.query(AuditEvent).filter(AuditEvent.org_id == org_id).order_by(AuditEvent.created_at.desc()).limit(limit).all()

    return OpsOverviewResponse(
        total_submissions=total_submissions,
        processing_count=processing_count,
        failed_total=failed_total,
        failed_last_24h=failed_last_24h,
        recent_failed_submissions=[
            FailedSubmissionOut(
                id=row.id,
                no=row.no,
                region=row.region,
                status=row.status,
                failure_reason=row.failure_reason,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
            for row in failed_rows
        ],
        recent_audit_events=[
            AuditEventOut(
                id=row.id,
                action=row.action,
                entity_type=row.entity_type,
                entity_id=row.entity_id,
                actor_id=row.actor_id,
                metadata=_parse_metadata_json(row.metadata_json),
                created_at=row.created_at,
            )
            for row in audit_rows
        ],
    )


@router.get("/{submission_id:int}", response_model=SubmissionDetail)
def get_submission(
    submission_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)),
) -> SubmissionDetail:
    org_id = require_org_id(actor)
    _mark_stale_uploads(db, org_id)
    submission = _get_submission_for_org(db, submission_id, org_id)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    analysis = db.query(AnalysisResult).filter(AnalysisResult.submission_id == submission.id, AnalysisResult.org_id == org_id).first()
    review = db.query(ReviewDecision).filter(ReviewDecision.submission_id == submission.id, ReviewDecision.org_id == org_id).first()
    analysis_mode: str | None = None
    extracted_names: list[ExtractedNameOut] = []
    if analysis:
        try:
            confidence_payload = json.loads(analysis.confidence_json)
            analysis_mode = confidence_payload.get("analysis_mode")
        except Exception:  # noqa: BLE001
            analysis_mode = None
        try:
            payload_names = json.loads(analysis.extracted_names_json)
            if isinstance(payload_names, list):
                for item in payload_names:
                    if not isinstance(item, dict):
                        continue
                    full_name = str(item.get("full_name") or "").strip()
                    source = str(item.get("source") or "").strip() or "audio"
                    confidence_raw = item.get("confidence")
                    try:
                        confidence = float(confidence_raw)
                    except (TypeError, ValueError):
                        confidence = 1.0
                    confidence = max(0.0, min(1.0, confidence))
                    low_confidence = bool(item.get("low_confidence")) if "low_confidence" in item else confidence < 0.80
                    if full_name:
                        extracted_names.append(
                            ExtractedNameOut(
                                full_name=full_name,
                                source=source,
                                confidence=confidence,
                                low_confidence=low_confidence,
                            )
                        )
        except Exception:  # noqa: BLE001
            extracted_names = []

    matches = (
        db.query(MatchResult)
        .filter(MatchResult.submission_id == submission.id, MatchResult.org_id == org_id)
        .order_by(MatchResult.score.desc())
        .all()
    )
    last_admin_action, last_admin_actor_id, last_admin_actor_username, last_admin_action_at = _latest_admin_action_info(
        db, submission.id, org_id
    )
    match_map = {row.donor_record_id: row for row in matches}
    donors, _ = _load_submission_donors(db, submission, analysis)

    donor_rows: list[DonorMatchOut] = []
    for donor in sorted(donors, key=lambda x: (x.first_name, x.last_name)):
        match_row = match_map.get(donor.id)
        donor_rows.append(
            DonorMatchOut(
                donor_record_id=donor.id,
                no=donor.no,
                full_name=f"{donor.first_name} {donor.last_name}",
                phone=donor.phone,
                matched=bool(match_row),
                match_type=match_row.match_type if match_row else None,
                score=match_row.score if match_row else None,
                evidence_source=match_row.evidence_source if match_row else None,
            )
        )

    preview_watch_url = storage.build_signed_watch_url(submission.processed_object_key) if submission.processed_object_key else None
    sms_watch_url = _build_short_watch_url(submission.id) if submission.processed_object_key else None
    sms_preview_text = _build_sms_text(submission) if submission.processed_object_key else None

    return SubmissionDetail(
        id=submission.id,
        country=submission.country,
        city=submission.city,
        region=submission.region,
        no=submission.no,
        title=submission.title,
        note=submission.note,
        uploader_username=submission.uploader.username if submission.uploader else None,
        uploader_full_name=(
            " ".join(part for part in [submission.uploader.first_name, submission.uploader.last_name] if part).strip()
            if submission.uploader
            else None
        ),
        status=submission.status,
        raw_object_key=submission.raw_object_key,
        processed_object_key=submission.processed_object_key,
        preview_watch_url=preview_watch_url,
        sms_watch_url=sms_watch_url,
        sms_preview_text=sms_preview_text,
        duration_seconds=submission.duration_seconds,
        failure_reason=submission.failure_reason,
        transcript_text=analysis.transcript_text if analysis else None,
        ocr_text=analysis.ocr_text if analysis else None,
        extracted_no=analysis.extracted_no if analysis else None,
        quality_score=analysis.quality_score if analysis else None,
        review_decision=review.decision if review else None,
        review_note=review.decision_note if review else None,
        risk_locked=submission.risk_locked,
        risk_codes=_parse_risk_codes(submission.risk_codes_json),
        risk_lock_note=submission.risk_lock_note,
        claimed_by_admin_id=submission.claim_admin_id,
        claim_expires_at=submission.claim_expires_at,
        claim_note=submission.claim_note,
        last_admin_action=last_admin_action,
        last_admin_actor_id=last_admin_actor_id,
        last_admin_actor_username=last_admin_actor_username,
        last_admin_action_at=last_admin_action_at,
        analysis_mode=analysis_mode,
        extracted_names=extracted_names,
        matches=[
            MatchResultOut(
                donor_record_id=item.donor_record_id,
                match_type=item.match_type,
                score=item.score,
                evidence_source=item.evidence_source,
            )
            for item in matches
        ],
        donors=donor_rows,
        created_at=submission.created_at,
    )


@router.post("/{submission_id:int}/review", response_model=ReviewResponse)
def review_submission(
    submission_id: int,
    payload: ReviewRequest,
    db: Session = Depends(get_db),
    reviewer: User = Depends(require_roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)),
) -> ReviewResponse:
    org_id = require_org_id(reviewer)
    submission = _get_submission_for_org(db, submission_id, org_id)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    _assert_claim_available(submission, reviewer)

    analysis = db.query(AnalysisResult).filter(AnalysisResult.submission_id == submission.id, AnalysisResult.org_id == org_id).first()
    if not analysis:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Submission has no analysis")
    detected_no = (analysis.extracted_no or "").strip()
    input_no = str(submission.no).strip()
    if payload.decision == ReviewDecisionType.APPROVED and detected_no and detected_no != input_no:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"NO uyusmazligi var (operatör: {input_no}, AI: {detected_no}). Önce NO düzeltin.",
        )
    if submission.risk_locked and payload.decision == ReviewDecisionType.APPROVED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Submission is risk locked. Resolve/override risk before approval.",
        )
    decision_note = payload.decision_note.strip() if payload.decision_note else None
    if payload.decision == ReviewDecisionType.REJECTED and not decision_note:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reddedilen kayıt için red nedeni/rapor zorunludur.")

    final_quality = payload.override_quality_score if payload.override_quality_score is not None else analysis.quality_score

    existing = db.query(ReviewDecision).filter(ReviewDecision.submission_id == submission_id, ReviewDecision.org_id == org_id).first()
    if existing:
        if reviewer.role == UserRole.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Submission already reviewed. Only superadmin can override review decision.",
            )
        if reviewer.role == UserRole.SUPER_ADMIN and not decision_note:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Superadmin override requires decision note.",
            )
        existing.decision = payload.decision
        existing.decision_note = decision_note
        existing.final_quality_score = final_quality
        review = existing
    else:
        review = ReviewDecision(
            submission_id=submission_id,
            reviewer_id=reviewer.id,
            org_id=org_id,
            decision=payload.decision,
            decision_note=decision_note,
            final_quality_score=final_quality,
        )
        db.add(review)

    submission.status = SubmissionStatus.APPROVED if payload.decision == ReviewDecisionType.APPROVED else SubmissionStatus.REJECTED

    write_audit(
        db,
        action="submission_reviewed",
        entity_type="video_submission",
        entity_id=str(submission.id),
        actor_id=reviewer.id,
        org_id=org_id,
        metadata={
            "decision": payload.decision.value,
            "final_quality_score": final_quality,
            "decision_note": decision_note,
        },
    )
    db.commit()

    return ReviewResponse(
        submission_id=submission_id,
        status=submission.status,
        decision=payload.decision,
        decision_note=decision_note,
        final_quality_score=final_quality,
    )


@router.post("/{submission_id:int}/no/update", response_model=SubmissionNoUpdateResponse)
def update_submission_no(
    submission_id: int,
    payload: SubmissionNoUpdateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)),
) -> SubmissionNoUpdateResponse:
    org_id = require_org_id(admin)
    submission = _get_submission_for_org(db, submission_id, org_id)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    _assert_claim_available(submission, admin)

    new_no = payload.no.strip()
    if not new_no:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="NO bos olamaz")

    analysis = db.query(AnalysisResult).filter(AnalysisResult.submission_id == submission.id, AnalysisResult.org_id == org_id).first()
    old_no = str(submission.no).strip()
    submission.no = new_no

    # Analiz varsa yeni NO grubu icin eslesmeleri yeniden kur.
    if analysis:
        donors = (
            db.query(DonorRecord)
            .filter(
                DonorRecord.org_id == submission.org_id,
                DonorRecord.no == new_no,
                DonorRecord.country == submission.country,
                DonorRecord.city == submission.city,
                DonorRecord.region == submission.region,
            )
            .all()
        )
        if not donors:
            donors = db.query(DonorRecord).filter(DonorRecord.org_id == submission.org_id, DonorRecord.no == new_no).all()
        extracted_names_payload: list[ExtractedName] = []
        try:
            parsed = json.loads(analysis.extracted_names_json) if analysis.extracted_names_json else []
            if isinstance(parsed, list):
                for item in parsed:
                    if not isinstance(item, dict):
                        continue
                    full_name = str(item.get("full_name", "")).strip()
                    if not full_name:
                        continue
                    source = str(item.get("source", "audio")).strip() or "audio"
                    confidence = item.get("confidence", 0.86)
                    try:
                        confidence_val = float(confidence)
                    except (TypeError, ValueError):
                        confidence_val = 0.86
                    extracted_names_payload.append(
                        ExtractedName(
                            full_name=full_name,
                            source=source,
                            confidence=confidence_val,
                            low_confidence=bool(item.get("low_confidence", False)),
                        )
                    )
        except Exception:  # noqa: BLE001
            extracted_names_payload = []

        db.query(MatchResult).filter(MatchResult.submission_id == submission.id, MatchResult.org_id == org_id).delete()
        for item in match_names(donors, extracted_names_payload):
            db.add(
                MatchResult(
                    submission_id=submission.id,
                    donor_record_id=item.donor_id,
                    org_id=org_id,
                    match_type=item.match_type,
                    score=item.score,
                    evidence_source=item.evidence_source,
                )
            )

        # NO mismatch risk kodunu yeni degerle tekrar degerlendir.
        detected_no = (analysis.extracted_no or "").strip()
        risk_codes = _parse_risk_codes(submission.risk_codes_json)
        mismatch_code = "no_mismatch_ai_vs_operator"
        other_codes = [code for code in risk_codes if code != mismatch_code]
        mismatch_now = bool(detected_no and detected_no != new_no)
        if mismatch_now:
            merged = sorted(set(other_codes + [mismatch_code]))
            submission.risk_codes_json = json.dumps(merged, ensure_ascii=False)
            submission.risk_locked = True
            submission.risk_lock_note = f"operator_no={new_no}, detected_no={detected_no}"
        else:
            submission.risk_codes_json = json.dumps(other_codes, ensure_ascii=False) if other_codes else None
            if other_codes:
                submission.risk_locked = submission.risk_locked
            else:
                submission.risk_locked = False
                if submission.risk_lock_note and submission.risk_lock_note.startswith("operator_no="):
                    submission.risk_lock_note = "no_mismatch_resolved_by_admin"

    write_audit(
        db,
        action="submission_no_updated",
        entity_type="video_submission",
        entity_id=str(submission.id),
        actor_id=admin.id,
        org_id=org_id,
        metadata={"old_no": old_no, "new_no": new_no, "note": payload.note},
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)

    return SubmissionNoUpdateResponse(
        submission_id=submission.id,
        no=submission.no,
        risk_locked=submission.risk_locked,
        risk_codes=_parse_risk_codes(submission.risk_codes_json),
    )


@router.post("/{submission_id:int}/matches/override", response_model=MatchOverrideResponse)
def override_submission_matches(
    submission_id: int,
    payload: MatchOverrideRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)),
) -> MatchOverrideResponse:
    org_id = require_org_id(admin)
    submission = _get_submission_for_org(db, submission_id, org_id)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    if submission.status == SubmissionStatus.PROCESSING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Submission is still processing")

    analysis = db.query(AnalysisResult).filter(AnalysisResult.submission_id == submission.id, AnalysisResult.org_id == org_id).first()
    donors, effective_no = _load_submission_donors(db, submission, analysis)
    donor_map = {row.id: row for row in donors}

    selected_ids = set(payload.donor_record_ids)
    invalid_ids = sorted([donor_id for donor_id in selected_ids if donor_id not in donor_map])
    if invalid_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Some donors are not in submission donor group (NO: {effective_no}): {invalid_ids}",
        )

    db.query(MatchResult).filter(MatchResult.submission_id == submission.id, MatchResult.org_id == org_id).delete()
    for donor_id in sorted(selected_ids):
        db.add(
            MatchResult(
                submission_id=submission.id,
                donor_record_id=donor_id,
                org_id=org_id,
                match_type="manual",
                score=100.0,
                evidence_source="manual",
            )
        )

    write_audit(
        db,
        action="matches_overridden",
        entity_type="video_submission",
        entity_id=str(submission.id),
        actor_id=admin.id,
        org_id=org_id,
        metadata={
            "matched_count": len(selected_ids),
            "donor_record_ids": sorted(selected_ids),
            "note": payload.note,
        },
    )
    db.commit()

    return MatchOverrideResponse(
        submission_id=submission.id,
        matched_count=len(selected_ids),
    )


@router.post("/{submission_id:int}/sms/send", response_model=SmsDispatchResponse)
def send_sms(
    submission_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)),
) -> SmsDispatchResponse:
    org_id = require_org_id(admin)
    submission = _get_submission_for_org(db, submission_id, org_id)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    _assert_claim_available(submission, admin)
    if submission.status != SubmissionStatus.APPROVED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Submission must be approved before SMS")
    if submission.risk_locked:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Submission is risk locked")
    if not submission.processed_object_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Submission has no processed video")

    analysis = db.query(AnalysisResult).filter(AnalysisResult.submission_id == submission.id, AnalysisResult.org_id == org_id).first()
    donors, _ = _load_submission_donors(db, submission, analysis)
    unique_phones = sorted({_normalized_digits(row.phone) for row in donors if _normalized_digits(row.phone)})
    if not unique_phones:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No phone numbers available for this NO")

    text = _build_sms_text(submission)
    provider = get_sms_provider()
    sent_count = 0
    failed_count = 0
    skipped_count = 0

    for phone in unique_phones:
        if _has_successful_sms(db, submission.id, phone):
            skipped_count += 1
            continue

        sms_row, _ = _send_and_log_single_sms(
            db=db,
            provider=provider,
            submission=submission,
            phone=phone,
            message_text=text,
        )
        if sms_row.status == SmsStatus.SENT:
            sent_count += 1
        else:
            failed_count += 1

    write_audit(
        db,
        action="sms_dispatched",
        entity_type="video_submission",
        entity_id=str(submission.id),
        actor_id=admin.id,
        org_id=org_id,
        metadata={"sent_count": sent_count, "failed_count": failed_count, "skipped_count": skipped_count},
    )
    db.commit()

    return SmsDispatchResponse(submission_id=submission.id, sent_count=sent_count, failed_count=failed_count)


@router.post("/{submission_id:int}/sms/send-donor", response_model=SmsSingleDispatchResponse)
def send_sms_to_donor(
    submission_id: int,
    payload: SmsSingleDispatchRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)),
) -> SmsSingleDispatchResponse:
    org_id = require_org_id(admin)
    submission = _get_submission_for_org(db, submission_id, org_id)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    _assert_claim_available(submission, admin)
    if submission.status != SubmissionStatus.APPROVED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Submission must be approved before single SMS",
        )
    if submission.risk_locked:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Submission is risk locked")
    if not submission.processed_object_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Submission has no processed video")

    donor = db.query(DonorRecord).filter(DonorRecord.id == payload.donor_record_id, DonorRecord.org_id == org_id).first()
    if not donor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Donor record not found")

    analysis = db.query(AnalysisResult).filter(AnalysisResult.submission_id == submission.id, AnalysisResult.org_id == org_id).first()
    donors, effective_no = _load_submission_donors(db, submission, analysis)
    donor_ids = {row.id for row in donors}
    if donor.id not in donor_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Donor is not in submission donor group (NO: {effective_no})",
        )

    phone = _normalized_digits(donor.phone)
    if not phone:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Donor phone is empty")

    message_text = _build_sms_text(submission)
    provider = get_sms_provider()
    if _has_successful_sms(db, submission.id, phone):
        return SmsSingleDispatchResponse(
            submission_id=submission.id,
            donor_record_id=donor.id,
            phone=_masked_phone(phone),
            status="skipped_duplicate",
            provider_ref=None,
        )

    sms_row, _ = _send_and_log_single_sms(
        db=db,
        provider=provider,
        submission=submission,
        phone=phone,
        message_text=message_text,
    )

    write_audit(
        db,
        action="sms_dispatched_single",
        entity_type="video_submission",
        entity_id=str(submission.id),
        actor_id=admin.id,
        org_id=org_id,
        metadata={
            "donor_record_id": donor.id,
            "phone": _masked_phone(phone),
            "status": sms_row.status.value,
        },
    )
    db.commit()

    return SmsSingleDispatchResponse(
        submission_id=submission.id,
        donor_record_id=donor.id,
        phone=sms_row.phone,
        status=sms_row.status.value,
        provider_ref=sms_row.provider_ref,
    )


@router.post("/{submission_id:int}/sms/send-selected", response_model=SmsBulkDispatchResponse)
def send_sms_to_selected_donors(
    submission_id: int,
    payload: SmsBulkDispatchRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)),
) -> SmsBulkDispatchResponse:
    org_id = require_org_id(admin)
    submission = _get_submission_for_org(db, submission_id, org_id)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    _assert_claim_available(submission, admin)
    if submission.status != SubmissionStatus.APPROVED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Submission must be approved before selected SMS",
        )
    if submission.risk_locked:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Submission is risk locked")
    if not submission.processed_object_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Submission has no processed video")

    analysis = db.query(AnalysisResult).filter(AnalysisResult.submission_id == submission.id, AnalysisResult.org_id == org_id).first()
    donors, effective_no = _load_submission_donors(db, submission, analysis)
    donor_map = {row.id: row for row in donors}
    requested_ids = set(payload.donor_record_ids)
    invalid_ids = sorted([donor_id for donor_id in requested_ids if donor_id not in donor_map])
    if invalid_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Some donors are not in submission donor group (NO: {effective_no}): {invalid_ids}",
        )

    unique_phones = sorted(
        {
            _normalized_digits(donor_map[donor_id].phone)
            for donor_id in requested_ids
            if _normalized_digits(donor_map[donor_id].phone)
        }
    )
    if not unique_phones:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No phone numbers available for selection")

    message_text = _build_sms_text(submission)
    provider = get_sms_provider()
    sent_count = 0
    failed_count = 0
    skipped_count = 0

    for phone in unique_phones:
        if not payload.force_resend and _has_successful_sms(db, submission.id, phone):
            skipped_count += 1
            continue
        sms_row, _ = _send_and_log_single_sms(
            db=db,
            provider=provider,
            submission=submission,
            phone=phone,
            message_text=message_text,
        )
        if sms_row.status == SmsStatus.SENT:
            sent_count += 1
        else:
            failed_count += 1

    write_audit(
        db,
        action="sms_dispatched_selected",
        entity_type="video_submission",
        entity_id=str(submission.id),
        actor_id=admin.id,
        org_id=org_id,
        metadata={
            "requested_count": len(requested_ids),
            "unique_phone_count": len(unique_phones),
            "sent_count": sent_count,
            "failed_count": failed_count,
            "skipped_count": skipped_count,
            "force_resend": payload.force_resend,
        },
    )
    db.commit()

    return SmsBulkDispatchResponse(
        submission_id=submission.id,
        requested_count=len(requested_ids),
        unique_phone_count=len(unique_phones),
        sent_count=sent_count,
        failed_count=failed_count,
        skipped_count=skipped_count,
    )


@router.post("/{submission_id:int}/sms/retry-failed", response_model=SmsDispatchResponse)
def retry_failed_sms(
    submission_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)),
) -> SmsDispatchResponse:
    org_id = require_org_id(admin)
    submission = _get_submission_for_org(db, submission_id, org_id)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    _assert_claim_available(submission, admin)
    if submission.status != SubmissionStatus.APPROVED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Submission must be approved before retry")
    if submission.risk_locked:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Submission is risk locked")
    if not submission.processed_object_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Submission has no processed video")

    failed_masked_phones = {
        row.phone
        for row in db.query(SmsMessage.phone, SmsMessage.status).filter(
            SmsMessage.submission_id == submission.id,
            SmsMessage.org_id == org_id,
        ).all()
        if row.status == SmsStatus.FAILED
    }
    if not failed_masked_phones:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No failed SMS recipients to retry")

    analysis = db.query(AnalysisResult).filter(AnalysisResult.submission_id == submission.id, AnalysisResult.org_id == org_id).first()
    donors, _ = _load_submission_donors(db, submission, analysis)
    retry_phones = sorted(
        {
            _normalized_digits(donor.phone)
            for donor in donors
            if _normalized_digits(donor.phone) and _masked_phone(_normalized_digits(donor.phone)) in failed_masked_phones
        }
    )
    if not retry_phones:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed recipients cannot be mapped to donor phones")

    message_text = _build_sms_text(submission)
    provider = get_sms_provider()
    sent_count = 0
    failed_count = 0

    for phone in retry_phones:
        sms_row, _ = _send_and_log_single_sms(
            db=db,
            provider=provider,
            submission=submission,
            phone=phone,
            message_text=message_text,
        )
        if sms_row.status == SmsStatus.SENT:
            sent_count += 1
        else:
            failed_count += 1

    write_audit(
        db,
        action="sms_retry_failed",
        entity_type="video_submission",
        entity_id=str(submission.id),
        actor_id=admin.id,
        org_id=org_id,
        metadata={
            "retry_target_count": len(retry_phones),
            "sent_count": sent_count,
            "failed_count": failed_count,
        },
    )
    db.commit()

    return SmsDispatchResponse(
        submission_id=submission.id,
        sent_count=sent_count,
        failed_count=failed_count,
    )


@router.get("/{submission_id:int}/sms", response_model=list[SmsMessageOut])
def sms_log(
    submission_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)),
) -> list[SmsMessageOut]:
    org_id = require_org_id(actor)
    submission = _get_submission_for_org(db, submission_id, org_id)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    rows = (
        db.query(SmsMessage)
        .filter(SmsMessage.submission_id == submission_id, SmsMessage.org_id == org_id)
        .order_by(SmsMessage.created_at.desc())
        .all()
    )
    return [
        SmsMessageOut(
            id=row.id,
            phone=row.phone,
            status=row.status.value,
            provider_ref=row.provider_ref,
            message_text=row.message_text,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.post("/{submission_id:int}/claim", response_model=SubmissionClaimResponse)
def claim_submission(
    submission_id: int,
    payload: SubmissionClaimRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)),
) -> SubmissionClaimResponse:
    org_id = require_org_id(admin)
    submission = _get_submission_for_org(db, submission_id, org_id)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    now = datetime.now(UTC)
    if _is_claim_active(submission) and submission.claim_admin_id != admin.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Submission is currently claimed by admin #{submission.claim_admin_id} until {submission.claim_expires_at.isoformat()}",
        )

    expires_at = now + timedelta(minutes=CLAIM_TTL_MINUTES)
    submission.claim_admin_id = admin.id
    submission.claim_expires_at = expires_at
    submission.claim_note = payload.note.strip() if payload.note else submission.claim_note
    submission.claim_updated_at = now
    db.add(submission)

    write_audit(
        db,
        action="submission_claimed",
        entity_type="video_submission",
        entity_id=str(submission.id),
        actor_id=admin.id,
        org_id=org_id,
        metadata={"claim_expires_at": expires_at.isoformat(), "note": submission.claim_note},
    )
    db.commit()

    return SubmissionClaimResponse(
        submission_id=submission.id,
        claimed_by_admin_id=admin.id,
        claim_expires_at=expires_at,
        claim_note=submission.claim_note,
    )


@router.delete("/{submission_id:int}/claim")
def release_submission_claim(
    submission_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)),
) -> dict:
    org_id = require_org_id(admin)
    submission = _get_submission_for_org(db, submission_id, org_id)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    if submission.claim_admin_id is None:
        return {"submission_id": submission.id, "released": False}

    if submission.claim_admin_id != admin.id and admin.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Submission is claimed by another admin")

    submission.claim_admin_id = None
    submission.claim_expires_at = None
    submission.claim_note = None
    submission.claim_updated_at = datetime.now(UTC)
    db.add(submission)
    write_audit(
        db,
        action="submission_claim_released",
        entity_type="video_submission",
        entity_id=str(submission.id),
        actor_id=admin.id,
        org_id=org_id,
        metadata={},
    )
    db.commit()
    return {"submission_id": submission.id, "released": True}


@router.delete("/{submission_id:int}")
def delete_submission(
    submission_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> dict:
    org_id = require_org_id(admin)
    submission = _get_submission_for_org(db, submission_id, org_id)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    if _is_claim_active(submission) and submission.claim_admin_id != admin.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Submission is claimed by another admin")

    raw_path = storage.raw_path(submission.raw_object_key)
    processed_path = storage.processed_path(submission.processed_object_key) if submission.processed_object_key else None

    db.query(AnalysisResult).filter(AnalysisResult.submission_id == submission.id, AnalysisResult.org_id == org_id).delete(
        synchronize_session=False
    )
    db.query(MatchResult).filter(MatchResult.submission_id == submission.id, MatchResult.org_id == org_id).delete(
        synchronize_session=False
    )
    db.query(ReviewDecision).filter(ReviewDecision.submission_id == submission.id, ReviewDecision.org_id == org_id).delete(
        synchronize_session=False
    )
    db.query(SmsMessage).filter(SmsMessage.submission_id == submission.id, SmsMessage.org_id == org_id).delete(
        synchronize_session=False
    )
    db.query(SubmissionChangeRequest).filter(
        SubmissionChangeRequest.submission_id == submission.id,
        SubmissionChangeRequest.org_id == org_id,
    ).delete(synchronize_session=False)
    try:
        db.query(AuditEvent).filter(
            AuditEvent.entity_type == "video_submission",
            AuditEvent.entity_id == str(submission.id),
            AuditEvent.org_id == org_id,
        ).delete(synchronize_session=False)
    except SQLAlchemyError:
        # Corrupt audit table rows should not block manual submission cleanup.
        db.rollback()
        db.query(AnalysisResult).filter(AnalysisResult.submission_id == submission.id, AnalysisResult.org_id == org_id).delete(
            synchronize_session=False
        )
        db.query(MatchResult).filter(MatchResult.submission_id == submission.id, MatchResult.org_id == org_id).delete(
            synchronize_session=False
        )
        db.query(ReviewDecision).filter(ReviewDecision.submission_id == submission.id, ReviewDecision.org_id == org_id).delete(
            synchronize_session=False
        )
        db.query(SmsMessage).filter(SmsMessage.submission_id == submission.id, SmsMessage.org_id == org_id).delete(
            synchronize_session=False
        )
        db.query(SubmissionChangeRequest).filter(
            SubmissionChangeRequest.submission_id == submission.id,
            SubmissionChangeRequest.org_id == org_id,
        ).delete(synchronize_session=False)
    db.delete(submission)

    try:
        write_audit(
            db,
            action="submission_deleted",
            entity_type="video_submission",
            entity_id=str(submission_id),
            actor_id=admin.id,
            org_id=org_id,
            metadata={"source": "super_admin_manual"},
        )
    except SQLAlchemyError:
        pass

    soft_deleted = False
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        # Some legacy malformed SQLite pages can block DELETE on specific rows.
        # Fallback: hide from queues with a soft-delete marker.
        db.execute(
            text(
                """
                UPDATE video_submissions
                SET note = :note,
                    status = :status,
                    claim_admin_id = NULL,
                    claim_expires_at = NULL,
                    claim_note = NULL
                WHERE id = :submission_id AND org_id = :org_id
                """
            ),
            {
                "note": SOFT_DELETED_NOTE,
                "status": SubmissionStatus.REJECTED.name,
                "submission_id": submission_id,
                "org_id": org_id,
            },
        )
        db.commit()
        soft_deleted = True

    try:
        if raw_path.exists():
            raw_path.unlink()
    except Exception:  # noqa: BLE001
        pass
    try:
        if processed_path and processed_path.exists():
            processed_path.unlink()
    except Exception:  # noqa: BLE001
        pass

    return {"submission_id": submission_id, "deleted": True, "soft_deleted": soft_deleted}


@router.get("/admin-logs/mine", response_model=AdminLogsResponse)
def get_my_admin_logs(
    limit: int = Query(default=100, ge=1, le=500),
    action_filter: str | None = Query(default=None, alias="action"),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    no: str | None = None,
    region: str | None = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)),
) -> AdminLogsResponse:
    org_id = require_org_id(admin)
    query = db.query(AuditEvent).filter(
        AuditEvent.org_id == org_id,
        AuditEvent.actor_id == admin.id,
        AuditEvent.action.in_(ADMIN_ACTIONS),
    )
    if action_filter:
        query = query.filter(AuditEvent.action == action_filter)
    if date_from:
        query = query.filter(AuditEvent.created_at >= date_from)
    if date_to:
        query = query.filter(AuditEvent.created_at <= date_to)

    rows = query.order_by(AuditEvent.created_at.desc()).limit(limit).all()
    output: list[AdminActionLogOut] = []
    for row in rows:
        submission_id: int | None = None
        submission_no: str | None = None
        submission_region: str | None = None
        if row.entity_type == "video_submission":
            try:
                submission_id = int(row.entity_id)
            except ValueError:
                submission_id = None
            if submission_id is not None:
                submission = _get_submission_for_org(db, submission_id, org_id)
                if submission:
                    submission_no = submission.no
                    submission_region = submission.region
        if no and submission_no != no:
            continue
        if region and submission_region != region:
            continue

        output.append(
            AdminActionLogOut(
                id=row.id,
                action=row.action,
                actor_id=admin.id,
                actor_username=admin.username,
                submission_id=submission_id,
                submission_no=submission_no,
                submission_region=submission_region,
                created_at=row.created_at,
                metadata=_parse_metadata_json(row.metadata_json),
            )
        )

    return AdminLogsResponse(total_actions=len(output), items=output)


@router.get("/requests", response_model=list[SubmissionChangeRequestOut])
@router.get("/requests/list", response_model=list[SubmissionChangeRequestOut])
def list_submission_requests(
    status_filter: SubmissionChangeRequestStatus | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)),
) -> list[SubmissionChangeRequestOut]:
    org_id = require_org_id(admin)
    query = db.query(SubmissionChangeRequest).filter(SubmissionChangeRequest.org_id == org_id)
    if status_filter:
        query = query.filter(SubmissionChangeRequest.status == status_filter)
    rows = query.order_by(SubmissionChangeRequest.created_at.desc()).limit(200).all()

    output: list[SubmissionChangeRequestOut] = []
    for row in rows:
        submission = db.query(VideoSubmission).filter(VideoSubmission.id == row.submission_id, VideoSubmission.org_id == org_id).first()
        operator = db.query(User).filter(User.id == row.operator_id, User.org_id == org_id).first()
        output.append(
            SubmissionChangeRequestOut(
                id=row.id,
                submission_id=row.submission_id,
                operator_id=row.operator_id,
                operator_username=operator.username if operator else None,
                submission_no=submission.no if submission else None,
                submission_region=submission.region if submission else None,
                reason_type=row.reason_type,
                note=row.note,
                status=row.status,
                admin_note=row.admin_note,
                resolved_by=row.resolved_by,
                resolved_at=row.resolved_at,
                created_at=row.created_at,
            )
        )
    return output


@router.post("/requests/{request_id:int}/resolve", response_model=SubmissionChangeRequestOut)
def resolve_submission_request(
    request_id: int,
    payload: SubmissionChangeRequestResolveIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)),
) -> SubmissionChangeRequestOut:
    org_id = require_org_id(admin)
    if payload.decision not in {SubmissionChangeRequestStatus.APPROVED, SubmissionChangeRequestStatus.REJECTED}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Decision must be approved or rejected")

    req = db.query(SubmissionChangeRequest).filter(SubmissionChangeRequest.id == request_id, SubmissionChangeRequest.org_id == org_id).first()
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    if req.status != SubmissionChangeRequestStatus.OPEN:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request already resolved")

    submission = _get_submission_for_org(db, req.submission_id, org_id)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    req.status = payload.decision
    req.admin_note = payload.decision_note.strip()
    req.resolved_by = admin.id
    req.resolved_at = datetime.now(UTC)
    db.add(req)

    if payload.decision == SubmissionChangeRequestStatus.APPROVED:
        submission.status = SubmissionStatus.REJECTED
        submission.risk_locked = True
        submission.risk_lock_note = "request_approved_rejected_by_admin"
    else:
        submission.risk_locked = False
        submission.risk_lock_note = f"request_rejected_by_admin: {payload.decision_note.strip()}"
    db.add(submission)

    write_audit(
        db,
        action="submission_change_request_resolved",
        entity_type="video_submission",
        entity_id=str(submission.id),
        actor_id=admin.id,
        org_id=org_id,
        metadata={
            "request_id": req.id,
            "decision": payload.decision.value,
            "decision_note": payload.decision_note.strip(),
        },
    )
    db.commit()
    db.refresh(req)

    operator = db.query(User).filter(User.id == req.operator_id).first()
    return SubmissionChangeRequestOut(
        id=req.id,
        submission_id=req.submission_id,
        operator_id=req.operator_id,
        operator_username=operator.username if operator else None,
        submission_no=submission.no,
        submission_region=submission.region,
        reason_type=req.reason_type,
        note=req.note,
        status=req.status,
        admin_note=req.admin_note,
        resolved_by=req.resolved_by,
        resolved_at=req.resolved_at,
        created_at=req.created_at,
    )


@router.post("/{submission_id:int}/risk/override")
def override_submission_risk(
    submission_id: int,
    payload: RiskOverrideRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> dict:
    org_id = require_org_id(admin)
    submission = _get_submission_for_org(db, submission_id, org_id)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    _assert_claim_available(submission, admin)
    if not submission.risk_locked:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Submission is not risk locked")

    previous_note = submission.risk_lock_note
    previous_codes = _parse_risk_codes(submission.risk_codes_json)
    submission.risk_locked = False
    submission.risk_lock_note = payload.note.strip()
    submission.risk_overridden_at = datetime.now(UTC)
    submission.risk_overridden_by = admin.id
    db.add(submission)

    write_audit(
        db,
        action="submission_risk_overridden",
        entity_type="video_submission",
        entity_id=str(submission.id),
        actor_id=admin.id,
        org_id=org_id,
        metadata={
            "note": payload.note.strip(),
            "actor_role": admin.role.value,
            "previous_note": previous_note,
            "previous_codes": previous_codes,
            "claim_admin_id": submission.claim_admin_id,
            "claim_expires_at": submission.claim_expires_at.isoformat() if submission.claim_expires_at else None,
        },
    )
    db.commit()

    return {"submission_id": submission.id, "risk_locked": submission.risk_locked}
