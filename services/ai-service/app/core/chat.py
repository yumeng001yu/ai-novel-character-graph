"""角色对话服务，支持单角色对话、群聊模式和对话模式"""

import json
import logging
from collections.abc import AsyncGenerator

from app.core.ai_client import AIClient
from app.core.config import settings
from app.core.exceptions import AIClientError, DatabaseError
from app.core.prompts import (
    DEFAULT_BEHAVIOR_GUIDELINES,
    DEFAULT_CHARACTER_TEMPLATE,
    DEFAULT_SYSTEM_PROMPT,
    DIALOGUE_SYSTEM_PROMPT,
    GROUP_CHAT_SYSTEM_PROMPT,
    replace_macros,
)
from app.models.database import Character
from app.models.schemas import PromptPreset

logger = logging.getLogger(__name__)


class CharacterChatService:
    """角色对话服务

    支持三种模式：
    - chat: 单角色对话，AI 以角色身份回应
    - group: 群聊模式，模拟多个角色互动
    - dialogue: 对话模式，编写角色间对话场景
    """

    def __init__(self, ai_client: AIClient) -> None:
        self._ai = ai_client
        self._neo4j_driver = None

    async def _get_neo4j_session(self):
        """获取 Neo4j 异步会话"""
        from neo4j import AsyncGraphDatabase

        if self._neo4j_driver is None:
            self._neo4j_driver = AsyncGraphDatabase.driver(
                settings.neo4j_uri,
                auth=(settings.neo4j_user, settings.neo4j_password),
            )
        return self._neo4j_driver.session()

    async def _load_characters(self, novel_id: str, character_ids: list[str]) -> list[Character]:
        """从 Neo4j 加载角色数据

        Args:
            novel_id: 小说 ID
            character_ids: 角色 ID 列表

        Returns:
            角色对象列表
        """
        try:
            session = await self._get_neo4j_session()
            characters = []

            for char_id in character_ids:
                result = await session.run(
                    """
                    MATCH (c:Character {novelId: $novel_id, id: $char_id})
                    RETURN c
                    """,
                    novel_id=novel_id,
                    char_id=char_id,
                )
                records = await result.data()
                if records:
                    char_data = records[0]["c"]
                    characters.append(Character(**char_data))

            return characters

        except Exception as e:
            logger.error("从 Neo4j 加载角色失败: %s", e)
            raise DatabaseError(f"加载角色数据失败: {e}") from e

    async def _load_preset(self, preset_id: str | None) -> PromptPreset | None:
        """加载提示词预设

        目前从 Redis 缓存或直接返回默认预设。
        未来可从 PostgreSQL 加载用户自定义预设。

        Args:
            preset_id: 预设 ID

        Returns:
            预设对象，如果未指定则返回 None
        """
        if not preset_id:
            return None

        try:
            import redis.asyncio as aioredis

            r = aioredis.from_url(settings.redis_url)
            cached = await r.get(f"preset:{preset_id}")
            await r.close()

            if cached:
                data = json.loads(cached)
                return PromptPreset(**data)
        except Exception as e:
            logger.warning("加载预设失败，将使用默认模板: %s", e)

        return None

    def _build_character_block(self, characters: list[Character], template: str) -> str:
        """构建角色描述块

        对每个角色使用模板进行宏替换，然后拼接。

        Args:
            characters: 角色列表
            template: 角色描述模板

        Returns:
            拼接后的角色描述文本
        """
        blocks = []
        for char in characters:
            char_data = char.model_dump()
            block = replace_macros(template, char_data)
            blocks.append(block)
        return "\n\n".join(blocks)

    def _build_system_prompt(
        self,
        characters: list[Character],
        mode: str,
        preset: PromptPreset | None,
    ) -> str:
        """构建系统提示词

        Args:
            characters: 角色列表
            mode: 对话模式（chat/group/dialogue）
            preset: 提示词预设

        Returns:
            完整的系统提示词
        """
        # 确定使用的模板
        if preset:
            system_template = preset.system_prompt or DEFAULT_SYSTEM_PROMPT
            char_template = preset.character_template or DEFAULT_CHARACTER_TEMPLATE
            behavior = preset.behavior_guidelines or DEFAULT_BEHAVIOR_GUIDELINES
        else:
            system_template = DEFAULT_SYSTEM_PROMPT
            char_template = DEFAULT_CHARACTER_TEMPLATE
            behavior = DEFAULT_BEHAVIOR_GUIDELINES

        # 构建角色描述块
        character_block = self._build_character_block(characters, char_template)

        # 根据模式选择系统提示词
        if mode == "group":
            prompt = GROUP_CHAT_SYSTEM_PROMPT.format(character_block=character_block)
        elif mode == "dialogue":
            prompt = DIALOGUE_SYSTEM_PROMPT.format(character_block=character_block)
        else:
            # chat 模式
            prompt = system_template.format(character_block=character_block)
            prompt += "\n" + behavior

        return prompt

    async def chat(
        self,
        novel_id: str,
        character_ids: list[str],
        message: str,
        mode: str = "chat",
        preset_id: str | None = None,
        history: list[dict] | None = None,
    ) -> AsyncGenerator[str, None]:
        """角色对话，流式返回

        Args:
            novel_id: 小说 ID
            character_ids: 角色 ID 列表
            message: 用户消息
            mode: 对话模式（chat/group/dialogue）
            preset_id: 提示词预设 ID
            history: 对话历史

        Yields:
            AI 生成的文本片段
        """
        # 加载角色数据
        characters = await self._load_characters(novel_id, character_ids)
        if not characters:
            raise DatabaseError(f"未找到角色数据: novel_id={novel_id}, character_ids={character_ids}")

        # 加载预设
        preset = await self._load_preset(preset_id)

        # 构建系统提示词
        system_prompt = self._build_system_prompt(characters, mode, preset)

        # 构建消息列表
        messages: list[dict] = [{"role": "system", "content": system_prompt}]

        # 添加对话历史
        if history:
            for msg in history:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                if role in ("user", "assistant") and content:
                    messages.append({"role": role, "content": content})

        # 添加当前用户消息
        messages.append({"role": "user", "content": message})

        # 流式调用 AI
        async for text in self._ai.call_stream(messages):
            yield text

    async def close(self) -> None:
        """关闭连接"""
        if self._neo4j_driver is not None:
            await self._neo4j_driver.close()
            self._neo4j_driver = None
