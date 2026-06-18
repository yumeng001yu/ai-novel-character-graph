"""AI 服务核心配置模块"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置，从环境变量或 .env 文件加载"""

    # 服务配置
    service_host: str = "0.0.0.0"
    service_port: int = 8000

    # AI 配置
    ai_api_url: str = ""
    ai_api_key: str = ""
    ai_model: str = ""
    ai_context_size: int = 200000

    # Embedding 配置
    embedding_api_url: str = ""
    embedding_api_key: str = ""
    embedding_model: str = ""
    embedding_dimensions: int = 1536

    # Reranker 配置
    reranker_api_url: str = ""
    reranker_api_key: str = ""
    reranker_model: str = ""

    # Neo4j
    neo4j_uri: str = "bolt://neo4j:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = ""

    # Redis
    redis_url: str = "redis://redis:6379"

    # Qdrant
    qdrant_url: str = "http://qdrant:6333"
    qdrant_api_key: str = ""

    # 代理
    https_proxy: str = ""

    model_config = SettingsConfigDict(env_file=".env")


# 全局单例
settings = Settings()
