from datetime import datetime

from pydantic import BaseModel, Field

from app.core.roles import (
    ReviewDecisionType,
    SubmissionChangeRequestStatus,
    SubmissionChangeRequestType,
    SubmissionStatus,
    UserRole,
)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_role: UserRole


class LoginRequest(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    role: UserRole
    org_id: int | None = None
    organization_name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    country: str | None = None
    city: str | None = None
    region: str | None = None
    is_active: bool = True


class UploadInitRequest(BaseModel):
    country: str
    city: str
    region: str
    no: str
    original_filename: str
    title: str | None = None
    note: str | None = None


class UploadInitResponse(BaseModel):
    submission_id: int
    upload_path: str
    raw_object_key: str
    status: SubmissionStatus


class UploadCompleteResponse(BaseModel):
    submission_id: int
    status: SubmissionStatus


class SubmissionListItem(BaseModel):
    id: int
    country: str
    city: str
    region: str
    no: str
    title: str | None = None
    note: str | None = None
    uploader_username: str | None = None
    uploader_full_name: str | None = None
    status: SubmissionStatus
    quality_score: float | None = None
    sms_sent_count: int = 0
    sms_failed_count: int = 0
    sms_pending_count: int = 0
    sms_last_status: str | None = None
    preview_watch_url: str | None = None
    duration_seconds: float | None = None
    failure_reason: str | None = None
    review_decision: ReviewDecisionType | None = None
    review_note: str | None = None
    risk_locked: bool = False
    risk_codes: list[str] = []
    risk_lock_note: str | None = None
    latest_request_status: SubmissionChangeRequestStatus | None = None
    latest_request_admin_note: str | None = None
    latest_request_resolved_at: datetime | None = None
    latest_request_reason_type: SubmissionChangeRequestType | None = None
    claimed_by_admin_id: int | None = None
    claim_expires_at: datetime | None = None
    claim_note: str | None = None
    last_admin_action: str | None = None
    last_admin_actor_id: int | None = None
    last_admin_actor_username: str | None = None
    last_admin_action_at: datetime | None = None
    queue_priority_score: float | None = None
    created_age_minutes: int | None = None
    sla_due_at: datetime | None = None
    sla_breached: bool = False
    created_at: datetime


class MatchResultOut(BaseModel):
    donor_record_id: int
    match_type: str
    score: float
    evidence_source: str


class MatchOverrideRequest(BaseModel):
    donor_record_ids: list[int]
    note: str | None = None


class MatchOverrideResponse(BaseModel):
    submission_id: int
    matched_count: int
    match_type: str = "manual"


class DonorMatchOut(BaseModel):
    donor_record_id: int
    no: str
    full_name: str
    phone: str
    matched: bool
    match_type: str | None = None
    score: float | None = None
    evidence_source: str | None = None


class ExtractedNameOut(BaseModel):
    full_name: str
    source: str
    confidence: float
    low_confidence: bool


class SubmissionDetail(BaseModel):
    id: int
    country: str
    city: str
    region: str
    no: str
    title: str | None = None
    note: str | None = None
    uploader_username: str | None = None
    uploader_full_name: str | None = None
    status: SubmissionStatus
    raw_object_key: str
    processed_object_key: str | None
    preview_watch_url: str | None = None
    sms_watch_url: str | None = None
    sms_preview_text: str | None = None
    duration_seconds: float | None
    failure_reason: str | None
    transcript_text: str | None
    ocr_text: str | None
    extracted_no: str | None
    quality_score: float | None
    review_decision: ReviewDecisionType | None = None
    review_note: str | None = None
    risk_locked: bool = False
    risk_codes: list[str] = []
    risk_lock_note: str | None = None
    claimed_by_admin_id: int | None = None
    claim_expires_at: datetime | None = None
    claim_note: str | None = None
    last_admin_action: str | None = None
    last_admin_actor_id: int | None = None
    last_admin_actor_username: str | None = None
    last_admin_action_at: datetime | None = None
    analysis_mode: str | None = None
    extracted_names: list[ExtractedNameOut]
    matches: list[MatchResultOut]
    donors: list[DonorMatchOut]
    created_at: datetime


class ReviewRequest(BaseModel):
    decision: ReviewDecisionType
    decision_note: str | None = None
    override_quality_score: float | None = Field(default=None, ge=0, le=100)


class SubmissionNoUpdateRequest(BaseModel):
    no: str = Field(min_length=1, max_length=32)
    note: str | None = Field(default=None, max_length=500)


class SubmissionNoUpdateResponse(BaseModel):
    submission_id: int
    no: str
    risk_locked: bool
    risk_codes: list[str]


class ReviewResponse(BaseModel):
    submission_id: int
    status: SubmissionStatus
    decision: ReviewDecisionType
    decision_note: str | None = None
    final_quality_score: float


class SmsDispatchResponse(BaseModel):
    submission_id: int
    sent_count: int
    failed_count: int


class SmsSingleDispatchRequest(BaseModel):
    donor_record_id: int


class SmsSingleDispatchResponse(BaseModel):
    submission_id: int
    donor_record_id: int
    phone: str
    status: str
    provider_ref: str | None


class SmsBulkDispatchRequest(BaseModel):
    donor_record_ids: list[int] = Field(min_length=1)
    force_resend: bool = False


class SmsBulkDispatchResponse(BaseModel):
    submission_id: int
    requested_count: int
    unique_phone_count: int
    sent_count: int
    failed_count: int
    skipped_count: int


class SmsMessageOut(BaseModel):
    id: int
    phone: str
    status: str
    provider_ref: str | None
    message_text: str
    created_at: datetime


class ImportResponse(BaseModel):
    imported_count: int
    updated_count: int
    skipped_count: int
    missing_required_count: int = 0
    invalid_phone_count: int = 0
    duplicate_in_file_count: int = 0
    duplicate_in_db_count: int = 0
    errors: list[str]


class FailedSubmissionOut(BaseModel):
    id: int
    no: str
    region: str
    status: SubmissionStatus
    failure_reason: str | None
    created_at: datetime
    updated_at: datetime


class AuditEventOut(BaseModel):
    id: int
    action: str
    entity_type: str
    entity_id: str
    actor_id: int | None
    metadata: dict
    created_at: datetime


class OpsOverviewResponse(BaseModel):
    total_submissions: int
    processing_count: int
    failed_total: int
    failed_last_24h: int
    recent_failed_submissions: list[FailedSubmissionOut]
    recent_audit_events: list[AuditEventOut]


class OperatorCreateRequest(BaseModel):
    username: str
    password: str = Field(min_length=8, max_length=128)
    organization_name: str | None = None
    role: UserRole = UserRole.OPERATOR
    first_name: str
    last_name: str
    country: str
    city: str
    region: str


class OperatorStatusUpdateRequest(BaseModel):
    is_active: bool


class OperatorPasswordResetRequest(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class OperatorUpdateRequest(BaseModel):
    username: str | None = None
    role: UserRole | None = None
    first_name: str | None = None
    last_name: str | None = None
    country: str | None = None
    city: str | None = None
    region: str | None = None


class OperatorOut(BaseModel):
    id: int
    username: str
    role: UserRole
    org_id: int | None = None
    organization_name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    country: str | None = None
    city: str | None = None
    region: str | None = None
    is_active: bool
    created_by_user_id: int | None = None
    created_at: datetime


class OperatorAnalyticsOut(BaseModel):
    operator_id: int
    username: str
    full_name: str
    assigned_country: str | None = None
    assigned_city: str | None = None
    assigned_region: str | None = None
    upload_count: int
    review_ready_count: int
    failed_count: int
    approved_count: int
    rejected_count: int
    avg_quality_score: float | None = None
    avg_duration_seconds: float | None = None


class SuperadminAnalyticsOverview(BaseModel):
    total_operators: int
    active_operators: int
    total_submissions: int
    ai_success_rate_percent: float
    ai_failed_rate_percent: float
    avg_quality_score: float | None = None
    avg_duration_seconds: float | None = None
    operator_metrics: list[OperatorAnalyticsOut]


class SuperadminAiStatsOut(BaseModel):
    sample_count: int
    avg_quality_score: float | None = None
    min_quality_score: float | None = None
    max_quality_score: float | None = None
    low_quality_count: int = 0
    high_quality_count: int = 0


class SuperadminLiveUserOut(BaseModel):
    user_id: int
    username: str
    full_name: str
    role: UserRole
    country: str | None = None
    city: str | None = None
    region: str | None = None
    last_activity_at: datetime | None = None
    activity_source: str | None = None


class SuperadminOperatorStatsOut(BaseModel):
    operator_id: int
    username: str
    full_name: str
    country: str | None = None
    city: str | None = None
    region: str | None = None
    upload_count: int
    video_count: int
    approved_count: int
    rejected_count: int
    review_ready_count: int
    failed_count: int
    processing_count: int
    risk_locked_count: int
    problematic_count: int
    avg_ai_score: float | None = None
    low_ai_score_count: int = 0
    last_upload_at: datetime | None = None
    is_online: bool


class SuperadminAdminStatsOut(BaseModel):
    admin_id: int
    username: str
    full_name: str
    role: UserRole
    approved_count: int
    rejected_count: int
    review_count: int
    sms_action_count: int
    sms_sent_count: int
    sms_failed_count: int
    sms_retry_count: int
    active_claim_count: int
    last_activity_at: datetime | None = None
    is_online: bool


class SuperadminSubmissionStatusCountsOut(BaseModel):
    uploaded: int = 0
    processing: int = 0
    review_ready: int = 0
    approved: int = 0
    rejected: int = 0
    failed: int = 0


class SuperadminFunnelOut(BaseModel):
    uploaded_count: int = 0
    reviewed_count: int = 0
    approved_count: int = 0
    sms_sent_submission_count: int = 0
    review_rate_percent: float = 0.0
    approval_rate_percent: float = 0.0
    sms_after_approval_rate_percent: float = 0.0


class SuperadminSlaOut(BaseModel):
    avg_upload_to_review_minutes: float | None = None
    avg_review_to_sms_minutes: float | None = None
    pending_review_over_60m: int = 0
    approved_without_sms_over_30m: int = 0


class SuperadminIssueItemOut(BaseModel):
    key: str
    source: str
    count: int


class SuperadminIssueBreakdownOut(BaseModel):
    total_with_issue: int = 0
    items: list[SuperadminIssueItemOut]


class SuperadminOperatorQualityTrendOut(BaseModel):
    operator_id: int
    username: str
    full_name: str
    last_7d_avg_quality: float | None = None
    prev_7d_avg_quality: float | None = None
    delta_quality: float | None = None
    last_7d_upload_count: int = 0
    trend: str = "flat"


class SuperadminStatsDashboardOut(BaseModel):
    generated_at: datetime
    date_from: datetime | None = None
    date_to: datetime | None = None
    online_window_minutes: int
    total_operators: int
    total_admins: int
    online_operators: int
    online_admins: int
    total_submissions: int
    total_videos: int
    total_sms_sent: int
    total_sms_failed: int
    risk_locked_submissions: int
    problematic_submissions: int
    status_counts: SuperadminSubmissionStatusCountsOut
    funnel: SuperadminFunnelOut
    sla: SuperadminSlaOut
    issue_breakdown: SuperadminIssueBreakdownOut
    operator_quality_trends: list[SuperadminOperatorQualityTrendOut]
    ai_stats: SuperadminAiStatsOut
    online_operator_list: list[SuperadminLiveUserOut]
    online_admin_list: list[SuperadminLiveUserOut]
    operator_stats: list[SuperadminOperatorStatsOut]
    admin_stats: list[SuperadminAdminStatsOut]


class OperatorSubmissionMetricOut(BaseModel):
    submission_id: int
    no: str
    title: str | None = None
    note: str | None = None
    status: SubmissionStatus
    quality_score: float | None = None
    duration_seconds: float | None = None
    created_at: datetime


class OperatorDailyMetricOut(BaseModel):
    day: str
    upload_count: int
    avg_quality_score: float | None = None


class OperatorAnalyticsDetailOut(BaseModel):
    operator_id: int
    username: str
    full_name: str
    assigned_country: str | None = None
    assigned_city: str | None = None
    assigned_region: str | None = None
    total_uploads: int
    review_ready_count: int
    failed_count: int
    approved_count: int
    rejected_count: int
    ai_success_rate_percent: float
    ai_failed_rate_percent: float
    avg_quality_score: float | None = None
    avg_duration_seconds: float | None = None
    daily_metrics: list[OperatorDailyMetricOut]
    recent_submissions: list[OperatorSubmissionMetricOut]


class UploadCancelRequestIn(BaseModel):
    reason_type: SubmissionChangeRequestType
    note: str = Field(min_length=5, max_length=1000)


class SubmissionChangeRequestOut(BaseModel):
    id: int
    submission_id: int
    operator_id: int
    operator_username: str | None = None
    submission_no: str | None = None
    submission_region: str | None = None
    reason_type: SubmissionChangeRequestType
    note: str
    status: SubmissionChangeRequestStatus
    admin_note: str | None = None
    resolved_by: int | None = None
    resolved_at: datetime | None = None
    created_at: datetime


class SubmissionChangeRequestResolveIn(BaseModel):
    decision: SubmissionChangeRequestStatus
    decision_note: str = Field(min_length=3, max_length=1000)


class RiskOverrideRequest(BaseModel):
    note: str = Field(min_length=10, max_length=1000)


class OperatorLogsSummaryOut(BaseModel):
    total_uploads: int
    avg_duration_seconds: float | None = None
    by_region: dict[str, int]
    by_status: dict[str, int]


class OperatorLogsResponse(BaseModel):
    summary: OperatorLogsSummaryOut
    items: list[SubmissionListItem]


class SubmissionClaimRequest(BaseModel):
    note: str | None = None


class SubmissionClaimResponse(BaseModel):
    submission_id: int
    claimed_by_admin_id: int
    claim_expires_at: datetime
    claim_note: str | None = None


class AdminActionLogOut(BaseModel):
    id: int
    action: str
    actor_id: int
    actor_username: str
    submission_id: int | None = None
    submission_no: str | None = None
    submission_region: str | None = None
    created_at: datetime
    metadata: dict


class AdminLogsResponse(BaseModel):
    total_actions: int
    items: list[AdminActionLogOut]
