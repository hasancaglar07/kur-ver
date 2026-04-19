from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import require_org_id, require_roles
from app.core.database import get_db
from app.core.roles import UserRole
from app.models import User
from app.schemas import ImportResponse
from app.services.audit import write_audit
from app.services.importer import import_file

router = APIRouter(prefix="/db", tags=["db"])


@router.post("/import", response_model=ImportResponse)
def import_db(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> ImportResponse:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".xlsx", ".xlsm", ".csv"}:
        raise HTTPException(status_code=400, detail="Only .xlsx, .xlsm and .csv are supported")

    temp_name = f"import_{uuid4()}{suffix}"
    temp_path = Path("/tmp") / temp_name

    with temp_path.open("wb") as out:
        while chunk := file.file.read(1024 * 1024):
            out.write(chunk)

    batch_id = datetime.utcnow().strftime("batch_%Y%m%d_%H%M%S")
    try:
        summary = import_file(db, temp_path, batch_id=batch_id, org_id=require_org_id(admin))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        if temp_path.exists():
            temp_path.unlink()

    write_audit(
        db,
        action="db_import",
        entity_type="donor_records",
        entity_id=batch_id,
        actor_id=admin.id,
        org_id=require_org_id(admin),
        metadata={
            "imported_count": summary.imported_count,
            "updated_count": summary.updated_count,
            "skipped_count": summary.skipped_count,
            "missing_required_count": summary.missing_required_count,
            "invalid_phone_count": summary.invalid_phone_count,
            "duplicate_in_file_count": summary.duplicate_in_file_count,
            "duplicate_in_db_count": summary.duplicate_in_db_count,
            "errors": summary.errors,
        },
    )
    db.commit()

    return ImportResponse(
        imported_count=summary.imported_count,
        updated_count=summary.updated_count,
        skipped_count=summary.skipped_count,
        missing_required_count=summary.missing_required_count,
        invalid_phone_count=summary.invalid_phone_count,
        duplicate_in_file_count=summary.duplicate_in_file_count,
        duplicate_in_db_count=summary.duplicate_in_db_count,
        errors=summary.errors,
    )
