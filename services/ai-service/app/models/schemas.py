"""Pydantic 请求/响应模型"""

from pydantic import BaseModel, Field


# ========== 请求模型 ==========


class ChatRequest(BaseModel):
    """角色对话请求"""

    novel_id: str = Field(..., description="小说 ID")
    character_ids: list[str] = Field(..., description="角色 ID 列表")
    message: str = Field(..., description="用户消息")
    mode: str = Field(default="chat", description="对话模式：chat / group / dialogue")
    preset_id: str | None = Field(default=None, description="提示词预设 ID")
    history: list[dict] | None = Field(default=None, description="对话历史")


class GraphRAGRequest(BaseModel):
    """GraphRAG 查询请求"""

    novel_id: str = Field(..., description="小说 ID")
    question: str = Field(..., description="用户问题")


class ExtractRequest(BaseModel):
    """图谱构建提取请求"""

    text: str = Field(..., description="小说文本")
    chapter_range: str = Field(default="", description="章节范围描述")
    existing_character_names: list[str] | None = Field(default=None, description="已有角色名列表")
    graph_summary: str | None = Field(default=None, description="前步图谱摘要")


class EmbedRequest(BaseModel):
    """向量嵌入请求"""

    texts: list[str] = Field(..., description="待嵌入的文本列表")


class IndexInitRequest(BaseModel):
    """索引初始化请求"""

    index_name: str = Field(..., description="索引/集合名称")
    dimensions: int = Field(default=1536, description="向量维度")


class IndexUpsertRequest(BaseModel):
    """批量插入请求"""

    index_name: str = Field(..., description="索引/集合名称")
    ids: list[str] = Field(..., description="向量 ID 列表")
    vectors: list[list[float]] = Field(..., description="向量列表")
    payloads: list[dict] = Field(..., description="元数据列表")


class SearchRequest(BaseModel):
    """向量搜索请求"""

    index_name: str = Field(..., description="索引/集合名称")
    query_text: str = Field(..., description="查询文本")
    limit: int = Field(default=10, description="返回结果数量上限")
    filter_: dict | None = Field(default=None, alias="filter", description="过滤条件")


# ========== 响应模型 ==========


class EmbedResponse(BaseModel):
    """向量嵌入响应"""

    embeddings: list[list[float]] = Field(..., description="向量列表")
    count: int = Field(..., description="向量数量")


class SearchResponse(BaseModel):
    """向量搜索响应"""

    results: list[dict] = Field(..., description="搜索结果列表")


class HealthResponse(BaseModel):
    """健康检查响应"""

    status: str = Field(default="ok", description="服务状态")
    version: str = Field(default="0.1.0", description="服务版本")


# ========== 预设模型 ==========


class MacroDefinition(BaseModel):
    """宏变量定义"""

    macro: str = Field(..., description="宏变量占位符，如 {{char}}")
    field_name: str = Field(..., description="对应的数据字段名，如 name")
    description: str = Field(default="", description="宏变量描述")


class PromptPreset(BaseModel):
    """提示词预设"""

    id: str = Field(..., description="预设 ID")
    name: str = Field(..., description="预设名称")
    system_prompt: str | None = Field(default=None, description="系统提示词模板")
    character_template: str | None = Field(default=None, description="角色描述模板")
    behavior_guidelines: str | None = Field(default=None, description="行为准则")
    group_prompt: str | None = Field(default=None, description="群聊模式提示词")
    dialogue_prompt: str | None = Field(default=None, description="对话模式提示词")
