# Kurban Video Verification Platform

This repository now includes a working MVP implementation from the approved plan:

- `backend/` FastAPI API (auth, upload, AI provider-chain pipeline, review, SMS dispatch, donor import)
- `frontend/` Next.js admin/uploader UI
- seeded sample data from `db.xlsx`

## Implemented MVP Scope

- ID/password login with roles (`operator`, `admin`, `superadmin`)
- Upload flow: `init -> file upload -> complete`
- Async submission processing (Redis + RQ worker)
- MP4 duration validation (1-3 minutes)
- Intro versioning placeholder + processed object output
- AI analysis with provider chain (`claude-main -> glm-main -> vertex-main`) and OCR from sampled video frames
- Exact + fuzzy name matching with Turkish normalization
- Quality score calculation and 3-band review semantics
- Admin review endpoint (`approved/rejected`)
- SMS adapter pattern with mock provider and deduplicated NO-based recipients
- Signed watch URL endpoint for processed videos
- Donor DB import (`.xlsx` or `.csv`) with upsert logic
- Audit events for key actions

## Quick Start

### 1) Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API will run on `http://localhost:8000`.

Ayrı bir terminalde worker başlatın:

```bash
cd backend
source .venv/bin/activate
python -m app.worker
```

Gerçek AI analizi için `.env` dosyasında provider key ve URL'leri tanımlayın:

```env
AI_PROVIDER=chain
AI_PROVIDER_ORDER=claude-main,glm-main,vertex-main
CODEFAST_API_KEY=your_codefast_key
GOOGLE_API_KEY=your_google_or_vertex_key
VERTEX_PROJECT_ID=your_project_id
VERTEX_LOCATION=us-central1
VERTEX_MAIN_MODEL=gemini-2.5-flash-lite
VERTEX_FALLBACK_MODEL=gemini-2.5-flash
AI_ALLOW_MOCK_FALLBACK=true
```

Not: Anahtarlar eksikse sistem otomatik mock fallback'e döner.

Queue ayarları:

```env
QUEUE_MODE=redis
REDIS_URL=redis://localhost:6379/0
REDIS_QUEUE_NAME=video_pipeline
QUEUE_JOB_TIMEOUT_SECONDS=1200
```

Default users:

- `operator / operator123`
- `admin / admin123`
- `superadmin / superadmin123`

### 2) Frontend

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

UI will run on `http://localhost:3000`.

## Core API Endpoints

- `POST /api/auth/login`
- `POST /api/uploads/init`
- `POST /api/uploads/{submission_id}/file`
- `POST /api/uploads/{submission_id}/complete`
- `GET /api/submissions`
- `GET /api/submissions/{id}`
- `POST /api/submissions/{id}/review`
- `POST /api/submissions/{id}/sms/send`
- `GET /api/submissions/{id}/sms`
- `POST /api/db/import`
- `GET /api/watch?key=...&exp=...&sig=...`

## Tests

```bash
cd backend
source .venv/bin/activate
pytest
```

## Notes

- Video intro prepend/transcoding currently uses a placeholder implementation (copy) and should be replaced with ffmpeg in production.
- AI analysis now uses a multi-provider fallback chain and enables OCR from video frames. Extracted `NO` and names are matched against imported Excel DB records.
- SMS is provider-agnostic through adapter design; a real provider integration can replace the mock sender.
