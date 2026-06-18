"""重排序服务，调用 Reranker API 对文档进行精排"""

import logging

from openai import AsyncOpenAI

from app.core.config import settings
from app.core.exceptions import RerankerError

logger = logging.getLogger(__name__)


class RerankerService:
    """重排序服务，封装 Reranker API 调用"""

    def __init__(self) -> None:
        self._client: AsyncOpenAI | None = None

    def _get_client(self) -> AsyncOpenAI:
        """获取或创建 Reranker API 客户端"""
        if self._client is None:
            kwargs: dict = {
                "api_key": settings.reranker_api_key or "sk-placeholder",
                "base_url": settings.reranker_api_url or None,
                "timeout": 60.0,
            }
            if settings.https_proxy:
                import httpx

                kwargs["http_client"] = httpx.AsyncClient(proxy=settings.https_proxy)
            self._client = AsyncOpenAI(**kwargs)
        return self._client

    async def rerank(
        self,
        query: str,
        documents: list[str],
        top_k: int = 10,
    ) -> list[dict]:
        """对文档列表进行重排序

        使用 Jina/Cohere 兼容的 Reranker API。

        Args:
            query: 查询文本
            documents: 待排序的文档列表
            top_k: 返回前 k 个结果

        Returns:
            重排序结果列表，每项包含 index、relevance_score、text

        Raises:
            RerankerError: 重排序调用失败
        """
        if not documents:
            return []

        try:
            import httpx

            # Reranker API 通常不走 OpenAI SDK，直接用 httpx 调用
            headers = {
                "Content-Type": "application/json",
            }
            if settings.reranker_api_key:
                headers["Authorization"] = f"Bearer {settings.reranker_api_key}"

            payload = {
                "model": settings.reranker_model,
                "query": query,
                "documents": documents,
                "top_k": min(top_k, len(documents)),
            }

            url = settings.reranker_api_url
            if not url.endswith("/rerank"):
                url = url.rstrip("/") + "/rerank"

            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()

            data = response.json()
            results = data.get("results", [])

            return [
                {
                    "index": item.get("index", i),
                    "relevance_score": item.get("relevance_score", 0.0),
                    "text": documents[item.get("index", i)] if item.get("index", i) < len(documents) else "",
                }
                for i, item in enumerate(results)
            ]

        except Exception as e:
            logger.error("重排序调用失败: %s", e)
            raise RerankerError(f"重排序调用失败: {e}") from e

    async def close(self) -> None:
        """关闭客户端连接"""
        if self._client is not None:
            await self._client.close()
            self._client = None
