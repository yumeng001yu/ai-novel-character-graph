"""向量嵌入服务，支持批量嵌入和 Qdrant 索引管理"""

import logging
import uuid
from collections.abc import AsyncGenerator

from openai import AsyncOpenAI

from app.core.config import settings
from app.core.exceptions import EmbeddingError

logger = logging.getLogger(__name__)


class EmbeddingService:
    """向量嵌入服务，封装 Embedding API 和 Qdrant 操作"""

    def __init__(self) -> None:
        self._client: AsyncOpenAI | None = None
        self._qdrant = None

    def _get_embedding_client(self) -> AsyncOpenAI:
        """获取或创建 Embedding API 客户端"""
        if self._client is None:
            kwargs: dict = {
                "api_key": settings.embedding_api_key or "sk-placeholder",
                "base_url": settings.embedding_api_url or None,
                "timeout": 60.0,
            }
            if settings.https_proxy:
                import httpx

                kwargs["http_client"] = httpx.AsyncClient(proxy=settings.https_proxy)
            self._client = AsyncOpenAI(**kwargs)
        return self._client

    def _get_qdrant(self):
        """获取或创建 Qdrant 客户端"""
        if self._qdrant is None:
            from qdrant_client import QdrantClient

            kwargs: dict = {
                "url": settings.qdrant_url,
                "timeout": 30,
            }
            if settings.qdrant_api_key:
                kwargs["api_key"] = settings.qdrant_api_key
            self._qdrant = QdrantClient(**kwargs)
        return self._qdrant

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """批量生成向量

        Args:
            texts: 待嵌入的文本列表

        Returns:
            对应的向量列表

        Raises:
            EmbeddingError: 嵌入调用失败
        """
        if not texts:
            return []

        try:
            client = self._get_embedding_client()
            # 分批处理，每批最多 100 条
            all_embeddings: list[list[float]] = []
            batch_size = 100

            for i in range(0, len(texts), batch_size):
                batch = texts[i : i + batch_size]
                embed_kwargs: dict = {
                    "model": settings.embedding_model,
                    "input": batch,
                }
                # 部分模型不支持 dimensions 参数（如 SiliconFlow Qwen3-Embedding）
                if settings.embedding_dimensions and settings.embedding_dimensions > 0:
                    embed_kwargs["dimensions"] = settings.embedding_dimensions
                response = await client.embeddings.create(**embed_kwargs)
                batch_embeddings = [item.embedding for item in response.data]
                all_embeddings.extend(batch_embeddings)

            return all_embeddings

        except Exception as e:
            logger.error("向量嵌入失败: %s", e)
            raise EmbeddingError(f"向量嵌入失败: {e}") from e

    async def ensure_index(self, index_name: str, dimensions: int) -> None:
        """确保 Qdrant 索引（集合）存在，不存在则创建

        Args:
            index_name: 索引/集合名称
            dimensions: 向量维度

        Raises:
            EmbeddingError: 索引创建失败
        """
        try:
            from qdrant_client.models import Distance, VectorParams

            qdrant = self._get_qdrant()
            collections = qdrant.get_collections().collections
            collection_names = [c.name for c in collections]

            if index_name not in collection_names:
                qdrant.create_collection(
                    collection_name=index_name,
                    vectors_config=VectorParams(
                        size=dimensions,
                        distance=Distance.COSINE,
                    ),
                )
                logger.info("创建 Qdrant 索引: %s（维度: %d）", index_name, dimensions)
            else:
                logger.debug("Qdrant 索引已存在: %s", index_name)

        except Exception as e:
            logger.error("创建 Qdrant 索引失败: %s", e)
            raise EmbeddingError(f"创建 Qdrant 索引失败: {e}") from e

    async def upsert(
        self,
        index_name: str,
        ids: list[str],
        vectors: list[list[float]],
        payloads: list[dict],
    ) -> None:
        """批量插入/更新向量

        Args:
            index_name: 索引/集合名称
            ids: 向量 ID 列表
            vectors: 向量列表
            payloads: 元数据列表

        Raises:
            EmbeddingError: 插入失败
        """
        if not ids or not vectors:
            return

        try:
            from qdrant_client.models import PointStruct

            qdrant = self._get_qdrant()
            points = []
            for point_id, vector, payload in zip(ids, vectors, payloads):
                points.append(
                    PointStruct(
                        id=point_id,
                        vector=vector,
                        payload=payload,
                    )
                )

            # 分批 upsert，每批最多 100 条
            batch_size = 100
            for i in range(0, len(points), batch_size):
                batch = points[i : i + batch_size]
                qdrant.upsert(
                    collection_name=index_name,
                    points=batch,
                )

            logger.info("向 Qdrant 索引 %s 插入 %d 条向量", index_name, len(ids))

        except Exception as e:
            logger.error("Qdrant 向量插入失败: %s", e)
            raise EmbeddingError(f"Qdrant 向量插入失败: {e}") from e

    async def search(
        self,
        index_name: str,
        query_vector: list[float],
        limit: int = 10,
        filter_: dict | None = None,
    ) -> list[dict]:
        """向量搜索

        Args:
            index_name: 索引/集合名称
            query_vector: 查询向量
            limit: 返回结果数量上限
            filter_: 过滤条件

        Returns:
            搜索结果列表，每项包含 id、score、payload

        Raises:
            EmbeddingError: 搜索失败
        """
        try:
            from qdrant_client.models import Filter, FieldCondition, MatchValue

            qdrant = self._get_qdrant()

            # 构建过滤条件
            qdrant_filter = None
            if filter_:
                conditions = []
                for key, value in filter_.items():
                    conditions.append(FieldCondition(key=key, match=MatchValue(value=value)))
                qdrant_filter = Filter(must=conditions)

            results = qdrant.search(
                collection_name=index_name,
                query_vector=query_vector,
                limit=limit,
                query_filter=qdrant_filter,
            )

            return [
                {
                    "id": str(hit.id),
                    "score": hit.score,
                    "payload": hit.payload or {},
                }
                for hit in results
            ]

        except Exception as e:
            logger.error("Qdrant 向量搜索失败: %s", e)
            raise EmbeddingError(f"Qdrant 向量搜索失败: {e}") from e

    async def close(self) -> None:
        """关闭客户端连接"""
        if self._client is not None:
            await self._client.close()
            self._client = None
        if self._qdrant is not None:
            self._qdrant.close()
            self._qdrant = None
