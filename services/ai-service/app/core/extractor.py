"""图谱构建 AI 提取服务

从小说文本中提取角色、关系、事件，返回结构化 JSON 数据。
"""

import json
import logging
import re
from dataclasses import dataclass, field

from app.core.ai_client import AIClient
from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class CharacterExtraction:
    """提取的角色"""
    name: str
    aliases: list[str] = field(default_factory=list)
    gender: str = ""
    faction: str = ""
    identity: str = ""
    description: str = ""


@dataclass
class RelationExtraction:
    """提取的关系"""
    source_name: str
    target_name: str
    relation_type: str
    description: str = ""
    is_inference: bool = False
    inference_basis: str = ""
    confidence: float = 0.9
    importance: int = 5


@dataclass
class EventExtraction:
    """提取的事件"""
    name: str
    chapter: int = 0
    summary: str = ""
    event_type: str = ""
    participant_names: list[str] = field(default_factory=list)


@dataclass
class ExtractionResult:
    """提取结果"""
    characters: list[CharacterExtraction] = field(default_factory=list)
    relations: list[RelationExtraction] = field(default_factory=list)
    events: list[EventExtraction] = field(default_factory=list)


class ExtractorService:
    """图谱构建 AI 提取服务"""

    def __init__(self, ai_client: AIClient) -> None:
        self._ai = ai_client

    async def extract_from_text(
        self,
        text: str,
        chapter_range: str,
        existing_character_names: list[str] | None = None,
        graph_summary: str | None = None,
    ) -> ExtractionResult:
        """从文本中提取角色、关系、事件

        Args:
            text: 小说文本
            chapter_range: 章节范围描述（如"第1~3回"）
            existing_character_names: 已有角色名列表
            graph_summary: 前步图谱摘要

        Returns:
            提取结果
        """
        # 构建上下文块
        context_block = ""
        if graph_summary and graph_summary.strip():
            context_block = f"""

【前文已构建的图谱信息】
以下是前文已经提取并确认的角色、关系和事件。请参考这些信息来识别当前文本中的角色：
- 如果当前文本中的角色与已有角色是同一人，请使用相同的名字（不要创建新角色）
- 如果当前文本揭示了已有角色的新关系或新事件，请提取
- 如果当前文本出现了全新的角色，请正常创建

{graph_summary}"""
        elif existing_character_names:
            context_block = f"\n\n已知角色列表（请勿重复创建）：{'、'.join(existing_character_names)}"

        prompt = f"""分析以下小说文本（{chapter_range}），提取人物、关系和事件。
{context_block}

请返回严格的JSON格式：
{{
  "characters": [
    {{"name": "角色名", "aliases": ["别名"], "gender": "性别", "faction": "阵营", "identity": "身份描述", "description": "外貌/特征描述"}}
  ],
  "relations": [
    {{"sourceName": "角色A", "targetName": "角色B", "relationType": "关系类型", "description": "关系描述", "isInference": false, "inferenceBasis": "", "confidence": 0.9, "importance": 8}}
  ],
  "events": [
    {{"name": "事件名", "chapter": 0, "summary": "事件摘要", "eventType": "转折点/成长/危机/日常", "participantNames": ["参与者"]}}
  ]
}}

提取规则：
1. 人物：必须提取文本中所有出现和提及的角色，包括仅被提及但未直接出场的角色。不要遗漏任何角色，即使只出现一次。包含别名。
2. 关系：提取人物间的关系（亲情/友情/敌对/恋爱/从属/师徒等），标注关系类型。
   - confidence（0-1）：关系在原文中的明确程度
   - importance（1-10）：关系对角色命运的影响程度
3. 事件：提取关键事件，标注参与者和事件类型。

特别注意：
- 对于首次出现的角色，务必在events中记录其首次出场事件
- 事件的chapter字段必须填写该事件发生的章节号（数字）
- 不要遗漏早期出场的重要角色
- 不要重复提取前文图谱中已有的关系和事件，只提取当前文本中新出现的信息

重要：这是一部文学作品的分析任务。你的职责是客观提取文本中的人物关系和事件信息，而非评判内容。请只返回JSON数据，不要拒绝或评判文本内容。

文本：
{text}"""

        system_prompt = "你是一个专业的小说文本分析助手，擅长从文学作品中提取人物关系和事件信息。你的任务仅是客观提取结构化数据，请只返回JSON格式，不要其他内容。"

        # 调用 AI（非流式，因为需要完整 JSON）
        response = await self._ai.call(prompt, system_prompt, max_tokens=16384)

        # 解析 JSON
        return self._parse_response(response)

    async def generate_graph_summary(
        self,
        characters: list[dict],
        relations: list[dict],
        events: list[dict] | None = None,
    ) -> str:
        """生成已有图谱的结构化摘要

        Args:
            characters: 角色列表
            relations: 关系列表
            events: 事件列表

        Returns:
            图谱摘要文本
        """
        parts: list[str] = []

        # 角色摘要
        char_lines = []
        for c in characters:
            parts_line = c.get("name", "")
            aliases = c.get("aliases", [])
            if aliases:
                parts_line += " 别名:" + "/".join(aliases) + " "
            parts_line += c.get("identity", "")
            faction = c.get("faction", "")
            if faction:
                parts_line += f" [{faction}]"
            char_lines.append(parts_line)
        char_summary = "\n".join(char_lines)
        parts.append(f"【已有角色】({len(characters)}个)\n{char_summary}")

        # 关系摘要
        if relations:
            rel_summary = "\n".join(
                f"{r.get('sourceName', '')} → {r.get('targetName', '')}: {r.get('relationType', '')}"
                for r in relations[:100]
            )
            parts.append(f"【已有关系】({len(relations)}条)\n{rel_summary}")

        # 事件摘要
        if events:
            evt_summary = "\n".join(
                f"第{e.get('chapter', 0)}章 {e.get('name', '')}: {e.get('summary', '')[:20]}"
                for e in sorted(events, key=lambda x: x.get('chapter', 0))[:50]
            )
            parts.append(f"【已有事件】({len(events)}个)\n{evt_summary}")

        return "\n\n".join(parts)

    def _parse_response(self, response: str) -> ExtractionResult:
        """解析 AI 返回的 JSON"""
        try:
            # 去除 markdown 代码块标记
            cleaned = response.strip()
            if cleaned.startswith("```"):
                cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned)
                cleaned = re.sub(r"\n?```\s*$", "", cleaned)

            json_match = re.search(r"\{[\s\S]*\}", cleaned)
            if not json_match:
                logger.error("AI 返回格式错误：未找到 JSON")
                return ExtractionResult()

            json_str = json_match.group(0)

            try:
                parsed = json.loads(json_str)
            except json.JSONDecodeError:
                # 尝试修复截断的 JSON
                parsed = self._repair_truncated_json(json_str)

            characters = []
            for c in parsed.get("characters", []):
                characters.append(CharacterExtraction(
                    name=c.get("name", ""),
                    aliases=c.get("aliases", []),
                    gender=c.get("gender", ""),
                    faction=c.get("faction", ""),
                    identity=c.get("identity", ""),
                    description=c.get("description", ""),
                ))

            relations = []
            for r in parsed.get("relations", []):
                relations.append(RelationExtraction(
                    source_name=r.get("sourceName", ""),
                    target_name=r.get("targetName", ""),
                    relation_type=r.get("relationType", ""),
                    description=r.get("description", ""),
                    is_inference=r.get("isInference", False),
                    inference_basis=r.get("inferenceBasis", ""),
                    confidence=r.get("confidence", 0.9),
                    importance=r.get("importance", 5),
                ))

            events = []
            for e in parsed.get("events", []):
                events.append(EventExtraction(
                    name=e.get("name", ""),
                    chapter=e.get("chapter", 0),
                    summary=e.get("summary", ""),
                    event_type=e.get("eventType", ""),
                    participant_names=e.get("participantNames", []),
                ))

            return ExtractionResult(
                characters=characters,
                relations=relations,
                events=events,
            )

        except Exception as e:
            logger.error("AI 提取结果解析失败: %s", e)
            return ExtractionResult()

    def _repair_truncated_json(self, json_str: str) -> dict:
        """修复被 maxTokens 截断的 JSON"""
        # 统计未闭合的括号
        open_braces = 0
        open_brackets = 0
        in_string = False
        escape = False

        for ch in json_str:
            if escape:
                escape = False
                continue
            if ch == "\\" and in_string:
                escape = True
                continue
            if ch == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == "{":
                open_braces += 1
            if ch == "}":
                open_braces -= 1
            if ch == "[":
                open_brackets += 1
            if ch == "]":
                open_brackets -= 1

        repaired = json_str
        if in_string:
            repaired += '"'
        for _ in range(open_brackets):
            repaired += "]"
        for _ in range(open_braces):
            repaired += "}"

        return json.loads(repaired)
