import json
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import require_org_id, require_roles
from app.core.database import get_db
from app.core.roles import ReviewDecisionType, SmsStatus, SubmissionStatus, UserRole
from app.core.security import get_password_hash
from app.models import AnalysisResult, AuditEvent, Organization, ReviewDecision, SmsMessage, User, VideoSubmission
from app.schemas import (
    OperatorAnalyticsDetailOut,
    OperatorAnalyticsOut,
    OperatorCreateRequest,
    OperatorDailyMetricOut,
    OperatorOut,
    OperatorPasswordResetRequest,
    SuperadminAdminStatsOut,
    SuperadminAiStatsOut,
    SuperadminFunnelOut,
    OperatorSubmissionMetricOut,
    SuperadminIssueBreakdownOut,
    SuperadminIssueItemOut,
    SuperadminLiveUserOut,
    SuperadminOperatorStatsOut,
    SuperadminOperatorQualityTrendOut,
    SuperadminSlaOut,
    OperatorStatusUpdateRequest,
    SuperadminStatsDashboardOut,
    SuperadminSubmissionStatusCountsOut,
    OperatorUpdateRequest,
    SuperadminAnalyticsOverview,
)
from app.services.audit import write_audit

router = APIRouter(prefix="/superadmin", tags=["superadmin"])


def _to_operator_out(row: User, organization_name: str | None) -> OperatorOut:
    return OperatorOut(
        id=row.id,
        username=row.username,
        role=row.role,
        org_id=row.org_id,
        organization_name=organization_name,
        first_name=row.first_name,
        last_name=row.last_name,
        country=row.country,
        city=row.city,
        region=row.region,
        is_active=row.is_active,
        created_by_user_id=row.created_by_user_id,
        created_at=row.created_at,
    )


def _full_name(user: User) -> str:
    return " ".join(part for part in [user.first_name, user.last_name] if part).strip() or user.username


def _as_utc(dt: datetime | None) -> datetime | None:
    # DB may return naive timestamps in some environments; normalize everything to UTC.
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _parse_risk_codes_json(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item).strip() for item in parsed if str(item).strip()]


@router.post("/operators", response_model=OperatorOut)
def create_operator(
    payload: OperatorCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> OperatorOut:
    actor_org_id = require_org_id(actor)
    exists = db.query(User).filter(User.username == payload.username).first()
    if exists:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already exists")
    if payload.role == UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Superadmin role cannot be assigned from this endpoint")

    if payload.organization_name and payload.organization_name.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="organization_name is managed by platform setup, not operator create API",
        )
    target_org_id = actor_org_id
    actor_org = db.query(Organization).filter(Organization.id == actor_org_id).first()
    target_org_name = actor_org.name if actor_org else None

    operator = User(
        username=payload.username.strip(),
        password_hash=get_password_hash(payload.password),
        role=payload.role,
        org_id=target_org_id,
        first_name=payload.first_name.strip(),
        last_name=payload.last_name.strip(),
        country=payload.country.strip(),
        city=payload.city.strip(),
        region=payload.region.strip(),
        created_by_user_id=actor.id,
        is_active=True,
    )
    db.add(operator)
    db.commit()
    db.refresh(operator)

    write_audit(
        db,
        action="account_created",
        entity_type="user",
        entity_id=str(operator.id),
        actor_id=actor.id,
        org_id=target_org_id,
        metadata={
            "username": operator.username,
            "role": operator.role.value,
            "org_id": target_org_id,
            "country": operator.country,
            "city": operator.city,
            "region": operator.region,
        },
    )
    db.commit()

    return _to_operator_out(operator, target_org_name)


@router.get("/operators", response_model=list[OperatorOut])
def list_operators(
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> list[OperatorOut]:
    org_id = require_org_id(actor)
    org_map = {row.id: row.name for row in db.query(Organization.id, Organization.name).all()}
    rows = (
        db.query(User)
        .filter(User.role.in_([UserRole.OPERATOR, UserRole.ADMIN]), User.org_id == org_id)
        .order_by(User.created_at.desc())
        .all()
    )
    return [_to_operator_out(row, org_map.get(row.org_id)) for row in rows]


@router.patch("/operators/{operator_id}/status", response_model=OperatorOut)
def update_operator_status(
    operator_id: int,
    payload: OperatorStatusUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> OperatorOut:
    org_id = require_org_id(actor)
    operator = (
        db.query(User)
        .filter(User.id == operator_id, User.role.in_([UserRole.OPERATOR, UserRole.ADMIN]), User.org_id == org_id)
        .first()
    )
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    operator.is_active = payload.is_active
    db.add(operator)
    db.commit()
    db.refresh(operator)

    write_audit(
        db,
        action="account_status_updated",
        entity_type="user",
        entity_id=str(operator.id),
        actor_id=actor.id,
        org_id=org_id,
        metadata={"is_active": operator.is_active, "role": operator.role.value},
    )
    db.commit()

    org_name = db.query(Organization.name).filter(Organization.id == operator.org_id).scalar()
    return _to_operator_out(operator, org_name)


@router.post("/operators/{operator_id}/reset-password", response_model=OperatorOut)
def reset_operator_password(
    operator_id: int,
    payload: OperatorPasswordResetRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> OperatorOut:
    org_id = require_org_id(actor)
    operator = (
        db.query(User)
        .filter(User.id == operator_id, User.role.in_([UserRole.OPERATOR, UserRole.ADMIN]), User.org_id == org_id)
        .first()
    )
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    operator.password_hash = get_password_hash(payload.new_password)
    db.add(operator)
    db.commit()
    db.refresh(operator)

    write_audit(
        db,
        action="account_password_reset",
        entity_type="user",
        entity_id=str(operator.id),
        actor_id=actor.id,
        org_id=org_id,
        metadata={"username": operator.username, "role": operator.role.value},
    )
    db.commit()

    org_name = db.query(Organization.name).filter(Organization.id == operator.org_id).scalar()
    return _to_operator_out(operator, org_name)


@router.patch("/operators/{operator_id}", response_model=OperatorOut)
def update_operator(
    operator_id: int,
    payload: OperatorUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> OperatorOut:
    org_id = require_org_id(actor)
    operator = (
        db.query(User)
        .filter(User.id == operator_id, User.role.in_([UserRole.OPERATOR, UserRole.ADMIN]), User.org_id == org_id)
        .first()
    )
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    updates: dict[str, str] = {}

    if payload.username is not None:
        username = payload.username.strip()
        if not username:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username cannot be empty")
        exists = db.query(User).filter(User.username == username, User.id != operator.id).first()
        if exists:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already exists")
        if username != operator.username:
            operator.username = username
            updates["username"] = username

    if payload.role is not None:
        if payload.role == UserRole.SUPER_ADMIN:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Superadmin role cannot be assigned")
        if payload.role != operator.role:
            operator.role = payload.role
            updates["role"] = payload.role.value

    if payload.first_name is not None:
        first_name = payload.first_name.strip()
        if first_name != (operator.first_name or ""):
            operator.first_name = first_name
            updates["first_name"] = first_name

    if payload.last_name is not None:
        last_name = payload.last_name.strip()
        if last_name != (operator.last_name or ""):
            operator.last_name = last_name
            updates["last_name"] = last_name

    if payload.country is not None:
        country = payload.country.strip()
        if country != (operator.country or ""):
            operator.country = country
            updates["country"] = country

    if payload.city is not None:
        city = payload.city.strip()
        if city != (operator.city or ""):
            operator.city = city
            updates["city"] = city

    if payload.region is not None:
        region = payload.region.strip()
        if region != (operator.region or ""):
            operator.region = region
            updates["region"] = region

    if updates:
        db.add(operator)
        db.commit()
        db.refresh(operator)

        write_audit(
            db,
            action="account_updated",
            entity_type="user",
            entity_id=str(operator.id),
            actor_id=actor.id,
            org_id=org_id,
            metadata=updates,
        )
        db.commit()

    org_name = db.query(Organization.name).filter(Organization.id == operator.org_id).scalar()
    return _to_operator_out(operator, org_name)


@router.get("/analytics/overview", response_model=SuperadminAnalyticsOverview)
def superadmin_analytics_overview(
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> SuperadminAnalyticsOverview:
    org_id = require_org_id(actor)
    operators = db.query(User).filter(User.role == UserRole.OPERATOR, User.org_id == org_id).all()
    submissions = db.query(VideoSubmission).filter(VideoSubmission.org_id == org_id).all()
    analysis_rows = db.query(AnalysisResult).filter(AnalysisResult.org_id == org_id).all()
    analysis_by_submission_id = {row.submission_id: row for row in analysis_rows}

    total_submissions = len(submissions)
    review_ready_count = sum(1 for row in submissions if row.status == SubmissionStatus.REVIEW_READY)
    failed_count = sum(1 for row in submissions if row.status == SubmissionStatus.FAILED)
    ai_success_rate = round((review_ready_count / total_submissions) * 100, 2) if total_submissions else 0.0
    ai_failed_rate = round((failed_count / total_submissions) * 100, 2) if total_submissions else 0.0

    durations = [row.duration_seconds for row in submissions if row.duration_seconds is not None]
    avg_duration = round(sum(durations) / len(durations), 2) if durations else None

    qualities = [row.quality_score for row in analysis_rows if row.quality_score is not None]
    avg_quality = round(sum(qualities) / len(qualities), 2) if qualities else None

    metrics: list[OperatorAnalyticsOut] = []
    for operator in operators:
        op_submissions = [row for row in submissions if row.uploader_id == operator.id]
        op_qualities = [
            analysis_by_submission_id[row.id].quality_score
            for row in op_submissions
            if row.id in analysis_by_submission_id and analysis_by_submission_id[row.id].quality_score is not None
        ]
        op_durations = [row.duration_seconds for row in op_submissions if row.duration_seconds is not None]
        full_name = " ".join(part for part in [operator.first_name, operator.last_name] if part).strip() or operator.username
        metrics.append(
            OperatorAnalyticsOut(
                operator_id=operator.id,
                username=operator.username,
                full_name=full_name,
                assigned_country=operator.country,
                assigned_city=operator.city,
                assigned_region=operator.region,
                upload_count=len(op_submissions),
                review_ready_count=sum(1 for row in op_submissions if row.status == SubmissionStatus.REVIEW_READY),
                failed_count=sum(1 for row in op_submissions if row.status == SubmissionStatus.FAILED),
                approved_count=sum(1 for row in op_submissions if row.status == SubmissionStatus.APPROVED),
                rejected_count=sum(1 for row in op_submissions if row.status == SubmissionStatus.REJECTED),
                avg_quality_score=round(sum(op_qualities) / len(op_qualities), 2) if op_qualities else None,
                avg_duration_seconds=round(sum(op_durations) / len(op_durations), 2) if op_durations else None,
            )
        )

    metrics.sort(key=lambda row: row.upload_count, reverse=True)
    return SuperadminAnalyticsOverview(
        total_operators=len(operators),
        active_operators=sum(1 for row in operators if row.is_active),
        total_submissions=total_submissions,
        ai_success_rate_percent=ai_success_rate,
        ai_failed_rate_percent=ai_failed_rate,
        avg_quality_score=avg_quality,
        avg_duration_seconds=avg_duration,
        operator_metrics=metrics,
    )


@router.get("/analytics/operators/{operator_id}", response_model=OperatorAnalyticsDetailOut)
def operator_analytics_detail(
    operator_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> OperatorAnalyticsDetailOut:
    org_id = require_org_id(actor)
    operator = db.query(User).filter(User.id == operator_id, User.role == UserRole.OPERATOR, User.org_id == org_id).first()
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operator not found")

    submissions = (
        db.query(VideoSubmission)
        .filter(VideoSubmission.uploader_id == operator.id, VideoSubmission.org_id == org_id)
        .order_by(VideoSubmission.created_at.desc())
        .all()
    )
    analysis_rows = (
        db.query(AnalysisResult)
        .filter(
            AnalysisResult.org_id == org_id,
            AnalysisResult.submission_id.in_([row.id for row in submissions]) if submissions else False,
        )
        .all()
    )
    analysis_by_submission_id = {row.submission_id: row for row in analysis_rows}

    total_uploads = len(submissions)
    review_ready_count = sum(1 for row in submissions if row.status == SubmissionStatus.REVIEW_READY)
    failed_count = sum(1 for row in submissions if row.status == SubmissionStatus.FAILED)
    approved_count = sum(1 for row in submissions if row.status == SubmissionStatus.APPROVED)
    rejected_count = sum(1 for row in submissions if row.status == SubmissionStatus.REJECTED)

    ai_success_rate = round((review_ready_count / total_uploads) * 100, 2) if total_uploads else 0.0
    ai_failed_rate = round((failed_count / total_uploads) * 100, 2) if total_uploads else 0.0

    durations = [row.duration_seconds for row in submissions if row.duration_seconds is not None]
    qualities = [row.quality_score for row in analysis_rows if row.quality_score is not None]
    avg_duration = round(sum(durations) / len(durations), 2) if durations else None
    avg_quality = round(sum(qualities) / len(qualities), 2) if qualities else None

    # Son 14 gün trendi
    now = datetime.now(UTC).date()
    day_map: dict[str, list[float]] = {}
    for offset in range(13, -1, -1):
        day_key = (now - timedelta(days=offset)).isoformat()
        day_map[day_key] = []

    upload_count_map: dict[str, int] = {day: 0 for day in day_map}
    for row in submissions:
        day_key = row.created_at.date().isoformat() if row.created_at else None
        if day_key not in day_map:
            continue
        upload_count_map[day_key] += 1
        analysis = analysis_by_submission_id.get(row.id)
        if analysis and analysis.quality_score is not None:
            day_map[day_key].append(analysis.quality_score)

    daily_metrics = [
        OperatorDailyMetricOut(
            day=day,
            upload_count=upload_count_map[day],
            avg_quality_score=round(sum(scores) / len(scores), 2) if scores else None,
        )
        for day, scores in day_map.items()
    ]

    recent_submissions = [
        OperatorSubmissionMetricOut(
            submission_id=row.id,
            no=row.no,
            title=row.title,
            note=row.note,
            status=row.status,
            quality_score=analysis_by_submission_id[row.id].quality_score if row.id in analysis_by_submission_id else None,
            duration_seconds=row.duration_seconds,
            created_at=row.created_at,
        )
        for row in submissions[:30]
    ]

    full_name = " ".join(part for part in [operator.first_name, operator.last_name] if part).strip() or operator.username
    return OperatorAnalyticsDetailOut(
        operator_id=operator.id,
        username=operator.username,
        full_name=full_name,
        assigned_country=operator.country,
        assigned_city=operator.city,
        assigned_region=operator.region,
        total_uploads=total_uploads,
        review_ready_count=review_ready_count,
        failed_count=failed_count,
        approved_count=approved_count,
        rejected_count=rejected_count,
        ai_success_rate_percent=ai_success_rate,
        ai_failed_rate_percent=ai_failed_rate,
        avg_quality_score=avg_quality,
        avg_duration_seconds=avg_duration,
        daily_metrics=daily_metrics,
        recent_submissions=recent_submissions,
    )


@router.get("/analytics/dashboard", response_model=SuperadminStatsDashboardOut)
def superadmin_stats_dashboard(
    online_window_minutes: int = 15,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> SuperadminStatsDashboardOut:
    if online_window_minutes < 1 or online_window_minutes > 240:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="online_window_minutes must be between 1 and 240")
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="date_from must be before date_to")

    org_id = require_org_id(actor)
    now = datetime.now(UTC)
    online_since = now - timedelta(minutes=online_window_minutes)

    users = db.query(User).filter(User.org_id == org_id).all()
    user_by_id = {row.id: row for row in users}
    operators = [row for row in users if row.role == UserRole.OPERATOR]
    admins = [row for row in users if row.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN)]

    submissions_query = db.query(VideoSubmission).filter(VideoSubmission.org_id == org_id)
    if date_from:
        submissions_query = submissions_query.filter(VideoSubmission.created_at >= date_from)
    if date_to:
        submissions_query = submissions_query.filter(VideoSubmission.created_at <= date_to)
    submissions = submissions_query.all()
    submission_ids = [row.id for row in submissions]

    analysis_query = db.query(AnalysisResult).filter(AnalysisResult.org_id == org_id)
    if submission_ids:
        analysis_query = analysis_query.filter(AnalysisResult.submission_id.in_(submission_ids))
    else:
        analysis_query = analysis_query.filter(False)
    analysis_rows = analysis_query.all()
    analysis_by_submission_id = {row.submission_id: row for row in analysis_rows}

    review_query = db.query(ReviewDecision).filter(ReviewDecision.org_id == org_id)
    if date_from:
        review_query = review_query.filter(ReviewDecision.created_at >= date_from)
    if date_to:
        review_query = review_query.filter(ReviewDecision.created_at <= date_to)
    review_rows = review_query.all()

    sms_query = db.query(SmsMessage.status).filter(SmsMessage.org_id == org_id)
    if date_from:
        sms_query = sms_query.filter(SmsMessage.created_at >= date_from)
    if date_to:
        sms_query = sms_query.filter(SmsMessage.created_at <= date_to)
    sms_rows = sms_query.all()

    latest_activity_rows = (
        db.query(AuditEvent.actor_id, func.max(AuditEvent.created_at))
        .filter(AuditEvent.org_id == org_id, AuditEvent.actor_id.is_not(None))
        .group_by(AuditEvent.actor_id)
        .all()
    )
    latest_activity_by_user: dict[int, datetime] = {
        int(actor_id): normalized
        for actor_id, last_at in latest_activity_rows
        if actor_id is not None and (normalized := _as_utc(last_at)) is not None
    }
    recent_activity_rows = (
        db.query(AuditEvent.actor_id, func.max(AuditEvent.created_at))
        .filter(AuditEvent.org_id == org_id, AuditEvent.actor_id.is_not(None), AuditEvent.created_at >= online_since)
        .group_by(AuditEvent.actor_id)
        .all()
    )
    recent_activity_by_user: dict[int, datetime] = {
        int(actor_id): normalized
        for actor_id, last_at in recent_activity_rows
        if actor_id is not None and (normalized := _as_utc(last_at)) is not None
    }

    active_claim_rows = (
        db.query(VideoSubmission.claim_admin_id, VideoSubmission.claim_updated_at)
        .filter(
            VideoSubmission.org_id == org_id,
            VideoSubmission.claim_admin_id.is_not(None),
            VideoSubmission.claim_expires_at.is_not(None),
            VideoSubmission.claim_expires_at > now,
        )
        .all()
    )
    active_claim_count_by_admin: dict[int, int] = {}
    active_claim_last_at_by_admin: dict[int, datetime] = {}
    for admin_id, claim_updated_at in active_claim_rows:
        if admin_id is None:
            continue
        aid = int(admin_id)
        active_claim_count_by_admin[aid] = active_claim_count_by_admin.get(aid, 0) + 1
        normalized_claim_updated_at = _as_utc(claim_updated_at)
        if normalized_claim_updated_at is not None and (
            aid not in active_claim_last_at_by_admin
            or normalized_claim_updated_at > active_claim_last_at_by_admin[aid]
        ):
            active_claim_last_at_by_admin[aid] = normalized_claim_updated_at

    status_counts = SuperadminSubmissionStatusCountsOut(
        uploaded=sum(1 for row in submissions if row.status == SubmissionStatus.UPLOADED),
        processing=sum(1 for row in submissions if row.status == SubmissionStatus.PROCESSING),
        review_ready=sum(1 for row in submissions if row.status == SubmissionStatus.REVIEW_READY),
        approved=sum(1 for row in submissions if row.status == SubmissionStatus.APPROVED),
        rejected=sum(1 for row in submissions if row.status == SubmissionStatus.REJECTED),
        failed=sum(1 for row in submissions if row.status == SubmissionStatus.FAILED),
    )

    quality_scores = [row.quality_score for row in analysis_rows if row.quality_score is not None]
    ai_stats = SuperadminAiStatsOut(
        sample_count=len(quality_scores),
        avg_quality_score=round(sum(quality_scores) / len(quality_scores), 2) if quality_scores else None,
        min_quality_score=min(quality_scores) if quality_scores else None,
        max_quality_score=max(quality_scores) if quality_scores else None,
        low_quality_count=sum(1 for score in quality_scores if score < 60),
        high_quality_count=sum(1 for score in quality_scores if score >= 85),
    )

    operator_stats: list[SuperadminOperatorStatsOut] = []
    for operator in operators:
        op_submissions = [row for row in submissions if row.uploader_id == operator.id]
        op_quality_scores = [
            analysis_by_submission_id[row.id].quality_score
            for row in op_submissions
            if row.id in analysis_by_submission_id and analysis_by_submission_id[row.id].quality_score is not None
        ]
        op_last_upload = max((row.created_at for row in op_submissions), default=None)
        op_risk_locked_count = sum(1 for row in op_submissions if row.risk_locked)
        op_problematic_count = sum(
            1
            for row in op_submissions
            if row.risk_locked or row.status in (SubmissionStatus.FAILED, SubmissionStatus.REJECTED)
        )
        operator_stats.append(
            SuperadminOperatorStatsOut(
                operator_id=operator.id,
                username=operator.username,
                full_name=_full_name(operator),
                country=operator.country,
                city=operator.city,
                region=operator.region,
                upload_count=len(op_submissions),
                video_count=sum(1 for row in op_submissions if row.processed_object_key is not None),
                approved_count=sum(1 for row in op_submissions if row.status == SubmissionStatus.APPROVED),
                rejected_count=sum(1 for row in op_submissions if row.status == SubmissionStatus.REJECTED),
                review_ready_count=sum(1 for row in op_submissions if row.status == SubmissionStatus.REVIEW_READY),
                failed_count=sum(1 for row in op_submissions if row.status == SubmissionStatus.FAILED),
                processing_count=sum(1 for row in op_submissions if row.status == SubmissionStatus.PROCESSING),
                risk_locked_count=op_risk_locked_count,
                problematic_count=op_problematic_count,
                avg_ai_score=round(sum(op_quality_scores) / len(op_quality_scores), 2) if op_quality_scores else None,
                low_ai_score_count=sum(1 for score in op_quality_scores if score < 60),
                last_upload_at=op_last_upload,
                is_online=(operator.id in recent_activity_by_user),
            )
        )
    operator_stats.sort(key=lambda row: (row.upload_count, row.problematic_count), reverse=True)

    review_stats_by_admin: dict[int, dict[str, int]] = {}
    for row in review_rows:
        stats = review_stats_by_admin.setdefault(row.reviewer_id, {"approved": 0, "rejected": 0, "total": 0})
        stats["total"] += 1
        if row.decision == ReviewDecisionType.APPROVED:
            stats["approved"] += 1
        elif row.decision == ReviewDecisionType.REJECTED:
            stats["rejected"] += 1

    sms_actions = (
        db.query(AuditEvent)
        .filter(
            AuditEvent.org_id == org_id,
            AuditEvent.actor_id.is_not(None),
            AuditEvent.action.in_(["sms_dispatched", "sms_dispatched_single", "sms_dispatched_selected", "sms_retry_failed"]),
        )
    )
    if date_from:
        sms_actions = sms_actions.filter(AuditEvent.created_at >= date_from)
    if date_to:
        sms_actions = sms_actions.filter(AuditEvent.created_at <= date_to)
    sms_actions = sms_actions.all()
    sms_stats_by_admin: dict[int, dict[str, int]] = {}
    for row in sms_actions:
        if row.actor_id is None:
            continue
        aid = int(row.actor_id)
        stats = sms_stats_by_admin.setdefault(aid, {"actions": 0, "sent": 0, "failed": 0, "retry": 0})
        stats["actions"] += 1
        if row.action == "sms_retry_failed":
            stats["retry"] += 1

        payload: dict = {}
        if row.metadata_json:
            try:
                parsed = json.loads(row.metadata_json)
                if isinstance(parsed, dict):
                    payload = parsed
            except json.JSONDecodeError:
                payload = {}

        sent_count = 0
        failed_count = 0
        if row.action == "sms_dispatched_single":
            status_value = str(payload.get("status", "")).lower()
            if status_value == SmsStatus.SENT.value:
                sent_count = 1
            elif status_value == SmsStatus.FAILED.value:
                failed_count = 1
        else:
            maybe_sent = payload.get("sent_count")
            maybe_failed = payload.get("failed_count")
            if isinstance(maybe_sent, int):
                sent_count = maybe_sent
            if isinstance(maybe_failed, int):
                failed_count = maybe_failed
        stats["sent"] += sent_count
        stats["failed"] += failed_count

    admin_stats: list[SuperadminAdminStatsOut] = []
    for admin in admins:
        review_stats = review_stats_by_admin.get(admin.id, {"approved": 0, "rejected": 0, "total": 0})
        sms_stats = sms_stats_by_admin.get(admin.id, {"actions": 0, "sent": 0, "failed": 0, "retry": 0})
        last_activity_at = latest_activity_by_user.get(admin.id)
        claim_last_activity = active_claim_last_at_by_admin.get(admin.id)
        if claim_last_activity and (last_activity_at is None or claim_last_activity > last_activity_at):
            last_activity_at = claim_last_activity

        admin_stats.append(
            SuperadminAdminStatsOut(
                admin_id=admin.id,
                username=admin.username,
                full_name=_full_name(admin),
                role=admin.role,
                approved_count=review_stats["approved"],
                rejected_count=review_stats["rejected"],
                review_count=review_stats["total"],
                sms_action_count=sms_stats["actions"],
                sms_sent_count=sms_stats["sent"],
                sms_failed_count=sms_stats["failed"],
                sms_retry_count=sms_stats["retry"],
                active_claim_count=active_claim_count_by_admin.get(admin.id, 0),
                last_activity_at=last_activity_at,
                is_online=(admin.id in recent_activity_by_user) or (admin.id in active_claim_count_by_admin),
            )
        )
    admin_stats.sort(key=lambda row: (row.review_count, row.sms_sent_count), reverse=True)

    online_operator_list: list[SuperadminLiveUserOut] = []
    for operator in operators:
        last_at = recent_activity_by_user.get(operator.id)
        if last_at is None:
            continue
        online_operator_list.append(
            SuperadminLiveUserOut(
                user_id=operator.id,
                username=operator.username,
                full_name=_full_name(operator),
                role=operator.role,
                country=operator.country,
                city=operator.city,
                region=operator.region,
                last_activity_at=last_at,
                activity_source="audit",
            )
        )
    online_operator_list.sort(key=lambda row: row.last_activity_at or datetime.min.replace(tzinfo=UTC), reverse=True)

    online_admin_list: list[SuperadminLiveUserOut] = []
    for admin in admins:
        audit_last_at = recent_activity_by_user.get(admin.id)
        claim_last_at = active_claim_last_at_by_admin.get(admin.id)
        if audit_last_at is None and admin.id not in active_claim_count_by_admin:
            continue

        source = "audit"
        last_at = audit_last_at
        if claim_last_at is not None and (last_at is None or claim_last_at > last_at):
            source = "claim"
            last_at = claim_last_at
        online_admin_list.append(
            SuperadminLiveUserOut(
                user_id=admin.id,
                username=admin.username,
                full_name=_full_name(admin),
                role=admin.role,
                country=admin.country,
                city=admin.city,
                region=admin.region,
                last_activity_at=last_at,
                activity_source=source,
            )
        )
    online_admin_list.sort(key=lambda row: row.last_activity_at or datetime.min.replace(tzinfo=UTC), reverse=True)

    total_sms_sent = sum(1 for row in sms_rows if row.status == SmsStatus.SENT)
    total_sms_failed = sum(1 for row in sms_rows if row.status == SmsStatus.FAILED)
    risk_locked_submissions = sum(1 for row in submissions if row.risk_locked)
    problematic_submissions = sum(
        1 for row in submissions if row.risk_locked or row.status in (SubmissionStatus.FAILED, SubmissionStatus.REJECTED)
    )
    approved_review_count = sum(1 for row in review_rows if row.decision == ReviewDecisionType.APPROVED)

    sms_sent_submission_query = db.query(func.count(func.distinct(SmsMessage.submission_id))).filter(
        SmsMessage.org_id == org_id,
        SmsMessage.status == SmsStatus.SENT,
    )
    if date_from:
        sms_sent_submission_query = sms_sent_submission_query.filter(SmsMessage.created_at >= date_from)
    if date_to:
        sms_sent_submission_query = sms_sent_submission_query.filter(SmsMessage.created_at <= date_to)
    sms_sent_submission_count = sms_sent_submission_query.scalar() or 0

    review_rows_for_sla: dict[int, datetime] = {}
    if submission_ids:
        review_sla_rows = (
            db.query(ReviewDecision.submission_id, ReviewDecision.created_at)
            .filter(ReviewDecision.org_id == org_id, ReviewDecision.submission_id.in_(submission_ids))
            .all()
        )
        for submission_id, created_at in review_sla_rows:
            if submission_id not in review_rows_for_sla or created_at < review_rows_for_sla[submission_id]:
                review_rows_for_sla[submission_id] = created_at

    first_sent_sms_by_submission: dict[int, datetime] = {}
    if submission_ids:
        sms_sla_rows = (
            db.query(SmsMessage.submission_id, SmsMessage.created_at)
            .filter(
                SmsMessage.org_id == org_id,
                SmsMessage.status == SmsStatus.SENT,
                SmsMessage.submission_id.in_(submission_ids),
            )
            .all()
        )
        for submission_id, created_at in sms_sla_rows:
            if submission_id not in first_sent_sms_by_submission or created_at < first_sent_sms_by_submission[submission_id]:
                first_sent_sms_by_submission[submission_id] = created_at

    upload_to_review_minutes: list[float] = []
    review_to_sms_minutes: list[float] = []
    pending_review_over_60m = 0
    approved_without_sms_over_30m = 0
    for submission in submissions:
        upload_completed_at = _as_utc(submission.upload_completed_at)
        created_at = _as_utc(submission.created_at) or now
        review_at = _as_utc(review_rows_for_sla.get(submission.id))
        sms_sent_at = _as_utc(first_sent_sms_by_submission.get(submission.id))
        if upload_completed_at and review_at and review_at >= upload_completed_at:
            upload_to_review_minutes.append((review_at - upload_completed_at).total_seconds() / 60)
        if review_at and sms_sent_at and sms_sent_at >= review_at:
            review_to_sms_minutes.append((sms_sent_at - review_at).total_seconds() / 60)

        age_minutes = (now - created_at).total_seconds() / 60
        if submission.status in (SubmissionStatus.UPLOADED, SubmissionStatus.PROCESSING, SubmissionStatus.REVIEW_READY) and age_minutes > 60:
            pending_review_over_60m += 1
        if submission.status == SubmissionStatus.APPROVED and sms_sent_at is None and age_minutes > 30:
            approved_without_sms_over_30m += 1

    sla = SuperadminSlaOut(
        avg_upload_to_review_minutes=(
            round(sum(upload_to_review_minutes) / len(upload_to_review_minutes), 2)
            if upload_to_review_minutes
            else None
        ),
        avg_review_to_sms_minutes=(
            round(sum(review_to_sms_minutes) / len(review_to_sms_minutes), 2)
            if review_to_sms_minutes
            else None
        ),
        pending_review_over_60m=pending_review_over_60m,
        approved_without_sms_over_30m=approved_without_sms_over_30m,
    )

    issue_counts: dict[tuple[str, str], int] = {}
    issue_submission_ids: set[int] = set()
    for submission in submissions:
        had_issue = False
        if submission.failure_reason:
            reason = submission.failure_reason.strip()
            if reason:
                key = reason[:120]
                issue_counts[("failure_reason", key)] = issue_counts.get(("failure_reason", key), 0) + 1
                had_issue = True

        risk_codes = _parse_risk_codes_json(submission.risk_codes_json)
        for code in risk_codes:
            issue_counts[("risk_code", code)] = issue_counts.get(("risk_code", code), 0) + 1
            had_issue = True

        if submission.risk_locked:
            issue_counts[("risk_state", "risk_locked")] = issue_counts.get(("risk_state", "risk_locked"), 0) + 1
            had_issue = True

        if submission.status == SubmissionStatus.FAILED:
            issue_counts[("status", "failed_submission")] = issue_counts.get(("status", "failed_submission"), 0) + 1
            had_issue = True
        elif submission.status == SubmissionStatus.REJECTED:
            issue_counts[("status", "rejected_submission")] = issue_counts.get(("status", "rejected_submission"), 0) + 1
            had_issue = True

        if had_issue:
            issue_submission_ids.add(submission.id)

    issue_items = sorted(issue_counts.items(), key=lambda item: item[1], reverse=True)[:20]
    issue_breakdown = SuperadminIssueBreakdownOut(
        total_with_issue=len(issue_submission_ids),
        items=[
            SuperadminIssueItemOut(
                source=source,
                key=key,
                count=count,
            )
            for (source, key), count in issue_items
        ],
    )

    trend_ref = _as_utc(date_to) or now
    last_7_start = trend_ref - timedelta(days=7)
    prev_7_start = trend_ref - timedelta(days=14)

    trend_submissions = (
        db.query(VideoSubmission.id, VideoSubmission.uploader_id, VideoSubmission.created_at)
        .filter(
            VideoSubmission.org_id == org_id,
            VideoSubmission.created_at >= prev_7_start,
            VideoSubmission.created_at <= trend_ref,
        )
        .all()
    )
    trend_submission_ids = [row.id for row in trend_submissions]
    trend_analysis_by_submission: dict[int, float] = {}
    if trend_submission_ids:
        trend_analysis_rows = (
            db.query(AnalysisResult.submission_id, AnalysisResult.quality_score)
            .filter(
                AnalysisResult.org_id == org_id,
                AnalysisResult.submission_id.in_(trend_submission_ids),
            )
            .all()
        )
        trend_analysis_by_submission = {submission_id: score for submission_id, score in trend_analysis_rows}

    trend_buckets: dict[int, dict[str, list[float] | int]] = {}
    for row in trend_submissions:
        op = trend_buckets.setdefault(
            row.uploader_id,
            {
                "last_scores": [],
                "prev_scores": [],
                "last_upload_count": 0,
            },
        )
        row_created_at = _as_utc(row.created_at)
        score = trend_analysis_by_submission.get(row.id)
        if row_created_at and row_created_at >= last_7_start:
            op["last_upload_count"] = int(op["last_upload_count"]) + 1
            if score is not None:
                cast_list = op["last_scores"]
                if isinstance(cast_list, list):
                    cast_list.append(score)
        else:
            if score is not None:
                cast_list = op["prev_scores"]
                if isinstance(cast_list, list):
                    cast_list.append(score)

    operator_quality_trends: list[SuperadminOperatorQualityTrendOut] = []
    for operator in operators:
        bucket = trend_buckets.get(operator.id, {"last_scores": [], "prev_scores": [], "last_upload_count": 0})
        last_scores = bucket.get("last_scores", [])
        prev_scores = bucket.get("prev_scores", [])
        last_avg = round(sum(last_scores) / len(last_scores), 2) if isinstance(last_scores, list) and last_scores else None
        prev_avg = round(sum(prev_scores) / len(prev_scores), 2) if isinstance(prev_scores, list) and prev_scores else None
        delta = round(last_avg - prev_avg, 2) if last_avg is not None and prev_avg is not None else None
        trend = "flat"
        if delta is not None:
            if delta > 1:
                trend = "up"
            elif delta < -1:
                trend = "down"
        operator_quality_trends.append(
            SuperadminOperatorQualityTrendOut(
                operator_id=operator.id,
                username=operator.username,
                full_name=_full_name(operator),
                last_7d_avg_quality=last_avg,
                prev_7d_avg_quality=prev_avg,
                delta_quality=delta,
                last_7d_upload_count=int(bucket.get("last_upload_count", 0)),
                trend=trend,
            )
        )
    operator_quality_trends.sort(
        key=lambda row: (
            row.delta_quality if row.delta_quality is not None else -9999,
            row.last_7d_upload_count,
        ),
        reverse=True,
    )

    return SuperadminStatsDashboardOut(
        generated_at=now,
        date_from=date_from,
        date_to=date_to,
        online_window_minutes=online_window_minutes,
        total_operators=len(operators),
        total_admins=len(admins),
        online_operators=len(online_operator_list),
        online_admins=len(online_admin_list),
        total_submissions=len(submissions),
        total_videos=sum(1 for row in submissions if row.processed_object_key is not None),
        total_sms_sent=total_sms_sent,
        total_sms_failed=total_sms_failed,
        risk_locked_submissions=risk_locked_submissions,
        problematic_submissions=problematic_submissions,
        status_counts=status_counts,
        funnel=SuperadminFunnelOut(
            uploaded_count=len(submissions),
            reviewed_count=len(review_rows),
            approved_count=approved_review_count,
            sms_sent_submission_count=sms_sent_submission_count,
            review_rate_percent=round((len(review_rows) / len(submissions)) * 100, 2) if submissions else 0.0,
            approval_rate_percent=(
                round((approved_review_count / len(review_rows)) * 100, 2)
                if review_rows
                else 0.0
            ),
            sms_after_approval_rate_percent=(
                round((sms_sent_submission_count / approved_review_count) * 100, 2)
                if approved_review_count > 0
                else 0.0
            ),
        ),
        sla=sla,
        issue_breakdown=issue_breakdown,
        operator_quality_trends=operator_quality_trends,
        ai_stats=ai_stats,
        online_operator_list=online_operator_list,
        online_admin_list=online_admin_list,
        operator_stats=operator_stats,
        admin_stats=admin_stats,
    )
