"""自定义异常"""


class AIServiceError(Exception):
    """AI 服务基础异常"""

    def __init__(self, message: str, code: str = "AI_SERVICE_ERROR"):
        self.message = message
        self.code = code
        super().__init__(message)


class AIClientError(AIServiceError):
    """AI 客户端调用异常"""

    def __init__(self, message: str, retryable: bool = False):
        self.retryable = retryable
        super().__init__(message, code="AI_CLIENT_ERROR")


class EmbeddingError(AIServiceError):
    """向量嵌入异常"""

    def __init__(self, message: str):
        super().__init__(message, code="EMBEDDING_ERROR")


class RerankerError(AIServiceError):
    """重排序异常"""

    def __init__(self, message: str):
        super().__init__(message, code="RERANKER_ERROR")


class GraphRAGError(AIServiceError):
    """GraphRAG 查询异常"""

    def __init__(self, message: str):
        super().__init__(message, code="GRAPH_RAG_ERROR")


class DatabaseError(AIServiceError):
    """数据库异常"""

    def __init__(self, message: str):
        super().__init__(message, code="DATABASE_ERROR")
