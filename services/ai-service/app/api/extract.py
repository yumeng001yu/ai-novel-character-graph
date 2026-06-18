"""图谱构建 AI 提取路由"""

import logging

from fastapi import APIRouter, Request

from app.core.extractor import ExtractionResult
from app.models.schemas import ExtractRequest

logger = logging.getLogger(__name__)

router = APIRouter(tags=["extract"])


@router.post("/extract", response_model=None)
async def extract(request: Request, body: ExtractRequest) -> dict:
    """从文本中提取角色、关系、事件

    供 Go API Gateway 在图谱构建时调用。
    """
    extractor_service = request.app.state.extractor_service

    try:
        result = await extractor_service.extract_from_text(
            text=body.text,
            chapter_range=body.chapter_range,
            existing_character_names=body.existing_character_names,
            graph_summary=body.graph_summary,
        )

        # 转换为 dict 返回
        return {
            "characters": [
                {
                    "name": c.name,
                    "aliases": c.aliases,
                    "gender": c.gender,
                    "faction": c.faction,
                    "identity": c.identity,
                    "description": c.description,
                }
                for c in result.characters
            ],
            "relations": [
                {
                    "sourceName": r.source_name,
                    "targetName": r.target_name,
                    "relationType": r.relation_type,
                    "description": r.description,
                    "isInference": r.is_inference,
                    "inferenceBasis": r.inference_basis,
                    "confidence": r.confidence,
                    "importance": r.importance,
                }
                for r in result.relations
            ],
            "events": [
                {
                    "name": e.name,
                    "chapter": e.chapter,
                    "summary": e.summary,
                    "eventType": e.event_type,
                    "participantNames": e.participant_names,
                }
                for e in result.events
            ],
        }

    except Exception as e:
        logger.error("提取失败: %s", e)
        return {"error": str(e), "characters": [], "relations": [], "events": []}


@router.post("/graph-summary")
async def graph_summary(request: Request, body: dict) -> str:
    """生成图谱摘要

    供 Go API Gateway 在构建过程中调用，生成前步图谱摘要供下一步 AI 提取参考。
    """
    extractor_service = request.app.state.extractor_service
    return await extractor_service.generate_graph_summary(
        characters=body.get("characters", []),
        relations=body.get("relations", []),
        events=body.get("events"),
    )
