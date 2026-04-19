from datetime import UTC, datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.deps import require_roles
from app.api.routers.submissions import override_submission_risk, send_sms_to_donor, send_sms_to_selected_donors
from app.core.database import Base
from app.core.roles import SubmissionStatus, UserRole
from app.models import User, VideoSubmission
from app.schemas import RiskOverrideRequest, SmsBulkDispatchRequest, SmsSingleDispatchRequest


def _make_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Session = sessionmaker(bind=engine)
    Base.metadata.create_all(engine)
    return Session


def _seed_admin(db) -> User:
    admin = User(username="admin_test", password_hash="hashed", role=UserRole.ADMIN, is_active=True, org_id=1)
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def _seed_submission(
    db,
    *,
    uploader_id: int,
    status: SubmissionStatus,
    risk_locked: bool,
    processed: bool,
) -> VideoSubmission:
    submission = VideoSubmission(
        uploader_id=uploader_id,
        org_id=1,
        country="TR",
        city="IST",
        region="R1",
        no="101",
        raw_object_key=f"raw_{status.value}.mp4",
        processed_object_key="processed.mp4" if processed else None,
        status=status,
        risk_locked=risk_locked,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)
    return submission


def test_require_roles_blocks_admin_for_operator_superadmin_guard() -> None:
    guard = require_roles(UserRole.OPERATOR, UserRole.SUPER_ADMIN)
    admin = User(username="a", password_hash="x", role=UserRole.ADMIN, is_active=True)
    with pytest.raises(HTTPException) as exc:
        guard(user=admin)
    assert exc.value.status_code == 403


def test_require_roles_blocks_admin_for_superadmin_only_guard() -> None:
    guard = require_roles(UserRole.SUPER_ADMIN)
    admin = User(username="a", password_hash="x", role=UserRole.ADMIN, is_active=True)
    with pytest.raises(HTTPException) as exc:
        guard(user=admin)
    assert exc.value.status_code == 403


def test_single_sms_requires_approved_status() -> None:
    Session = _make_session()
    with Session() as db:
        admin = _seed_admin(db)
        submission = _seed_submission(
            db,
            uploader_id=admin.id,
            status=SubmissionStatus.REVIEW_READY,
            risk_locked=False,
            processed=True,
        )

        with pytest.raises(HTTPException) as exc:
            send_sms_to_donor(
                submission_id=submission.id,
                payload=SmsSingleDispatchRequest(donor_record_id=1),
                db=db,
                admin=admin,
            )
        assert exc.value.status_code == 400
        assert "approved" in str(exc.value.detail).lower()


def test_selected_sms_requires_approved_status() -> None:
    Session = _make_session()
    with Session() as db:
        admin = _seed_admin(db)
        submission = _seed_submission(
            db,
            uploader_id=admin.id,
            status=SubmissionStatus.REVIEW_READY,
            risk_locked=False,
            processed=True,
        )

        with pytest.raises(HTTPException) as exc:
            send_sms_to_selected_donors(
                submission_id=submission.id,
                payload=SmsBulkDispatchRequest(donor_record_ids=[1]),
                db=db,
                admin=admin,
            )
        assert exc.value.status_code == 400
        assert "approved" in str(exc.value.detail).lower()


def test_risk_override_requires_locked_submission() -> None:
    Session = _make_session()
    with Session() as db:
        admin = _seed_admin(db)
        submission = _seed_submission(
            db,
            uploader_id=admin.id,
            status=SubmissionStatus.REVIEW_READY,
            risk_locked=False,
            processed=True,
        )

        with pytest.raises(HTTPException) as exc:
            override_submission_risk(
                submission_id=submission.id,
                payload=RiskOverrideRequest(note="Geçerli uzun override notu"),
                db=db,
                admin=admin,
            )
        assert exc.value.status_code == 400
        assert "risk locked" in str(exc.value.detail).lower()

