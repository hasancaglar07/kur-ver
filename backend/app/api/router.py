from fastapi import APIRouter

from app.api.routers import auth, db_import, submissions, superadmin, uploads

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(uploads.router)
api_router.include_router(submissions.router)
api_router.include_router(db_import.router)
api_router.include_router(superadmin.router)
