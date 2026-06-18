"""数据库模型，用于 Neo4j 查询结果的映射"""

from pydantic import BaseModel, Field


class Character(BaseModel):
    """角色模型"""

    id: str = Field(default="", description="角色 ID")
    novel_id: str = Field(default="", description="所属小说 ID")
    name: str = Field(default="", description="角色名称")
    aliases: list[str] = Field(default_factory=list, description="别名列表")
    gender: str = Field(default="", description="性别")
    age: str = Field(default="", description="年龄")
    personality: str = Field(default="", description="性格")
    appearance: str = Field(default="", description="外貌")
    background: str = Field(default="", description="背景")
    speech_style: str = Field(default="", description="说话风格")
    relationships: str = Field(default="", description="人际关系描述")
    goals: str = Field(default="", description="目标")
    secrets: str = Field(default="", description="秘密")
    tags: list[str] = Field(default_factory=list, description="标签列表")


class Relation(BaseModel):
    """关系模型"""

    id: str = Field(default="", description="关系 ID")
    novel_id: str = Field(default="", description="所属小说 ID")
    source_id: str = Field(default="", description="源角色 ID")
    target_id: str = Field(default="", description="目标角色 ID")
    relation_type: str = Field(default="", description="关系类型")
    description: str = Field(default="", description="关系描述")
    strength: float = Field(default=0.5, description="关系强度（0-1）")


class Event(BaseModel):
    """事件模型"""

    id: str = Field(default="", description="事件 ID")
    novel_id: str = Field(default="", description="所属小说 ID")
    title: str = Field(default="", description="事件标题")
    description: str = Field(default="", description="事件描述")
    participants: list[str] = Field(default_factory=list, description="参与角色 ID 列表")
    timestamp: str = Field(default="", description="事件时间")
    chapter: str = Field(default="", description="所属章节")


class Novel(BaseModel):
    """小说模型"""

    id: str = Field(default="", description="小说 ID")
    title: str = Field(default="", description="小说标题")
    author: str = Field(default="", description="作者")
    description: str = Field(default="", description="简介")
    genre: str = Field(default="", description="类型")
    character_count: int = Field(default=0, description="角色数量")
    relation_count: int = Field(default=0, description="关系数量")
