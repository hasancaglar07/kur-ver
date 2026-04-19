import hashlib
import hmac
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse

from app.api.router import api_router
from app.core.config import get_settings
from app.core.database import Base, SessionLocal, engine
from app.core.roles import UserRole
from app.core.security import get_password_hash
from app.models import DonorRecord, Organization, User, VideoSubmission
from app.services.importer import import_file
from app.services.storage import LocalStorageService

settings = get_settings()
storage = LocalStorageService()

app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix=settings.api_prefix)


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    _run_lightweight_migrations()
    default_org_id = _seed_default_organization()
    _backfill_org_references(default_org_id)
    _seed_default_users()
    _seed_default_donors()


def _add_column_if_missing(table: str, column: str, ddl: str) -> None:
    with engine.begin() as conn:
        rows = conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()
        existing = {row[1] for row in rows}
        if column in existing:
            return
        conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def _run_lightweight_migrations() -> None:
    _add_column_if_missing("users", "first_name", "VARCHAR(128)")
    _add_column_if_missing("users", "last_name", "VARCHAR(128)")
    _add_column_if_missing("users", "country", "VARCHAR(128)")
    _add_column_if_missing("users", "city", "VARCHAR(128)")
    _add_column_if_missing("users", "region", "VARCHAR(128)")
    _add_column_if_missing("users", "created_by_user_id", "INTEGER")
    _add_column_if_missing("users", "org_id", "INTEGER")
    _add_column_if_missing("donor_records", "org_id", "INTEGER")
    _add_column_if_missing("video_submissions", "org_id", "INTEGER")
    _add_column_if_missing("analysis_results", "org_id", "INTEGER")
    _add_column_if_missing("match_results", "org_id", "INTEGER")
    _add_column_if_missing("review_decisions", "org_id", "INTEGER")
    _add_column_if_missing("sms_messages", "org_id", "INTEGER")
    _add_column_if_missing("audit_events", "org_id", "INTEGER")
    _add_column_if_missing("video_submissions", "title", "VARCHAR(255)")
    _add_column_if_missing("video_submissions", "note", "TEXT")
    _add_column_if_missing("video_submissions", "file_sha256", "VARCHAR(64)")
    _add_column_if_missing("video_submissions", "file_size_bytes", "INTEGER")
    _add_column_if_missing("video_submissions", "upload_completed_at", "DATETIME")
    _add_column_if_missing("video_submissions", "risk_locked", "BOOLEAN DEFAULT 0")
    _add_column_if_missing("video_submissions", "risk_codes_json", "TEXT")
    _add_column_if_missing("video_submissions", "risk_lock_note", "TEXT")
    _add_column_if_missing("video_submissions", "risk_overridden_at", "DATETIME")
    _add_column_if_missing("video_submissions", "risk_overridden_by", "INTEGER")
    _add_column_if_missing("video_submissions", "claim_admin_id", "INTEGER")
    _add_column_if_missing("video_submissions", "claim_expires_at", "DATETIME")
    _add_column_if_missing("video_submissions", "claim_note", "TEXT")
    _add_column_if_missing("video_submissions", "claim_updated_at", "DATETIME")
    _create_submission_change_requests_table_if_missing()


def _create_submission_change_requests_table_if_missing() -> None:
    with engine.begin() as conn:
        conn.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS submission_change_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                submission_id INTEGER NOT NULL,
                operator_id INTEGER NOT NULL,
                org_id INTEGER,
                reason_type VARCHAR(32) NOT NULL,
                note TEXT NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'open',
                admin_note TEXT,
                resolved_by INTEGER,
                resolved_at DATETIME,
                created_at DATETIME,
                updated_at DATETIME
            )
            """
        )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_submission_change_requests_submission_id ON submission_change_requests (submission_id)"
        )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_submission_change_requests_operator_id ON submission_change_requests (operator_id)"
        )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_submission_change_requests_org_id ON submission_change_requests (org_id)"
        )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_submission_change_requests_status ON submission_change_requests (status)"
        )


def _seed_default_organization() -> int:
    db = SessionLocal()
    try:
        org = db.query(Organization).filter(Organization.slug == "default").first()
        if org:
            return org.id
        org = Organization(name="Default Organization", slug="default", is_active=True)
        db.add(org)
        db.commit()
        db.refresh(org)
        return org.id
    finally:
        db.close()


def _backfill_org_references(default_org_id: int) -> None:
    with engine.begin() as conn:
        conn.exec_driver_sql("UPDATE users SET org_id = ? WHERE org_id IS NULL", (default_org_id,))
        conn.exec_driver_sql("UPDATE donor_records SET org_id = ? WHERE org_id IS NULL", (default_org_id,))
        conn.exec_driver_sql("UPDATE video_submissions SET org_id = ? WHERE org_id IS NULL", (default_org_id,))
        conn.exec_driver_sql("UPDATE analysis_results SET org_id = ? WHERE org_id IS NULL", (default_org_id,))
        conn.exec_driver_sql("UPDATE match_results SET org_id = ? WHERE org_id IS NULL", (default_org_id,))
        conn.exec_driver_sql("UPDATE review_decisions SET org_id = ? WHERE org_id IS NULL", (default_org_id,))
        conn.exec_driver_sql("UPDATE sms_messages SET org_id = ? WHERE org_id IS NULL", (default_org_id,))
        conn.exec_driver_sql("UPDATE audit_events SET org_id = ? WHERE org_id IS NULL", (default_org_id,))


def _seed_default_users() -> None:
    db = SessionLocal()
    try:
        default_org = db.query(Organization).filter(Organization.slug == "default").first()
        if not default_org:
            return
        defaults = [
            ("operator", "operator123", UserRole.OPERATOR),
            ("admin", "admin123", UserRole.ADMIN),
            ("superadmin", "superadmin123", UserRole.SUPER_ADMIN),
        ]
        for username, password, role in defaults:
            existing = db.query(User).filter(User.username == username).first()
            if existing:
                if existing.org_id is None:
                    existing.org_id = default_org.id
                    db.add(existing)
                continue
            db.add(
                User(
                    username=username,
                    password_hash=get_password_hash(password),
                    role=role,
                    org_id=default_org.id,
                    is_active=True,
                )
            )
        db.commit()
    finally:
        db.close()


def _seed_default_donors() -> None:
    db = SessionLocal()
    try:
        default_org = db.query(Organization).filter(Organization.slug == "default").first()
        if not default_org:
            return

        count = db.query(DonorRecord).filter(DonorRecord.org_id == default_org.id).count()
        if count > 0:
            return

        repo_root = Path(__file__).resolve().parents[2]
        sample = repo_root / "db.xlsx"
        if sample.exists():
            import_file(db, sample, batch_id="sample_seed", org_id=default_org.id)
    finally:
        db.close()


@app.get("/")
def health() -> dict:
    return {
        "service": settings.app_name,
        "status": "ok",
        "api_prefix": settings.api_prefix,
    }


@app.get("/api/watch")
def watch_video(
    key: str = Query(...),
    exp: int = Query(...),
    sig: str = Query(...),
):
    expected_data = f"{key}:{exp}".encode("utf-8")
    expected_sig = hmac.new(settings.signed_url_secret.encode("utf-8"), expected_data, hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected_sig, sig):
        raise HTTPException(status_code=403, detail="Invalid signature")
    if exp < int(time.time()):
        raise HTTPException(status_code=403, detail="Expired link")

    try:
        remote_url = storage.build_temporary_processed_download_url(key)
    except Exception:  # noqa: BLE001
        remote_url = None
    if remote_url:
        return RedirectResponse(url=remote_url, status_code=307)

    path = storage.processed_path(key)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    return FileResponse(path=path, media_type="video/mp4", filename=path.name)


def _base36_to_int(value: str) -> int:
    return int(value, 36)


@app.get("/w/s/{token}")
def watch_video_short(token: str):
    try:
        sid_b36, sig = token.split("-", 1)
        submission_id = _base36_to_int(sid_b36)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=403, detail="Invalid token") from exc

    expected_data = f"share:{sid_b36}".encode("utf-8")
    expected_sig = hmac.new(settings.signed_url_secret.encode("utf-8"), expected_data, hashlib.sha256).hexdigest()[:8]

    if not hmac.compare_digest(expected_sig, sig):
        raise HTTPException(status_code=403, detail="Invalid signature")

    db = SessionLocal()
    try:
        submission = db.query(VideoSubmission).filter(VideoSubmission.id == submission_id).first()
        if not submission or not submission.processed_object_key:
            raise HTTPException(status_code=404, detail="Video not found")
        key = submission.processed_object_key
    finally:
        db.close()

    try:
        remote_url = storage.build_temporary_processed_download_url(key)
    except Exception:  # noqa: BLE001
        remote_url = None
    if remote_url:
        return RedirectResponse(url=remote_url, status_code=307)

    path = storage.processed_path(key)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(path=path, media_type="video/mp4", filename=path.name)
