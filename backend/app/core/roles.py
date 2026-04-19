from enum import StrEnum


class UserRole(StrEnum):
    OPERATOR = "operator"
    ADMIN = "admin"
    SUPER_ADMIN = "super_admin"


class SubmissionStatus(StrEnum):
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    REVIEW_READY = "review_ready"
    APPROVED = "approved"
    REJECTED = "rejected"
    FAILED = "failed"


class ReviewDecisionType(StrEnum):
    APPROVED = "approved"
    REJECTED = "rejected"


class SmsStatus(StrEnum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"


class SubmissionChangeRequestType(StrEnum):
    WRONG_UPLOAD = "wrong_upload"
    DUPLICATE_UPLOAD = "duplicate_upload"


class SubmissionChangeRequestStatus(StrEnum):
    OPEN = "open"
    APPROVED = "approved"
    REJECTED = "rejected"
