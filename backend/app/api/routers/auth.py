from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import create_access_token, verify_password
from app.models import Organization, User
from app.schemas import LoginRequest, TokenResponse, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()
DEFAULT_USERNAMES = {"operator", "admin", "superadmin"}


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    if settings.security_block_default_accounts and payload.username.strip().lower() in DEFAULT_USERNAMES:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Default accounts are disabled. Use managed accounts.",
        )
    user = db.query(User).filter(User.username == payload.username, User.is_active.is_(True)).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    return TokenResponse(access_token=create_access_token(user.username), user_role=user.role)


@router.get("/me", response_model=UserResponse)
def me(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    organization_name: str | None = None
    if current_user.org_id is not None:
        organization = db.query(Organization).filter(Organization.id == current_user.org_id).first()
        organization_name = organization.name if organization else None
    return UserResponse(
        id=current_user.id,
        username=current_user.username,
        role=current_user.role,
        org_id=current_user.org_id,
        organization_name=organization_name,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        country=current_user.country,
        city=current_user.city,
        region=current_user.region,
        is_active=current_user.is_active,
    )
