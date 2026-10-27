"""
Application configuration loaded from environment / .env file.

All JDBC credentials are read from env vars — never hard-coded.
The search order is the standard pydantic-settings one:
  1. OS environment variables
  2. .env file next to this module (backend/.env)
  3. pydantic field defaults (non-secret, non-critical only)
"""

from __future__ import annotations

import os
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve the repo-root JAR path relative to *this* file so a developer can
# `cd backend && uvicorn app.main:app` without manually setting the var.
_REPO_ROOT = Path(__file__).resolve().parents[3]  # …/zetaris-platform/
_DEFAULT_JAR = str(_REPO_ROOT / "jdbc" / "ndp-jdbc-driver-2.4.3.1-7eff043-driver.jar")

# Default JDK location confirmed working in this session (Python 3.13 / JPype).
_DEFAULT_JAVA_HOME = str(
    Path(os.environ.get("LOCALAPPDATA", ""))
    / "Microsoft"
    / "jdk-17"
    / "jdk-17.0.20+8"
)


class Settings(BaseSettings):
    ai_provider: str = "meterless"
    nvidia_model: str = ""
    nvidia_api_key: str = ""
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[2] / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ------------------------------------------------------------------ app --
    app_name: str = Field("ResearchPath API", description="Human-readable service name")
    app_version: str = Field("0.1.0")
    debug: bool = Field(False, description="Enable debug mode (verbose logging)")

    # ---------------------------------------------------------------- jdbc --
    zetaris_jdbc_url: str = Field(
        "jdbc:zetaris:lightning@localhost:10000",
        description="Lightning JDBC URL (host-side; compose internal uses driver:10000)",
    )
    zetaris_jar_path: str = Field(
        default=_DEFAULT_JAR,
        description="Absolute path to the Lightning JDBC driver JAR",
    )
    zetaris_driver_class: str = Field(
        "com.zetaris.lightning.jdbc.LightningDriver",
        description="JDBC driver class name — do not change",
    )
    zetaris_user: str = Field(
        "admin@zetaris.com",
        description="Zetaris login (ZETARIS_ADMIN_EMAIL)",
    )
    # Accept ZETARIS_PASSWORD first; fall back to ZETARIS_ADMIN_PASSWORD from the
    # platform .env so developers don't need a separate secret.
    zetaris_password: str = Field(
        "",
        description="Zetaris password — set ZETARIS_PASSWORD or ZETARIS_ADMIN_PASSWORD",
        alias="zetaris_password",
    )
    zetaris_admin_password: str = Field(
        "",
        description="Platform .env ZETARIS_ADMIN_PASSWORD (fallback)",
    )

    # -------------------------------------------------------------- java --
    java_home: str = Field(
        default=_DEFAULT_JAVA_HOME,
        description=(
            "Path to JDK 17 used by JPype. "
            "Set JAVA_HOME in the environment or backend/.env."
        ),
    )

    # ------------------------------------------------------- connectivity --
    jdbc_connect_timeout_s: int = Field(
        15, description="Seconds before a JDBC connect attempt is abandoned"
    )
    jdbc_query_timeout_s: int = Field(
        30, description="Seconds before a single SQL execution is abandoned"
    )

    # ------------------------------------------------- evaluation history --
    zetaris_history_enabled: bool = Field(
        False, description="Persist completed evaluations in Zetaris (turn on after the one-time setup)"
    )
    zetaris_history_table: str = Field(
        "lightning.datasource.iceberg.icebergdb.upsc.evaluations",
        description="Fully qualified table for evaluation history (dot-separated identifiers)",
    )
    zetaris_history_timeout_s: float = Field(45.0, description="Seconds before a history read/write is abandoned")

    # ------------------------------------------------------------- scout --
    scout_url: str = Field(
        "http://127.0.0.1:8765", description="Scout Intent sidecar (scout/ folder: npm run serve)"
    )
    scout_signing_secret: str = Field(
        "", description="Shared HMAC secret used to verify Scout execution contracts (same value as the sidecar)"
    )
    scout_timeout_s: float = Field(5.0, description="Seconds before a Scout call is abandoned")
    # ------------------------------------------------------ meterless --
    meterless_state_dir: str = Field(
        default=str(Path(__file__).resolve().parents[2] / ".meterless"),
        description="Directory for local Meterless Runtime settings",
    )
    meterless_runtime_base_url: str = "http://127.0.0.1:8088/v1"
    meterless_runtime_token: str = ""
    meterless_runtime_model: str = "meterless/auto"
    # -------------------------------------------------------- nightshift --
    nightshift_base_url: str = Field(
        "http://127.0.0.1:8088/v1", description="Meterless Nightshift Runtime, OpenAI-compatible base URL"
    )
    nightshift_token: str = Field("", description="Nightshift runtime token (NIGHTSHIFT_TOKEN); never logged")
    nightshift_model: str = Field("meterless/auto", description="Model/mode id sent to the runtime")
    nightshift_app_name: str = Field("upsc-evaluator", description="Value of the meterless-app request header")
    nightshift_timeout_s: float = Field(180.0, description="Seconds before a model call is abandoned")

    @property
    def effective_password(self) -> str:
        """Return the first non-empty credential."""
        return self.zetaris_password or self.zetaris_admin_password

    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[2] / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        populate_by_name=True,  # allow both field name and alias
    )


settings = Settings()
