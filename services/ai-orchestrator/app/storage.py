"""S3-compatible storage client for voice recordings and artifacts."""

from __future__ import annotations

import hashlib
import os
from datetime import timedelta
from typing import Any

from minio import Minio


class StorageClient:
    """Thin wrapper around MinIO for mock-credential mode."""

    def __init__(self) -> None:
        self.endpoint = os.environ.get("MINIO_ENDPOINT", "minio:9000")
        self.access_key = os.environ.get("MINIO_ROOT_USER", "minioadmin")
        self.secret_key = os.environ.get("MINIO_ROOT_PASSWORD", "minioadmin")
        self.bucket = os.environ.get("MINIO_BUCKET_MEDIA", "media")
        self.secure = os.environ.get("MINIO_SECURE", "false").lower() == "true"
        self._client: Minio | None = None

    def _client_instance(self) -> Minio:
        if self._client is None:
            self._client = Minio(
                self.endpoint,
                access_key=self.access_key,
                secret_key=self.secret_key,
                secure=self.secure,
            )
        return self._client

    def ensure_bucket(self) -> None:
        client = self._client_instance()
        if not client.bucket_exists(self.bucket):
            client.make_bucket(self.bucket)

    def upload_recording(
        self,
        session_id: str,
        media_bytes: bytes,
        content_type: str = "audio/wav",
        extension: str = ".wav",
    ) -> dict[str, Any]:
        """Upload a recording and return a signed URI + checksum."""
        self.ensure_bucket()
        checksum = hashlib.sha256(media_bytes).hexdigest()
        object_name = f"recordings/{session_id}/{checksum}{extension}"
        client = self._client_instance()
        from io import BytesIO

        client.put_object(
            self.bucket,
            object_name,
            data=BytesIO(media_bytes),
            length=len(media_bytes),
            content_type=content_type,
            metadata={"x-amz-meta-sha256": checksum},
        )
        url = client.presigned_get_object(
            self.bucket,
            object_name,
            expires=timedelta(hours=24),
        )
        return {
            "uri": url,
            "objectName": object_name,
            "checksum": {"algorithm": "sha256", "value": checksum},
            "sizeBytes": len(media_bytes),
        }

    def upload_analysis_artifact(
        self,
        session_id: str,
        question_id: str | None,
        name: str,
        json_bytes: bytes,
    ) -> dict[str, Any]:
        """Persist one analysis artifact under the analysis/ prefix."""
        self.ensure_bucket()
        checksum = hashlib.sha256(json_bytes).hexdigest()
        object_name = f"analysis/{session_id}/{question_id or 'session'}/{name}.json"
        client = self._client_instance()
        from io import BytesIO

        client.put_object(
            self.bucket,
            object_name,
            data=BytesIO(json_bytes),
            length=len(json_bytes),
            content_type="application/json",
            metadata={"x-amz-meta-sha256": checksum},
        )
        return {
            "objectName": object_name,
            "checksum": {"algorithm": "sha256", "value": checksum},
            "sizeBytes": len(json_bytes),
        }
