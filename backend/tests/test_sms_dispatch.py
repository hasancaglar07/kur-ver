from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.routers.submissions import _has_successful_sms, _send_and_log_single_sms
from app.core.database import Base
from app.core.roles import SmsStatus, SubmissionStatus, UserRole
from app.models import SmsMessage, User, VideoSubmission
from app.services.sms import SmsProvider, SmsSendResult


class FlakyProvider(SmsProvider):
    def __init__(self, outcomes: list[bool]) -> None:
        self.outcomes = outcomes
        self.calls = 0

    def send(self, phone: str, message: str) -> SmsSendResult:  # noqa: ARG002
        ok = self.outcomes[min(self.calls, len(self.outcomes) - 1)]
        self.calls += 1
        return SmsSendResult(ok=ok, provider_ref=f"ref-{self.calls}", error=None if ok else "failed")


def _make_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Session = sessionmaker(bind=engine)
    Base.metadata.create_all(engine)
    return Session


def _seed_submission(db) -> VideoSubmission:
    user = User(username="admin_t", password_hash="hashed", role=UserRole.ADMIN, is_active=True)
    db.add(user)
    db.flush()
    submission = VideoSubmission(
        uploader_id=user.id,
        country="TR",
        city="IST",
        region="R1",
        no="101",
        raw_object_key="raw_x.mp4",
        processed_object_key="processed_x.mp4",
        intro_version="v1",
        duration_seconds=90,
        status=SubmissionStatus.APPROVED,
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)
    return submission


def test_send_and_log_single_sms_retries_until_success() -> None:
    Session = _make_session()
    with Session() as db:
        submission = _seed_submission(db)
        provider = FlakyProvider([False, False, True])

        sms_row, attempts = _send_and_log_single_sms(
            db=db,
            provider=provider,
            submission=submission,
            phone="905551112233",
            message_text="test",
        )
        db.commit()

        assert attempts == 3
        assert sms_row.status == SmsStatus.SENT
        assert provider.calls == 3


def test_has_successful_sms_detects_duplicate_by_masked_phone() -> None:
    Session = _make_session()
    with Session() as db:
        submission = _seed_submission(db)
        db.add(
            SmsMessage(
                submission_id=submission.id,
                phone="***2233",
                status=SmsStatus.SENT,
                provider_ref="ok-1",
                message_text="already sent",
            )
        )
        db.commit()

        assert _has_successful_sms(db, submission.id, "905551112233")
        assert not _has_successful_sms(db, submission.id, "905551119999")
