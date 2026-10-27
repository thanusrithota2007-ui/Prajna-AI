"""Select the configured model provider without changing evaluator workflows."""

from app.core.config import settings
from app.integrations.meterless_runtime import MeterlessRuntimeClient, ModelClient
from app.integrations.nvidia_client import NvidiaClient


def create_model_client() -> ModelClient:
    if settings.ai_provider == "nvidia":
        return NvidiaClient()
    return MeterlessRuntimeClient()
