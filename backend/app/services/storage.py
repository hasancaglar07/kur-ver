import hashlib
import hmac
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode

from app.core.config import get_settings

try:  # boto3 sadece B2 modunda gerekli
    import boto3
except Exception:  # noqa: BLE001
    boto3 = None


class LocalStorageService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.base_dir = self.settings.storage_dir
        self.raw_dir = self.base_dir / self.settings.raw_dir
        self.processed_dir = self.base_dir / self.settings.processed_dir
        self.intro_dir = self.base_dir / self.settings.intro_dir
        self._b2_client = None

    def raw_path(self, key: str) -> Path:
        return self.raw_dir / key

    def processed_path(self, key: str) -> Path:
        return self.processed_dir / key

    def ensure_intro(self) -> Path:
        intro = self.intro_dir / self.settings.intro_filename
        if not intro.exists():
            # Placeholder intro; production should replace this with a real MP4 asset.
            intro.write_bytes(b"INTRO_PLACEHOLDER")
        return intro

    def _storage_provider(self) -> str:
        return self.settings.storage_provider.strip().lower()

    def _is_b2(self) -> bool:
        return self._storage_provider() == "b2"

    def _b2_ready(self) -> bool:
        return bool(
            self.settings.b2_endpoint_url
            and self.settings.b2_access_key_id
            and self.settings.b2_secret_access_key
            and self.settings.b2_bucket
        )

    def _get_b2_client(self):
        if not self._is_b2():
            return None
        if not self._b2_ready():
            raise RuntimeError("B2 is enabled but required settings are missing")
        if boto3 is None:
            raise RuntimeError("boto3 dependency is missing for B2 storage mode")
        if self._b2_client is None:
            self._b2_client = boto3.client(
                "s3",
                endpoint_url=self.settings.b2_endpoint_url,
                region_name=self.settings.b2_region,
                aws_access_key_id=self.settings.b2_access_key_id,
                aws_secret_access_key=self.settings.b2_secret_access_key,
            )
        return self._b2_client

    def _b2_raw_key(self, object_key: str) -> str:
        prefix = self.settings.b2_raw_prefix.strip("/")
        return f"{prefix}/{object_key}" if prefix else object_key

    def _b2_processed_key(self, object_key: str) -> str:
        prefix = self.settings.b2_processed_prefix.strip("/")
        return f"{prefix}/{object_key}" if prefix else object_key

    def _b2_upload_file(self, local_path: Path, remote_key: str) -> None:
        client = self._get_b2_client()
        if not client:
            return

        extra_args: dict = {}
        if self.settings.b2_object_lock_enabled:
            retain_until = datetime.now(UTC) + timedelta(days=max(1, self.settings.b2_archive_years) * 365)
            extra_args["ObjectLockMode"] = self.settings.b2_object_lock_mode
            extra_args["ObjectLockRetainUntilDate"] = retain_until

        if extra_args:
            client.upload_file(
                Filename=str(local_path),
                Bucket=self.settings.b2_bucket,
                Key=remote_key,
                ExtraArgs=extra_args,
            )
            return

        client.upload_file(
            Filename=str(local_path),
            Bucket=self.settings.b2_bucket,
            Key=remote_key,
        )

    def upload_raw_archive(self, local_path: Path, object_key: str) -> None:
        if not self._is_b2():
            return
        self._b2_upload_file(local_path=local_path, remote_key=self._b2_raw_key(object_key))

    def upload_processed_archive(self, local_path: Path, object_key: str) -> None:
        if not self._is_b2():
            return
        self._b2_upload_file(local_path=local_path, remote_key=self._b2_processed_key(object_key))

    def build_temporary_processed_download_url(self, object_key: str) -> str | None:
        if not self._is_b2():
            return None
        client = self._get_b2_client()
        if not client:
            return None
        return client.generate_presigned_url(
            ClientMethod="get_object",
            Params={"Bucket": self.settings.b2_bucket, "Key": self._b2_processed_key(object_key)},
            ExpiresIn=self.settings.b2_watch_url_ttl_seconds,
        )

    def build_signed_watch_url(self, object_key: str) -> str:
        expires_at = int(time.time()) + self.settings.signed_url_ttl_seconds
        data = f"{object_key}:{expires_at}".encode("utf-8")
        signature = hmac.new(self.settings.signed_url_secret.encode("utf-8"), data, hashlib.sha256).hexdigest()
        query = urlencode({"key": object_key, "exp": expires_at, "sig": signature})
        return f"{self.settings.public_watch_base_url}/api/watch?{query}"
