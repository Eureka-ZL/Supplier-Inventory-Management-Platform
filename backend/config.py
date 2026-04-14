from typing import List
from pydantic import model_validator
from pydantic_settings import BaseSettings


DEFAULT_DATABASE_URL = "postgresql://gatekeeper:gatekeeper123@localhost:5432/supplier_gatekeeper"
DEFAULT_MINIO_ACCESS_KEY = "minioadmin"
DEFAULT_MINIO_SECRET_KEY = "minioadmin"
DEFAULT_JWT_SECRET_KEY = "your-super-secret-jwt-key-change-in-production"


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = DEFAULT_DATABASE_URL

    # MinIO
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = DEFAULT_MINIO_ACCESS_KEY
    MINIO_SECRET_KEY: str = DEFAULT_MINIO_SECRET_KEY
    MINIO_BUCKET_NAME: str = "supplier-documents"
    MINIO_USE_SSL: bool = False

    # JWT
    JWT_SECRET_KEY: str = DEFAULT_JWT_SECRET_KEY
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours

    # CORS
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    # Application
    APP_ENV: str = "development"
    DEBUG: bool = True

    # PMC / Gmail Integration
    GOOGLE_APPLICATION_CREDENTIALS: str = "service_account.json"
    PMC_TARGET_EMAIL: str = "pmc@example.com"
    FRONTEND_BASE_URL: str = "http://localhost:3000"
    GMAIL_OAUTH_CALLBACK_PATH: str = "/api/pmc/gmail/oauth/callback"
    PMC_INVENTORY_ADJUSTMENT_SENDERS: str = ""
    PMC_INVENTORY_ADJUSTMENT_SUBJECT_KEYWORDS: str = "库存异动,领料通知,借料通知,归还通知,入库通知,报废通知"
    AI_API_KEY: str = ""
    AI_BASE_URL: str = "https://your-ai-endpoint.example.com/v1"
    AI_MODEL: str = "gpt-4o"
    PMC_INVENTORY_ADJUSTMENT_AI_ENABLED: bool = True

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    @property
    def frontend_base_url(self) -> str:
        return self.FRONTEND_BASE_URL.rstrip("/")

    @property
    def gmail_oauth_callback_path(self) -> str:
        path = self.GMAIL_OAUTH_CALLBACK_PATH.strip() or "/api/pmc/gmail/oauth/callback"
        return path if path.startswith("/") else f"/{path}"

    @property
    def pmc_inventory_adjustment_senders_list(self) -> List[str]:
        return [item.strip().lower() for item in self.PMC_INVENTORY_ADJUSTMENT_SENDERS.split(",") if item.strip()]

    @property
    def pmc_inventory_adjustment_subject_keywords_list(self) -> List[str]:
        return [item.strip() for item in self.PMC_INVENTORY_ADJUSTMENT_SUBJECT_KEYWORDS.split(",") if item.strip()]

    @model_validator(mode="after")
    def validate_production_settings(self):
        env = (self.APP_ENV or "").strip().lower()
        if env in {"development", "dev", "local", "test", "testing"}:
            return self

        missing_or_insecure = []
        if self.JWT_SECRET_KEY == DEFAULT_JWT_SECRET_KEY:
            missing_or_insecure.append("JWT_SECRET_KEY")
        if self.DATABASE_URL == DEFAULT_DATABASE_URL:
            missing_or_insecure.append("DATABASE_URL")
        if self.MINIO_ACCESS_KEY == DEFAULT_MINIO_ACCESS_KEY:
            missing_or_insecure.append("MINIO_ACCESS_KEY")
        if self.MINIO_SECRET_KEY == DEFAULT_MINIO_SECRET_KEY:
            missing_or_insecure.append("MINIO_SECRET_KEY")

        if missing_or_insecure:
            raise ValueError(
                "生产环境必须显式配置以下敏感项: "
                + ", ".join(missing_or_insecure)
            )
        return self

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
