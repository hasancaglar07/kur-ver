export type UserRole = "operator" | "admin" | "super_admin";
export type SubmissionChangeRequestStatus = "open" | "approved" | "rejected";
export type SubmissionChangeRequestType = "wrong_upload" | "duplicate_upload";

export interface MeResponse {
  id: number;
  username: string;
  role: UserRole;
  org_id: number | null;
  organization_name: string | null;
  first_name: string | null;
  last_name: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  is_active: boolean;
}

export type SubmissionStatus =
  | "uploaded"
  | "processing"
  | "review_ready"
  | "approved"
  | "rejected"
  | "failed";

export interface SubmissionItem {
  id: number;
  country: string;
  city: string;
  region: string;
  no: string;
  status: SubmissionStatus;
  quality_score: number | null;
  sms_sent_count: number;
  sms_failed_count: number;
  sms_pending_count: number;
  sms_last_status: string | null;
  preview_watch_url: string | null;
  duration_seconds: number | null;
  failure_reason?: string | null;
  review_decision?: "approved" | "rejected" | null;
  review_note?: string | null;
  risk_locked: boolean;
  risk_codes: string[];
  risk_lock_note: string | null;
  latest_request_status?: SubmissionChangeRequestStatus | null;
  latest_request_admin_note?: string | null;
  latest_request_resolved_at?: string | null;
  latest_request_reason_type?: SubmissionChangeRequestType | null;
  claimed_by_admin_id?: number | null;
  claim_expires_at?: string | null;
  claim_note?: string | null;
  last_admin_action?: string | null;
  last_admin_actor_id?: number | null;
  last_admin_actor_username?: string | null;
  last_admin_action_at?: string | null;
  queue_priority_score?: number | null;
  created_age_minutes?: number | null;
  sla_due_at?: string | null;
  sla_breached?: boolean;
  created_at: string;
}

export interface SubmissionDetail extends SubmissionItem {
  raw_object_key: string;
  processed_object_key: string | null;
  preview_watch_url: string | null;
  sms_watch_url: string | null;
  sms_preview_text: string | null;
  duration_seconds: number | null;
  failure_reason: string | null;
  review_decision?: "approved" | "rejected" | null;
  review_note?: string | null;
  transcript_text: string | null;
  ocr_text: string | null;
  extracted_no: string | null;
  risk_locked: boolean;
  risk_codes: string[];
  risk_lock_note: string | null;
  analysis_mode: string | null;
  extracted_names: Array<{
    full_name: string;
    source: string;
    confidence: number;
    low_confidence: boolean;
  }>;
  matches: Array<{
    donor_record_id: number;
    match_type: string;
    score: number;
    evidence_source: string;
  }>;
  donors: Array<{
    donor_record_id: number;
    no: string;
    full_name: string;
    phone: string;
    matched: boolean;
    match_type: string | null;
    score: number | null;
    evidence_source: string | null;
  }>;
}

export interface OperatorLogsResponse {
  summary: {
    total_uploads: number;
    avg_duration_seconds: number | null;
    by_region: Record<string, number>;
    by_status: Record<string, number>;
  };
  items: SubmissionItem[];
}

export interface SubmissionChangeRequestItem {
  id: number;
  submission_id: number;
  operator_id: number;
  operator_username: string | null;
  submission_no: string | null;
  submission_region: string | null;
  reason_type: SubmissionChangeRequestType;
  note: string;
  status: SubmissionChangeRequestStatus;
  admin_note: string | null;
  resolved_by: number | null;
  resolved_at: string | null;
  created_at: string;
}

export interface AdminActionLogItem {
  id: number;
  action: string;
  actor_id: number;
  actor_username: string;
  submission_id: number | null;
  submission_no: string | null;
  submission_region: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface AdminLogsResponse {
  total_actions: number;
  items: AdminActionLogItem[];
}

export interface OpsOverview {
  total_submissions: number;
  processing_count: number;
  failed_total: number;
  failed_last_24h: number;
  recent_failed_submissions: Array<{
    id: number;
    no: string;
    region: string;
    status: SubmissionStatus;
    failure_reason: string | null;
    created_at: string;
    updated_at: string;
  }>;
  recent_audit_events: Array<{
    id: number;
    action: string;
    entity_type: string;
    entity_id: string;
    actor_id: number | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
}

export interface OperatorAccount {
  id: number;
  username: string;
  role: UserRole;
  org_id: number | null;
  organization_name?: string | null;
  first_name: string | null;
  last_name: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  is_active: boolean;
  created_by_user_id: number | null;
  created_at: string;
}

export interface SuperadminAnalyticsOverview {
  total_operators: number;
  active_operators: number;
  total_submissions: number;
  ai_success_rate_percent: number;
  ai_failed_rate_percent: number;
  avg_quality_score: number | null;
  avg_duration_seconds: number | null;
  operator_metrics: Array<{
    operator_id: number;
    username: string;
    full_name: string;
    assigned_country: string | null;
    assigned_city: string | null;
    assigned_region: string | null;
    upload_count: number;
    review_ready_count: number;
    failed_count: number;
    approved_count: number;
    rejected_count: number;
    avg_quality_score: number | null;
    avg_duration_seconds: number | null;
  }>;
}

export interface SuperadminStatsDashboard {
  generated_at: string;
  date_from: string | null;
  date_to: string | null;
  online_window_minutes: number;
  total_operators: number;
  total_admins: number;
  online_operators: number;
  online_admins: number;
  total_submissions: number;
  total_videos: number;
  total_sms_sent: number;
  total_sms_failed: number;
  risk_locked_submissions: number;
  problematic_submissions: number;
  status_counts: {
    uploaded: number;
    processing: number;
    review_ready: number;
    approved: number;
    rejected: number;
    failed: number;
  };
  funnel: {
    uploaded_count: number;
    reviewed_count: number;
    approved_count: number;
    sms_sent_submission_count: number;
    review_rate_percent: number;
    approval_rate_percent: number;
    sms_after_approval_rate_percent: number;
  };
  sla: {
    avg_upload_to_review_minutes: number | null;
    avg_review_to_sms_minutes: number | null;
    pending_review_over_60m: number;
    approved_without_sms_over_30m: number;
  };
  issue_breakdown: {
    total_with_issue: number;
    items: Array<{
      key: string;
      source: string;
      count: number;
    }>;
  };
  operator_quality_trends: Array<{
    operator_id: number;
    username: string;
    full_name: string;
    last_7d_avg_quality: number | null;
    prev_7d_avg_quality: number | null;
    delta_quality: number | null;
    last_7d_upload_count: number;
    trend: "up" | "down" | "flat" | string;
  }>;
  ai_stats: {
    sample_count: number;
    avg_quality_score: number | null;
    min_quality_score: number | null;
    max_quality_score: number | null;
    low_quality_count: number;
    high_quality_count: number;
  };
  online_operator_list: Array<{
    user_id: number;
    username: string;
    full_name: string;
    role: UserRole;
    country: string | null;
    city: string | null;
    region: string | null;
    last_activity_at: string | null;
    activity_source: string | null;
  }>;
  online_admin_list: Array<{
    user_id: number;
    username: string;
    full_name: string;
    role: UserRole;
    country: string | null;
    city: string | null;
    region: string | null;
    last_activity_at: string | null;
    activity_source: string | null;
  }>;
  operator_stats: Array<{
    operator_id: number;
    username: string;
    full_name: string;
    country: string | null;
    city: string | null;
    region: string | null;
    upload_count: number;
    video_count: number;
    approved_count: number;
    rejected_count: number;
    review_ready_count: number;
    failed_count: number;
    processing_count: number;
    risk_locked_count: number;
    problematic_count: number;
    avg_ai_score: number | null;
    low_ai_score_count: number;
    last_upload_at: string | null;
    is_online: boolean;
  }>;
  admin_stats: Array<{
    admin_id: number;
    username: string;
    full_name: string;
    role: UserRole;
    approved_count: number;
    rejected_count: number;
    review_count: number;
    sms_action_count: number;
    sms_sent_count: number;
    sms_failed_count: number;
    sms_retry_count: number;
    active_claim_count: number;
    last_activity_at: string | null;
    is_online: boolean;
  }>;
}

export interface OperatorAnalyticsDetail {
  operator_id: number;
  username: string;
  full_name: string;
  assigned_country: string | null;
  assigned_city: string | null;
  assigned_region: string | null;
  total_uploads: number;
  review_ready_count: number;
  failed_count: number;
  approved_count: number;
  rejected_count: number;
  ai_success_rate_percent: number;
  ai_failed_rate_percent: number;
  avg_quality_score: number | null;
  avg_duration_seconds: number | null;
  daily_metrics: Array<{
    day: string;
    upload_count: number;
    avg_quality_score: number | null;
  }>;
  recent_submissions: Array<{
    submission_id: number;
    no: string;
    title: string | null;
    note: string | null;
    status: SubmissionStatus;
    quality_score: number | null;
    duration_seconds: number | null;
    created_at: string;
  }>;
}

export interface ImportResponse {
  imported_count: number;
  updated_count: number;
  skipped_count: number;
  missing_required_count: number;
  invalid_phone_count: number;
  duplicate_in_file_count: number;
  duplicate_in_db_count: number;
  errors: string[];
}
