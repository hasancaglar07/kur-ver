import json

from sqlalchemy.orm import Session

from app.models import AuditEvent


def write_audit(
    db: Session,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    actor_id: int | None,
    org_id: int | None,
    metadata: dict,
) -> None:
    event = AuditEvent(
        actor_id=actor_id,
        org_id=org_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        metadata_json=json.dumps(metadata, ensure_ascii=False),
    )
    db.add(event)
