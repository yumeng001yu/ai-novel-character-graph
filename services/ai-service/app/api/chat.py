"""角色对话路由"""

import logging

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from app.core.ai_client import create_sse_generator
from app.core.exceptions import AIServiceError
from app.models.schemas import ChatRequest

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])


@router.post("/chat")
async def chat(request: Request, body: ChatRequest) -> EventSourceResponse:
    """SSE 流式角色对话

    接收对话请求，以 SSE 事件流返回 AI 生成的角色对话内容。
    """
    chat_service = request.app.state.chat_service

    try:
        stream = chat_service.chat(
            novel_id=body.novel_id,
            character_ids=body.character_ids,
            message=body.message,
            mode=body.mode,
            preset_id=body.preset_id,
            history=body.history,
        )

        sse_generator = create_sse_generator(stream, event_type="chat")
        return EventSourceResponse(sse_generator)

    except AIServiceError as e:
        logger.error("角色对话失败: %s", e)
        return EventSourceResponse(
            iter([f'{{"error": "{e.message}", "code": "{e.code}"}}']),
            media_type="text/event-stream",
        )
    except Exception as e:
        logger.error("角色对话未知错误: %s", e)
        return EventSourceResponse(
            iter([f'{{"error": "内部服务器错误"}}']),
            media_type="text/event-stream",
        )
