from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.roles import (
    ReviewDecisionType,
    SmsStatus,
    SubmissionChangeRequestStatus,
    SubmissionChangeRequestType,
    SubmissionStatus,
    UserRole,
)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.OPERATOR)
    first_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    country: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    city: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    region: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    org_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True)


class Organization(Base, TimestampMixin):
    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    slug: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(default=True)


class DonorRecord(Base, TimestampMixin):
    __tablename__ = "donor_records"
    __table_args__ = (
        UniqueConstraint("no", "first_name", "last_name", "phone", name="uq_donor_identity"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    no: Mapped[str] = mapped_column(String(32), index=True)
    country: Mapped[str] = mapped_column(String(128), index=True)
    city: Mapped[str] = mapped_column(String(128), index=True)
    region: Mapped[str] = mapped_column(String(128), index=True)
    first_name: Mapped[str] = mapped_column(String(128), index=True)
    last_name: Mapped[str] = mapped_column(String(128), index=True)
    phone: Mapped[str] = mapped_column(String(32), index=True)
    source_batch_id: Mapped[str] = mapped_column(String(128), default="manual")
    org_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)


class VideoSubmission(Base, TimestampMixin):
    __tablename__ = "video_submissions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    uploader_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    org_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)

    country: Mapped[str] = mapped_column(String(128), index=True)
    city: Mapped[str] = mapped_column(String(128), index=True)
    region: Mapped[str] = mapped_column(String(128), index=True)
    no: Mapped[str] = mapped_column(String(32), index=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    raw_object_key: Mapped[str] = mapped_column(String(255), unique=True)
    processed_object_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    intro_version: Mapped[str | None] = mapped_column(String(64), nullable=True)

    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    file_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    file_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    upload_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    risk_locked: Mapped[bool] = mapped_column(default=False, index=True)
    risk_codes_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    risk_lock_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    risk_overridden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    risk_overridden_by: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    claim_admin_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    claim_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claim_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    claim_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[SubmissionStatus] = mapped_column(Enum(SubmissionStatus), default=SubmissionStatus.UPLOADED)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    uploader: Mapped[User] = relationship()


class AnalysisResult(Base, TimestampMixin):
    __tablename__ = "analysis_results"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("video_submissions.id"), unique=True, index=True)
    org_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)

    transcript_text: Mapped[str] = mapped_column(Text)
    ocr_text: Mapped[str] = mapped_column(Text)
    extracted_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    extracted_names_json: Mapped[str] = mapped_column(Text)
    confidence_json: Mapped[str] = mapped_column(Text)
    quality_score: Mapped[float] = mapped_column(Float)


class MatchResult(Base, TimestampMixin):
    __tablename__ = "match_results"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("video_submissions.id"), index=True)
    donor_record_id: Mapped[int] = mapped_column(ForeignKey("donor_records.id"), index=True)
    org_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)

    match_type: Mapped[str] = mapped_column(String(16))
    score: Mapped[float] = mapped_column(Float)
    evidence_source: Mapped[str] = mapped_column(String(16))


class ReviewDecision(Base, TimestampMixin):
    __tablename__ = "review_decisions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("video_submissions.id"), unique=True, index=True)
    reviewer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    org_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)

    decision: Mapped[ReviewDecisionType] = mapped_column(Enum(ReviewDecisionType))
    decision_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    final_quality_score: Mapped[float] = mapped_column(Float)


class SmsMessage(Base, TimestampMixin):
    __tablename__ = "sms_messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("video_submissions.id"), index=True)
    org_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    phone: Mapped[str] = mapped_column(String(32), index=True)
    template_id: Mapped[str] = mapped_column(String(64), default="kurban_video_v1")
    status: Mapped[SmsStatus] = mapped_column(Enum(SmsStatus), default=SmsStatus.PENDING)
    provider_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    message_text: Mapped[str] = mapped_column(Text)


class AuditEvent(Base, TimestampMixin):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    actor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    org_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    action: Mapped[str] = mapped_column(String(128), index=True)
    entity_type: Mapped[str] = mapped_column(String(64), index=True)
    entity_id: Mapped[str] = mapped_column(String(64), index=True)
    metadata_json: Mapped[str] = mapped_column(Text)


class SubmissionChangeRequest(Base, TimestampMixin):
    __tablename__ = "submission_change_requests"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("video_submissions.id"), index=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    org_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    reason_type: Mapped[SubmissionChangeRequestType] = mapped_column(Enum(SubmissionChangeRequestType))
    note: Mapped[str] = mapped_column(Text)
    status: Mapped[SubmissionChangeRequestStatus] = mapped_column(
        Enum(SubmissionChangeRequestStatus),
        default=SubmissionChangeRequestStatus.OPEN,
        index=True,
    )
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
