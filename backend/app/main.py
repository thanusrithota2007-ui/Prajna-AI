"""
ResearchPath API — milestone 1: JDBC health + metadata discovery.

No LLM, no LangGraph, no H-MEM in this milestone.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

import logging
import logging.config
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.agent import router as agent_router
from app.api.health import router as health_router
from app.api.runtime import router as runtime_router
from app.core.config import settings

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            "datefmt": "%Y-%m-%dT%H:%M:%S",
        }
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "default",
        }
    },
    "root": {"handlers": ["console"], "level": "DEBUG" if settings.debug else "INFO"},
})

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan (replaces deprecated on_event)
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:  # noqa: ARG001
    # startup
    logger.info(
        "Starting %s v%s  |  JDBC URL: %s  |  JAR: %s",
        settings.app_name,
        settings.app_version,
        settings.zetaris_jdbc_url,
        settings.zetaris_jar_path,
    )
    if not settings.effective_password:
        logger.warning(
            "No ZETARIS_PASSWORD or ZETARIS_ADMIN_PASSWORD found in environment. "
            "JDBC calls will fail until a password is set."
        )
    yield
    # shutdown
    logger.info("Shutting down %s", settings.app_name)


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=(
        "Milestone 1 — Zetaris JDBC connectivity and metadata discovery. "
        "No LLM or agent graph yet."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS: local development origins for the Vite frontend and existing clients.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(health_router)
app.include_router(agent_router)
app.include_router(runtime_router)


