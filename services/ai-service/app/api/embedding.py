"""向量嵌入路由"""

import logging

from fastapi import APIRouter, Request

from app.core.exceptions import EmbeddingError
from app.models.schemas import (
    EmbedRequest,
    EmbedResponse,
    IndexInitRequest,
    IndexUpsertRequest,
    SearchRequest,
    SearchResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["embedding"])


@router.post("/embed", response_model=EmbedResponse)
async def embed(request: Request, body: EmbedRequest) -> EmbedResponse:
    """生成向量

    接收文本列表，调用 Embedding API 生成对应的向量。
    """
    embedding_service = request.app.state.embedding_service

    try:
        embeddings = await embedding_service.embed(body.texts)
        return EmbedResponse(embeddings=embeddings, count=len(embeddings))
    except EmbeddingError as e:
        logger.error("向量嵌入失败: %s", e)
        from fastapi.responses import JSONResponse

        return JSONResponse(status_code=500, content={"error": e.message, "code": e.code})
    except Exception as e:
        logger.error("向量嵌入未知错误: %s", e)
        from fastapi.responses import JSONResponse

        return JSONResponse(status_code=500, content={"error": "内部服务器错误"})


@router.post("/index/init")
async def index_init(request: Request, body: IndexInitRequest) -> dict:
    """初始化索引

    确保 Qdrant 索引（集合）存在，不存在则创建。
    """
    embedding_service = request.app.state.embedding_service

    try:
        await embedding_service.ensure_index(body.index_name, body.dimensions)
        return {"status": "ok", "index_name": body.index_name}
    except EmbeddingError as e:
        logger.error("索引初始化失败: %s", e)
        from fastapi.responses import JSONResponse

        return JSONResponse(status_code=500, content={"error": e.message, "code": e.code})
    except Exception as e:
        logger.error("索引初始化未知错误: %s", e)
        from fastapi.responses import JSONResponse

        return JSONResponse(status_code=500, content={"error": "内部服务器错误"})


@router.post("/index/upsert")
async def index_upsert(request: Request, body: IndexUpsertRequest) -> dict:
    """批量插入/更新向量

    向 Qdrant 索引中批量插入或更新向量数据。
    """
    embedding_service = request.app.state.embedding_service

    try:
        await embedding_service.upsert(
            index_name=body.index_name,
            ids=body.ids,
            vectors=body.vectors,
            payloads=body.payloads,
        )
        return {"status": "ok", "count": len(body.ids)}
    except EmbeddingError as e:
        logger.error("向量插入失败: %s", e)
        from fastapi.responses import JSONResponse

        return JSONResponse(status_code=500, content={"error": e.message, "code": e.code})
    except Exception as e:
        logger.error("向量插入未知错误: %s", e)
        from fastapi.responses import JSONResponse

        return JSONResponse(status_code=500, content={"error": "内部服务器错误"})


@router.post("/search", response_model=SearchResponse)
async def search(request: Request, body: SearchRequest) -> SearchResponse:
    """向量搜索

    根据查询文本生成向量，在 Qdrant 索引中搜索最相似的文档。
    """
    embedding_service = request.app.state.embedding_service

    try:
        # 先生成查询向量
        query_vectors = await embedding_service.embed([body.query_text])
        if not query_vectors:
            return SearchResponse(results=[])

        # 执行搜索
        results = await embedding_service.search(
            index_name=body.index_name,
            query_vector=query_vectors[0],
            limit=body.limit,
            filter_=body.filter_,
        )
        return SearchResponse(results=results)
    except EmbeddingError as e:
        logger.error("向量搜索失败: %s", e)
        from fastapi.responses import JSONResponse

        return JSONResponse(status_code=500, content={"error": e.message, "code": e.code})
    except Exception as e:
        logger.error("向量搜索未知错误: %s", e)
        from fastapi.responses import JSONResponse

        return JSONResponse(status_code=500, content={"error": "内部服务器错误"})
