from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Kurban Video Platform"
    api_prefix: str = "/api"

    secret_key: str = "change-this-secret-key"
    access_token_minutes: int = 60
    security_block_default_accounts: bool = False

    database_url: str = "sqlite:///./kurban.db"

    storage_dir: Path = Path("storage")
    raw_dir: str = "raw"
    processed_dir: str = "processed"
    intro_dir: str = "intro"
    intro_filename: str = "default_intro.mp4"

    storage_provider: str = "local"  # local | b2
    b2_endpoint_url: str | None = None
    b2_region: str = "us-east-005"
    b2_access_key_id: str | None = None
    b2_secret_access_key: str | None = None
    b2_bucket: str | None = None
    b2_raw_prefix: str = "raw"
    b2_processed_prefix: str = "processed"
    b2_watch_url_ttl_seconds: int = 60 * 30
    b2_archive_years: int = 5
    b2_object_lock_enabled: bool = False
    b2_object_lock_mode: str = "GOVERNANCE"

    signed_url_secret: str = Field(default="signed-url-secret")
    signed_url_ttl_seconds: int = 60 * 60 * 24 * 7
    public_watch_base_url: str = "http://localhost:8000"
    public_share_base_url: str = "http://localhost:3000"

    min_duration_seconds: int = 10
    max_duration_seconds: int = 180
    max_upload_size_bytes: int = 300 * 1024 * 1024
    queue_mode: str = "redis"  # redis | inline
    redis_url: str = "redis://redis:6379/0"
    redis_queue_name: str = "video_pipeline"
    queue_job_timeout_seconds: int = 60 * 20

    # AI configuration
    ai_provider: str = "chain"  # chain | mock
    ai_allow_mock_fallback: bool = False
    ai_language: str = "tr"
    ai_name_detection_threshold: float = 0.86
    ai_provider_order: str = "claude-main,glm-main,vertex-main"
    ai_min_viable_transcript_words: int = 6
    ai_frame_sample_count: int = 6
    ai_frame_jpeg_quality: int = 82
    ai_vertex_inline_video_max_bytes: int = 18_000_000

    codefast_api_key: str | None = None
    anthropic_api_key: str | None = None
    google_api_key: str | None = None
    vertex_api_key: str | None = None
    vertex_project_id: str | None = None
    vertex_location: str = "us-central1"

    claude_main_base_url: str = "https://claudecode.codefast.app"
    claude_main_model: str = "claude-sonnet-4-20250514"

    glm_main_base_url: str = "https://claudecode2.codefast.app"
    glm_main_model: str = "GLM-5.1"

    vertex_main_model: str = "gemini-2.5-flash-lite"
    vertex_fallback_model: str = "gemini-2.5-flash"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    (settings.storage_dir / settings.raw_dir).mkdir(parents=True, exist_ok=True)
    (settings.storage_dir / settings.processed_dir).mkdir(parents=True, exist_ok=True)
    (settings.storage_dir / settings.intro_dir).mkdir(parents=True, exist_ok=True)
    return settings
