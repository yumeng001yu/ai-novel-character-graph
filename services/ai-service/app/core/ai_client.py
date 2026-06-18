"""AI 调用客户端，支持流式调用、思维链过滤、startBuffer 机制和重试"""

import asyncio
import logging
import re
from collections.abc import AsyncGenerator

from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI
from sse_starlette.sse import ServerSentEvent

from app.core.config import settings
from app.core.exceptions import AIClientError

logger = logging.getLogger(__name__)

# 可重试的 HTTP 状态码
_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}

# 思维链标签正则
_THINK_OPEN_RE = re.compile(r"<think>")
_THINK_CLOSE_RE = re.compile(r"</think>")

# startBuffer 最少积累的非空白字符数
_START_BUFFER_MIN_CHARS = 8


class AIClient:
    """AI 调用客户端，封装 AsyncOpenAI，提供流式/非流式调用"""

    def __init__(self) -> None:
        self._client: AsyncOpenAI | None = None

    def _get_client(self) -> AsyncOpenAI:
        """获取或创建 AsyncOpenAI 客户端"""
        if self._client is None:
            kwargs: dict = {
                "api_key": settings.ai_api_key or "sk-placeholder",
                "base_url": settings.ai_api_url or None,
                "timeout": 120.0,
                "max_retries": 0,  # 我们自己管理重试
            }
            if settings.https_proxy:
                kwargs["http_client"] = self._build_httpx_client()
            self._client = AsyncOpenAI(**kwargs)
        return self._client

    @staticmethod
    def _build_httpx_client():
        """构建带代理的 httpx 客户端"""
        import httpx

        return httpx.AsyncClient(proxy=settings.https_proxy)

    async def call_stream(
        self,
        messages: list[dict],
        max_tokens: int = 60000,
        **kwargs,
    ) -> AsyncGenerator[str, None]:
        """流式调用 AI，yield 每个 delta 文本片段

        包含思维链过滤和 startBuffer 机制：
        - 思维链过滤：跳过 <think>...</think> 标签内的内容
        - startBuffer：积累至少 8 个非空白字符后，清理前导空行和单字前缀再输出
        """
        max_retries = kwargs.pop("max_retries", 3)
        model = kwargs.pop("model", None) or settings.ai_model

        for attempt in range(max_retries + 1):
            try:
                client = self._get_client()
                stream = await client.chat.completions.create(
                    model=model,
                    messages=messages,
                    max_tokens=max_tokens,
                    stream=True,
                    **kwargs,
                )

                # 思维链过滤状态
                in_think = False
                think_buffer = ""

                # startBuffer 状态
                buffer = ""
                buffer_flushed = False

                async for chunk in stream:
                    if not chunk.choices:
                        continue
                    delta = chunk.choices[0].delta
                    if not delta.content:
                        continue

                    text = delta.content

                    # === 思维链过滤 ===
                    if in_think:
                        think_buffer += text
                        # 检查思维链结束标签
                        close_match = _THINK_CLOSE_RE.search(think_buffer)
                        if close_match:
                            in_think = False
                            # 保留结束标签之后的文本
                            remaining = think_buffer[close_match.end() :]
                            think_buffer = ""
                            if remaining:
                                text = remaining
                            else:
                                continue
                        else:
                            continue
                    else:
                        # 检查思维链开始标签
                        open_match = _THINK_OPEN_RE.search(text)
                        if open_match:
                            in_think = True
                            # 保留开始标签之前的文本
                            before = text[: open_match.start()]
                            think_buffer = text[open_match.end() :]
                            if before:
                                text = before
                            else:
                                # 检查是否有结束标签
                                close_match = _THINK_CLOSE_RE.search(think_buffer)
                                if close_match:
                                    in_think = False
                                    remaining = think_buffer[close_match.end() :]
                                    think_buffer = ""
                                    if remaining:
                                        text = remaining
                                    else:
                                        continue
                                else:
                                    continue

                    # === startBuffer 机制 ===
                    if not buffer_flushed:
                        buffer += text
                        # 统计非空白字符数
                        non_whitespace_count = len(re.sub(r"\s", "", buffer))
                        if non_whitespace_count >= _START_BUFFER_MIN_CHARS:
                            buffer_flushed = True
                            # 清理前导空行
                            cleaned = buffer.lstrip("\n")
                            # 清理单字前缀（如 "好、" "嗯" 等单独出现在行首的短前缀）
                            cleaned = re.sub(r"^[^\n]{1,2}[，、。！？；：]\s*", "", cleaned)
                            if cleaned:
                                yield cleaned
                    else:
                        yield text

                # 如果 buffer 从未刷新，输出剩余内容
                if not buffer_flushed and buffer.strip():
                    cleaned = buffer.lstrip("\n")
                    cleaned = re.sub(r"^[^\n]{1,2}[，、。！？；：]\s*", "", cleaned)
                    if cleaned:
                        yield cleaned

                return  # 成功完成，退出重试循环

            except (APIConnectionError, APITimeoutError) as e:
                # 连接类错误，可重试
                if attempt < max_retries:
                    delay = 2**attempt
                    logger.warning("AI 调用连接错误，%d 秒后重试（第 %d 次）: %s", delay, attempt + 1, e)
                    await asyncio.sleep(delay)
                    continue
                raise AIClientError(f"AI 调用连接失败，已重试 {max_retries} 次: {e}", retryable=False) from e

            except APIStatusError as e:
                # 区分可重试和不可重试错误
                if e.status_code in _RETRYABLE_STATUS_CODES:
                    if attempt < max_retries:
                        delay = 2**attempt
                        logger.warning("AI 调用状态码 %d，%d 秒后重试（第 %d 次）", e.status_code, delay, attempt + 1)
                        await asyncio.sleep(delay)
                        continue
                    raise AIClientError(
                        f"AI 调用失败，状态码 {e.status_code}，已重试 {max_retries} 次",
                        retryable=False,
                    ) from e
                # 不可重试的错误（4xx 等）
                raise AIClientError(
                    f"AI 调用失败，状态码 {e.status_code}: {e.message}",
                    retryable=False,
                ) from e

            except Exception as e:
                if attempt < max_retries:
                    delay = 2**attempt
                    logger.warning("AI 调用未知错误，%d 秒后重试（第 %d 次）: %s", delay, attempt + 1, e)
                    await asyncio.sleep(delay)
                    continue
                raise AIClientError(f"AI 调用未知错误: {e}", retryable=False) from e

    async def call(
        self,
        prompt: str,
        system_prompt: str = "",
        max_tokens: int = 8000,
        **kwargs,
    ) -> str:
        """非流式调用 AI，返回原始文本响应

        Args:
            prompt: 用户提示词
            system_prompt: 系统提示词
            max_tokens: 最大生成 token 数
            **kwargs: 传递给 API 的额外参数

        Returns:
            AI 返回的原始文本

        Raises:
            AIClientError: 调用失败
        """
        max_retries = kwargs.pop("max_retries", 3)
        model = kwargs.pop("model", None) or settings.ai_model

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        for attempt in range(max_retries + 1):
            try:
                client = self._get_client()
                response = await client.chat.completions.create(
                    model=model,
                    messages=messages,
                    max_tokens=max_tokens,
                    stream=False,
                    **kwargs,
                )

                content = response.choices[0].message.content
                if not content:
                    raise AIClientError("AI 返回空内容")

                # 过滤思维链
                content = _THINK_OPEN_RE.sub("", content)
                content = _THINK_CLOSE_RE.sub("", content)

                return content

            except (APIConnectionError, APITimeoutError) as e:
                if attempt < max_retries:
                    delay = 2**attempt
                    logger.warning("AI 调用连接错误，%d 秒后重试（第 %d 次）: %s", delay, attempt + 1, e)
                    await asyncio.sleep(delay)
                    continue
                raise AIClientError(f"AI 调用连接失败，已重试 {max_retries} 次: {e}", retryable=False) from e

            except APIStatusError as e:
                if e.status_code in _RETRYABLE_STATUS_CODES:
                    if attempt < max_retries:
                        delay = 2**attempt
                        logger.warning("AI 调用状态码 %d，%d 秒后重试（第 %d 次）", e.status_code, delay, attempt + 1)
                        await asyncio.sleep(delay)
                        continue
                    raise AIClientError(
                        f"AI 调用失败，状态码 {e.status_code}，已重试 {max_retries} 次",
                        retryable=False,
                    ) from e
                raise AIClientError(
                    f"AI 调用失败，状态码 {e.status_code}: {e.message}",
                    retryable=False,
                ) from e

            except AIClientError:
                raise

            except Exception as e:
                if attempt < max_retries:
                    delay = 2**attempt
                    logger.warning("AI 调用未知错误，%d 秒后重试（第 %d 次）: %s", delay, attempt + 1, e)
                    await asyncio.sleep(delay)
                    continue
                raise AIClientError(f"AI 调用未知错误: {e}", retryable=False) from e

        raise AIClientError("AI 调用失败，已耗尽重试次数")

    async def call_json(
        self,
        messages: list[dict],
        max_tokens: int = 8000,
        **kwargs,
    ) -> dict:
        """非流式调用 AI，返回 JSON 解析后的字典

        Args:
            messages: 对话消息列表
            max_tokens: 最大生成 token 数
            **kwargs: 传递给 API 的额外参数

        Returns:
            解析后的 JSON 字典

        Raises:
            AIClientError: 调用失败或 JSON 解析失败
        """
        import json

        max_retries = kwargs.pop("max_retries", 2)
        model = kwargs.pop("model", None) or settings.ai_model

        for attempt in range(max_retries + 1):
            try:
                client = self._get_client()
                response = await client.chat.completions.create(
                    model=model,
                    messages=messages,
                    max_tokens=max_tokens,
                    stream=False,
                    response_format={"type": "json_object"},
                    **kwargs,
                )

                content = response.choices[0].message.content
                if not content:
                    raise AIClientError("AI 返回空内容")

                # 过滤思维链
                content = _THINK_OPEN_RE.sub("", content)
                content = _THINK_CLOSE_RE.sub("", content)

                return json.loads(content)

            except json.JSONDecodeError as e:
                if attempt < max_retries:
                    logger.warning("JSON 解析失败，重试（第 %d 次）: %s", attempt + 1, e)
                    await asyncio.sleep(1)
                    continue
                raise AIClientError(f"AI 返回的 JSON 解析失败: {e}", retryable=False) from e

            except (APIConnectionError, APITimeoutError) as e:
                if attempt < max_retries:
                    delay = 2**attempt
                    await asyncio.sleep(delay)
                    continue
                raise AIClientError(f"AI 调用连接失败: {e}", retryable=False) from e

            except APIStatusError as e:
                if e.status_code in _RETRYABLE_STATUS_CODES and attempt < max_retries:
                    delay = 2**attempt
                    await asyncio.sleep(delay)
                    continue
                raise AIClientError(f"AI 调用失败，状态码 {e.status_code}", retryable=False) from e

            except AIClientError:
                raise

            except Exception as e:
                if attempt < max_retries:
                    await asyncio.sleep(2**attempt)
                    continue
                raise AIClientError(f"AI 调用未知错误: {e}", retryable=False) from e

        raise AIClientError("AI 调用失败，已耗尽重试次数")

    async def close(self) -> None:
        """关闭客户端连接"""
        if self._client is not None:
            await self._client.close()
            self._client = None


def create_sse_generator(
    stream: AsyncGenerator[str, None],
    event_type: str = "message",
) -> AsyncGenerator[ServerSentEvent, None]:
    """将 AI 流式输出包装为 SSE 事件生成器

    Args:
        stream: AI 流式输出的文本生成器
        event_type: SSE 事件类型

    Yields:
        ServerSentEvent 对象
    """
    async def _generator() -> AsyncGenerator[ServerSentEvent, None]:
        try:
            async for text in stream:
                yield ServerSentEvent(data=text, event=event_type)
            # 发送结束标记
            yield ServerSentEvent(data="[DONE]", event=event_type)
        except Exception as e:
            logger.error("SSE 流式输出错误: %s", e)
            yield ServerSentEvent(data=f'{{"error": "{str(e)}"}}', event="error")

    return _generator()
