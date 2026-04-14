from minio import Minio
from minio.error import S3Error
from config import settings
from datetime import timedelta
import logging
from typing import Optional
import os
import shutil
import subprocess
import time

logger = logging.getLogger(__name__)


class MinioClient:
    def __init__(self):
        self.client: Optional[Minio] = None
        self.available = False
        self.bucket_name = settings.MINIO_BUCKET_NAME
        self._auto_start_attempted = False
        self._connect()

    def _compose_file_path(self) -> str:
        return os.path.join(os.path.dirname(__file__), "..", "docker-compose.yml")

    def _project_dir(self) -> str:
        return os.path.dirname(__file__)

    def _try_start_minio_via_docker(self) -> bool:
        if self._auto_start_attempted:
            return False
        self._auto_start_attempted = True

        if str(getattr(settings, "APP_ENV", "development")).lower() == "production":
            return False

        compose_file = self._compose_file_path()
        if not os.path.exists(compose_file):
            logger.warning("MinIO auto-start skipped: docker-compose.yml not found at %s", compose_file)
            return False

        docker_cmd = None
        if shutil.which("docker"):
            docker_cmd = ["docker", "compose"]
        elif shutil.which("docker-compose"):
            docker_cmd = ["docker-compose"]
        else:
            logger.warning("MinIO auto-start skipped: docker/docker-compose not found in PATH")
            return False

        cmd = docker_cmd + ["-f", compose_file, "up", "-d", "minio"]
        try:
            logger.info("MinIO unavailable, attempting auto-start: %s", " ".join(cmd))
            result = subprocess.run(
                cmd,
                cwd=self._project_dir(),
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            if result.returncode != 0:
                logger.warning(
                    "MinIO auto-start command failed (code=%s): %s",
                    result.returncode,
                    (result.stderr or result.stdout or "").strip(),
                )
                return False
            # Give container a short warm-up window before reconnect.
            time.sleep(2.0)
            logger.info("MinIO auto-start command finished successfully")
            return True
        except Exception as e:
            logger.warning("MinIO auto-start exception: %s", e)
            return False

    def _connect(self, allow_auto_start: bool = True):
        try:
            self.client = Minio(
                settings.MINIO_ENDPOINT,
                access_key=settings.MINIO_ACCESS_KEY,
                secret_key=settings.MINIO_SECRET_KEY,
                secure=settings.MINIO_USE_SSL,
            )
            self._ensure_bucket()
            self.available = True
        except Exception as e:
            self.available = False
            self.client = None
            logger.warning(
                "MinIO unavailable at startup (%s). "
                "Document file APIs will degrade until MinIO is reachable.",
                e,
            )
            if allow_auto_start and self._try_start_minio_via_docker():
                self._connect(allow_auto_start=False)

    def _ensure_bucket(self):
        """Ensure bucket exists, create if not"""
        try:
            if self.client is None:
                raise RuntimeError("MinIO client not initialized")
            if not self.client.bucket_exists(self.bucket_name):
                self.client.make_bucket(self.bucket_name)
                logger.info(f"Created bucket: {self.bucket_name}")
            else:
                logger.info(f"Bucket already exists: {self.bucket_name}")
        except Exception as e:
            logger.error(f"MinIO connection failed: {e}")
            raise

    def _ensure_ready(self) -> bool:
        if self.available and self.client is not None:
            return True
        self._connect()
        return self.available and self.client is not None

    def upload_file(
        self,
        file_data: bytes,
        object_name: str,
        content_type: str = "application/octet-stream",
    ):
        """Upload file to MinIO"""
        from io import BytesIO

        if not self._ensure_ready():
            logger.error("MinIO unavailable: upload_file skipped")
            return False

        try:
            self.client.put_object(
                self.bucket_name,
                object_name,
                BytesIO(file_data),
                length=len(file_data),
                content_type=content_type,
            )
            logger.info(f"Uploaded file: {object_name}")
            return True
        except S3Error as e:
            logger.error(f"Error uploading file: {e}")
            return False

    def get_presigned_url(
        self,
        object_name: str,
        expires: timedelta = timedelta(hours=1),
        response_disposition: str = None,
    ):
        """Get presigned URL for file viewing"""
        if not self._ensure_ready():
            logger.error("MinIO unavailable: get_presigned_url skipped")
            return None

        try:
            response_headers = {}
            if response_disposition:
                response_headers["response-content-disposition"] = response_disposition

            url = self.client.presigned_get_object(
                self.bucket_name,
                object_name,
                expires=expires,
                response_headers=response_headers if response_headers else None,
            )
            return url
        except S3Error as e:
            logger.error(f"Error generating presigned URL: {e}")
            return None

    def get_presigned_download_url(
        self, object_name: str, filename: str, expires: timedelta = timedelta(hours=1)
    ):
        """Get presigned URL for file download with content-disposition header"""
        if not self._ensure_ready():
            logger.error("MinIO unavailable: get_presigned_download_url skipped")
            return None

        try:
            # Add response headers to force download
            url = self.client.presigned_get_object(
                self.bucket_name,
                object_name,
                expires=expires,
                response_headers={
                    "response-content-disposition": f'attachment; filename="{filename}"'
                },
            )
            return url
        except S3Error as e:
            logger.error(f"Error generating presigned download URL: {e}")
            return None

    def delete_file(self, object_name: str):
        """Delete file from MinIO"""
        if not self._ensure_ready():
            logger.error("MinIO unavailable: delete_file skipped")
            return False

        try:
            self.client.remove_object(self.bucket_name, object_name)
            logger.info(f"Deleted file: {object_name}")
            return True
        except S3Error as e:
            logger.error(f"Error deleting file: {e}")
            return False

    def file_exists(self, object_name: str) -> bool:
        """Check if file exists in MinIO"""
        if not self._ensure_ready():
            logger.error("MinIO unavailable: file_exists fallback to False")
            return False

        try:
            self.client.stat_object(self.bucket_name, object_name)
            return True
        except S3Error as e:
            if e.code == "NoSuchKey":
                return False
            logger.error(f"Error checking file existence: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error checking file: {e}")
            return False
    def copy_object(self, source_object_name: str, dest_object_name: str) -> bool:
        """Copy object within the same bucket"""
        from minio.commonconfig import CopySource

        if not self._ensure_ready():
            logger.error("MinIO unavailable: copy_object skipped")
            return False

        try:
            self.client.copy_object(
                self.bucket_name,
                dest_object_name,
                CopySource(self.bucket_name, source_object_name),
            )
            logger.info(f"Copied file from {source_object_name} to {dest_object_name}")
            return True
        except Exception as e:
            logger.error(f"Error copying file: {e}")
            return False

# Singleton instance
minio_client = MinioClient()
