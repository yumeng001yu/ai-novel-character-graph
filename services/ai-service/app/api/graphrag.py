"""GraphRAG 知识库问答路由"""

import logging

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from app.core.ai_client import create_sse_generator
from app.core.exceptions import AIServiceError
from app.models.schemas import GraphRAGRequest

logger = logging.getLogger(__name__)

router = APIRouter(tags=["graphrag"])


@router.post("/query")
async def query(request: Request, body: GraphRAGRequest) -> EventSourceResponse:
    """GraphRAG 查询（SSE 流式）

    接收查询请求，通过三路召回 + Reranker 精排 + LLM 生成回答，
    以 SSE 事件流返回结果。
    """
    graphrag_service = request.app.state.graphrag_service

    try:
        stream = graphrag_service.query(
            novel_id=body.novel_id,
            question=body.question,
        )

        sse_generator = create_sse_generator(stream, event_type="query")
        return EventSourceResponse(sse_generator)

    except AIServiceError as e:
        logger.error("GraphRAG 查询失败: %s", e)
        return EventSourceResponse(
            iter([f'{{"error": "{e.message}", "code": "{e.code}"}}']),
            media_type="text/event-stream",
        )
    except Exception as e:
        logger.error("GraphRAG 查询未知错误: %s", e)
        return EventSourceResponse(
            iter([f'{{"error": "内部服务器错误"}}']),
            media_type="text/event-stream",
        )
