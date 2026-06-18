"""GraphRAG 知识库问答服务

三路召回：向量语义搜索 + 关键词搜索 + 图谱关系遍历
合并去重 + Reranker 精排 → 组装上下文 → LLM 生成回答
"""

import hashlib
import json
import logging
from collections.abc import AsyncGenerator

from app.core.ai_client import AIClient
from app.core.config import settings
from app.core.embedding import EmbeddingService
from app.core.exceptions import GraphRAGError
from app.core.prompts import GRAPHRAG_SYSTEM_PROMPT
from app.core.reranker import RerankerService

logger = logging.getLogger(__name__)

# Redis 缓存 TTL（5 分钟）
_CACHE_TTL = 300


class GraphRAGService:
    """GraphRAG 知识库问答服务

    流程：
    1. 向量语义搜索：用 embedding 在 Qdrant 中搜索相关文档
    2. 关键词搜索：在 Qdrant 中进行关键词匹配
    3. 图谱关系遍历：在 Neo4j 中遍历相关实体和关系
    4. 合并去重：对三路召回结果进行去重
    5. Reranker 精排：使用 Reranker 对候选文档重排序
    6. 组装上下文 + LLM 生成回答
    """

    def __init__(
        self,
        ai_client: AIClient,
        embedding_service: EmbeddingService,
        reranker_service: RerankerService,
    ) -> None:
        self._ai = ai_client
        self._embedding = embedding_service
        self._reranker = reranker_service
        self._neo4j_driver = None
        self._redis = None

    async def _get_neo4j_session(self):
        """获取 Neo4j 异步会话"""
        from neo4j import AsyncGraphDatabase

        if self._neo4j_driver is None:
            self._neo4j_driver = AsyncGraphDatabase.driver(
                settings.neo4j_uri,
                auth=(settings.neo4j_user, settings.neo4j_password),
            )
        return self._neo4j_driver.session()

    async def _get_redis(self):
        """获取 Redis 异步连接"""
        import redis.asyncio as aioredis

        if self._redis is None:
            self._redis = aioredis.from_url(settings.redis_url)
        return self._redis

    async def _check_cache(self, cache_key: str) -> str | None:
        """检查 Redis 缓存

        Args:
            cache_key: 缓存键

        Returns:
            缓存的回答文本，未命中返回 None
        """
        try:
            r = await self._get_redis()
            cached = await r.get(cache_key)
            return cached.decode("utf-8") if cached else None
        except Exception as e:
            logger.warning("Redis 缓存读取失败: %s", e)
            return None

    async def _set_cache(self, cache_key: str, value: str) -> None:
        """设置 Redis 缓存

        Args:
            cache_key: 缓存键
            value: 缓存值
        """
        try:
            r = await self._get_redis()
            await r.setex(cache_key, _CACHE_TTL, value)
        except Exception as e:
            logger.warning("Redis 缓存写入失败: %s", e)

    async def _vector_search(self, novel_id: str, query_vector: list[float], limit: int = 20) -> list[dict]:
        """向量语义搜索

        Args:
            novel_id: 小说 ID
            query_vector: 查询向量
            limit: 返回结果数量上限

        Returns:
            搜索结果列表
        """
        try:
            index_name = f"novel_{novel_id}"
            results = await self._embedding.search(
                index_name=index_name,
                query_vector=query_vector,
                limit=limit,
                filter_={"novel_id": novel_id},
            )
            return results
        except Exception as e:
            logger.warning("向量搜索失败: %s", e)
            return []

    async def _keyword_search(self, novel_id: str, keywords: list[str], limit: int = 20) -> list[dict]:
        """关键词搜索

        在 Qdrant 中使用 payload 过滤进行关键词匹配。

        Args:
            novel_id: 小说 ID
            keywords: 关键词列表
            limit: 返回结果数量上限

        Returns:
            搜索结果列表
        """
        try:
            # 使用 Neo4j 全文索引搜索关键词
            session = await self._get_neo4j_session()
            results = []

            for keyword in keywords:
                result = await session.run(
                    """
                    MATCH (n)
                    WHERE n.novelId = $novel_id
                      AND (n.text CONTAINS $keyword OR n.name CONTAINS $keyword)
                    RETURN n
                    LIMIT $limit
                    """,
                    novel_id=novel_id,
                    keyword=keyword,
                    limit=limit,
                )
                records = await result.data()
                for record in records:
                    node = record.get("n", {})
                    results.append({
                        "id": node.get("id", ""),
                        "score": 0.5,  # 关键词搜索给一个默认分数
                        "payload": node,
                        "text": node.get("text", node.get("name", "")),
                    })

            return results[:limit]

        except Exception as e:
            logger.warning("关键词搜索失败: %s", e)
            return []

    async def _graph_traverse(self, novel_id: str, entity_names: list[str], depth: int = 2) -> list[dict]:
        """图谱关系遍历

        从指定实体出发，遍历相关节点和关系。

        Args:
            novel_id: 小说 ID
            entity_names: 起始实体名称列表
            depth: 遍历深度

        Returns:
            遍历结果列表，每项包含关系描述文本
        """
        try:
            session = await self._get_neo4j_session()
            results = []

            for name in entity_names:
                result = await session.run(
                    """
                    MATCH path = (a)-[r*1..2]-(b)
                    WHERE a.novel_id = $novel_id
                      AND (a.name CONTAINS $name OR a.text CONTAINS $name)
                    RETURN path
                    LIMIT 20
                    """,
                    novel_id=novel_id,
                    name=name,
                )
                records = await result.data()
                for record in records:
                    path = record.get("path", [])
                    # 将路径转换为文本描述
                    for segment in path:
                        if hasattr(segment, "relationships"):
                            for rel in segment.relationships:
                                start_node = rel.start_node
                                end_node = rel.end_node
                                rel_type = rel.type
                                text = f"{start_node.get('name', '')} -[{rel_type}]-> {end_node.get('name', '')}"
                                results.append({
                                    "id": hashlib.md5(text.encode()).hexdigest(),
                                    "score": 0.4,
                                    "payload": {
                                        "type": "relation",
                                        "source": start_node.get("name", ""),
                                        "target": end_node.get("name", ""),
                                        "relation": rel_type,
                                    },
                                    "text": text,
                                })

            return results

        except Exception as e:
            logger.warning("图谱遍历失败: %s", e)
            return []

    def _merge_and_dedup(self, *result_lists: list[dict]) -> list[dict]:
        """合并多路召回结果并去重

        Args:
            *result_lists: 多个搜索结果列表

        Returns:
            去重后的结果列表
        """
        seen_ids: set[str] = set()
        merged: list[dict] = []

        for results in result_lists:
            for item in results:
                item_id = item.get("id", "")
                if item_id and item_id in seen_ids:
                    continue
                if item_id:
                    seen_ids.add(item_id)
                merged.append(item)

        return merged

    async def _extract_keywords(self, question: str) -> list[str]:
        """从问题中提取关键词

        使用 AI 提取关键词，如果失败则简单分词。

        Args:
            question: 用户问题

        Returns:
            关键词列表
        """
        try:
            result = await self._ai.call_json(
                messages=[
                    {
                        "role": "system",
                        "content": "从用户的问题中提取关键词，返回 JSON 格式：{\"keywords\": [\"关键词1\", \"关键词2\"]}",
                    },
                    {"role": "user", "content": question},
                ],
                max_tokens=500,
            )
            return result.get("keywords", [])
        except Exception as e:
            logger.warning("AI 提取关键词失败，使用简单分词: %s", e)
            # 简单分词：按标点和空格分割，过滤短词
            import re

            words = re.split(r"[，。！？、；：\s]+", question)
            return [w for w in words if len(w) >= 2][:5]

    async def query(
        self,
        novel_id: str,
        question: str,
    ) -> AsyncGenerator[str, None]:
        """GraphRAG 查询，流式返回

        Args:
            novel_id: 小说 ID
            question: 用户问题

        Yields:
            AI 生成的回答文本片段
        """
        # 检查缓存
        cache_key = f"graphrag:{novel_id}:{hashlib.md5(question.encode()).hexdigest()}"
        cached = await self._check_cache(cache_key)
        if cached:
            yield cached
            return

        # 1. 生成查询向量
        query_vectors = await self._embedding.embed([question])
        if not query_vectors:
            raise GraphRAGError("生成查询向量失败")
        query_vector = query_vectors[0]

        # 2. 提取关键词
        keywords = await self._extract_keywords(question)

        # 3. 三路召回
        vector_results = await self._vector_search(novel_id, query_vector, limit=20)
        keyword_results = await self._keyword_search(novel_id, keywords, limit=20)
        graph_results = await self._graph_traverse(novel_id, keywords, depth=2)

        # 4. 合并去重
        merged = self._merge_and_dedup(vector_results, keyword_results, graph_results)

        if not merged:
            # 没有召回结果，直接让 AI 回答
            async for text in self._ai.call_stream(
                messages=[
                    {"role": "system", "content": "你是一个知识库问答助手，但当前没有找到相关参考资料。请根据你的知识回答用户问题，并说明这不是基于知识库的回答。"},
                    {"role": "user", "content": question},
                ],
            ):
                yield text
            return

        # 5. Reranker 精排
        documents = [item.get("text", "") or item.get("payload", {}).get("text", "") for item in merged if item.get("text") or item.get("payload", {}).get("text")]

        if documents:
            try:
                reranked = await self._reranker.rerank(question, documents, top_k=10)
                # 按分数排序
                reranked.sort(key=lambda x: x.get("relevance_score", 0), reverse=True)
                top_docs = [item["text"] for item in reranked[:10]]
            except Exception as e:
                logger.warning("Reranker 精排失败，使用原始排序: %s", e)
                top_docs = documents[:10]
        else:
            top_docs = []

        # 6. 组装上下文
        context = "\n\n---\n\n".join(top_docs) if top_docs else "无相关参考资料"
        system_prompt = GRAPHRAG_SYSTEM_PROMPT.format(context=context)

        # 7. LLM 生成回答（流式）
        full_answer = ""
        async for text in self._ai.call_stream(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": question},
            ],
        ):
            full_answer += text
            yield text

        # 缓存完整回答
        if full_answer:
            await self._set_cache(cache_key, full_answer)

    async def close(self) -> None:
        """关闭连接"""
        if self._neo4j_driver is not None:
            await self._neo4j_driver.close()
            self._neo4j_driver = None
        if self._redis is not None:
            await self._redis.close()
            self._redis = None
