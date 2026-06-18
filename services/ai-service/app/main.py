"""FastAPI 应用入口

- 创建 FastAPI app
- 注册路由（前缀 /api/ai）
- 生命周期管理（启动时初始化连接，关闭时清理）
- CORS 中间件
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import chat, embedding, extract, graphrag, health
from app.core.ai_client import AIClient
from app.core.chat import CharacterChatService
from app.core.config import settings
from app.core.embedding import EmbeddingService
from app.core.extractor import ExtractorService
from app.core.graphrag import GraphRAGService
from app.core.reranker import RerankerService

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理

    启动时初始化各服务客户端，关闭时清理连接。
    """
    # === 启动阶段 ===
    logger.info("AI 服务启动中...")

    # 初始化 AI 客户端
    ai_client = AIClient()
    app.state.ai_client = ai_client

    # 初始化嵌入服务
    embedding_service = EmbeddingService()
    app.state.embedding_service = embedding_service

    # 初始化重排序服务
    reranker_service = RerankerService()
    app.state.reranker_service = reranker_service

    # 初始化角色对话服务
    chat_service = CharacterChatService(ai_client)
    app.state.chat_service = chat_service

    # 初始化 GraphRAG 服务
    graphrag_service = GraphRAGService(ai_client, embedding_service, reranker_service)
    app.state.graphrag_service = graphrag_service

    # 初始化图谱提取服务
    extractor_service = ExtractorService(ai_client)
    app.state.extractor_service = extractor_service

    logger.info("AI 服务启动完成，监听 %s:%d", settings.service_host, settings.service_port)

    yield

    # === 关闭阶段 ===
    logger.info("AI 服务关闭中...")

    await ai_client.close()
    await embedding_service.close()
    await reranker_service.close()
    await chat_service.close()
    await graphrag_service.close()

    logger.info("AI 服务已关闭")


def create_app() -> FastAPI:
    """创建 FastAPI 应用实例"""
    app = FastAPI(
        title="AI Service",
        description="小说角色图谱 AI 服务层",
        version="0.1.0",
        lifespan=lifespan,
    )

    # CORS 中间件
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 注册路由，前缀 /api/ai
    app.include_router(health.router, prefix="/api/ai")
    app.include_router(chat.router, prefix="/api/ai")
    app.include_router(graphrag.router, prefix="/api/ai")
    app.include_router(embedding.router, prefix="/api/ai")
    app.include_router(extract.router, prefix="/api/ai")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.service_host,
        port=settings.service_port,
        reload=True,
    )
