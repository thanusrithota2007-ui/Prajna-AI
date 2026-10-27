"""NVIDIA hosted API client using the OpenAI-compatible SDK."""

from __future__ import annotations

import httpx
from openai import APIError, APIStatusError, AsyncOpenAI

from app.core.config import settings
from app.integrations.meterless_runtime import ModelUnavailable


class NvidiaClient:
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None):
        self._transport = transport

    def _configuration(self) -> tuple[str, str, str]:
        api_key = settings.nvidia_api_key.strip()
        model = settings.nvidia_model.strip()
        if not api_key:
            raise ModelUnavailable("NVIDIA_API_KEY is not configured")
        if not model:
            raise ModelUnavailable("NVIDIA_MODEL is not configured")
        return settings.nvidia_base_url.rstrip("/"), api_key, model

    def _client(self, base_url: str, api_key: str, timeout: float) -> AsyncOpenAI:
        return AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
            http_client=httpx.AsyncClient(timeout=timeout, transport=self._transport),
        )

    async def complete(self, system: str, user: str) -> str:
        base_url, api_key, model = self._configuration()
        try:
            async with self._client(base_url, api_key, 180.0) as client:
                response = await client.chat.completions.create(
                    model=model,
                    temperature=0,
                    messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                )
            content = response.choices[0].message.content
            if not isinstance(content, str) or not content.strip():
                raise ModelUnavailable("NVIDIA returned an empty or non-text response")
            return content
        except ModelUnavailable:
            raise
        except APIStatusError as exc:
            if exc.status_code in (401, 403):
                raise ModelUnavailable("NVIDIA rejected the API credentials") from exc
            raise ModelUnavailable(f"NVIDIA request failed: {type(exc).__name__}") from exc
        except (APIError, httpx.HTTPError, IndexError, TypeError, ValueError) as exc:
            raise ModelUnavailable(f"NVIDIA request failed: {type(exc).__name__}") from exc

    async def status(self) -> str:
        if not settings.nvidia_api_key.strip() or not settings.nvidia_model.strip():
            return "not_configured"
        try:
            base_url = settings.nvidia_base_url.rstrip("/")
            async with self._client(base_url, settings.nvidia_api_key.strip(), 5.0) as client:
                await client.models.list()
            return "online"
        except APIStatusError as exc:
            return "unauthorized" if exc.status_code in (401, 403) else "offline"
        except (APIError, httpx.HTTPError):
            return "offline"
