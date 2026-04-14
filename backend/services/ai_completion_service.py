import json
from typing import Any, Dict, List

import httpx

from config import settings


class AICompletionError(Exception):
    pass


async def _request_chat_completion(
    *,
    messages: List[Dict[str, str]],
    temperature: float,
    timeout: float,
    response_format: Dict[str, str] | None = None,
) -> str:
    if not settings.AI_API_KEY.strip():
        raise AICompletionError("AI API Key 未配置")

    payload: Dict[str, Any] = {
        "model": settings.AI_MODEL,
        "messages": messages,
        "temperature": temperature,
    }
    if response_format is not None:
        payload["response_format"] = response_format

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.AI_BASE_URL.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.AI_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=timeout,
        )

    if response.status_code != 200:
        raise AICompletionError(f"AI 服务异常: HTTP {response.status_code}")

    data = response.json()
    choices = data.get("choices") or []
    if not choices:
        raise AICompletionError("AI 未返回可用结果")

    message = choices[0].get("message") or {}
    content = str(message.get("content") or "").strip()
    if not content:
        raise AICompletionError("AI 返回内容为空")
    return content


def _extract_json_payload(content: str) -> Dict[str, Any]:
    value = (content or "").strip()
    if not value:
        raise AICompletionError("AI 返回内容为空")

    if value.startswith("```"):
        lines = value.splitlines()
        if len(lines) >= 3:
            value = "\n".join(lines[1:-1]).strip()

    try:
        parsed = json.loads(value)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    start = value.find("{")
    end = value.rfind("}")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(value[start:end + 1])
            if isinstance(parsed, dict):
                return parsed
        except Exception as exc:
            raise AICompletionError(f"AI JSON 解析失败: {exc}") from exc

    raise AICompletionError("AI 未返回有效 JSON")


async def chat_completion_json(
    *,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.1,
    timeout: float = 40.0,
) -> Dict[str, Any]:
    content = await _request_chat_completion(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=temperature,
        timeout=timeout,
        response_format={"type": "json_object"},
    )
    return _extract_json_payload(content)


async def chat_completion_text(
    *,
    user_prompt: str,
    system_prompt: str | None = None,
    temperature: float = 0.3,
    timeout: float = 40.0,
) -> str:
    messages: List[Dict[str, str]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": user_prompt})

    return await _request_chat_completion(
        messages=messages,
        temperature=temperature,
        timeout=timeout,
    )
