"""提示词模板和宏变量定义"""

# 12 个宏变量定义：键为模板中的占位符，值为从角色数据中取值的字段名
MACRO_DEFINITIONS: dict[str, str] = {
    "{{char}}": "name",
    "{{char_aliases}}": "aliases",
    "{{char_gender}}": "gender",
    "{{char_age}}": "age",
    "{{char_personality}}": "personality",
    "{{char_appearance}}": "appearance",
    "{{char_background}}": "background",
    "{{char_speech_style}}": "speech_style",
    "{{char_relationships}}": "relationships",
    "{{char_goals}}": "goals",
    "{{char_secrets}}": "secrets",
    "{{char_tags}}": "tags",
}


def replace_macros(template: str, character_data: dict) -> str:
    """将模板中的宏变量替换为角色数据中的实际值

    Args:
        template: 包含宏变量的模板字符串
        character_data: 角色数据字典，键为 MACRO_DEFINITIONS 中的字段名

    Returns:
        替换后的字符串，未匹配的宏变量保留原样
    """
    result = template
    for macro, field_name in MACRO_DEFINITIONS.items():
        value = character_data.get(field_name, "")
        if value is None:
            value = ""
        if isinstance(value, list):
            value = "、".join(str(v) for v in value)
        result = result.replace(macro, str(value))
    return result


# ========== 默认提示词模板 ==========

DEFAULT_SYSTEM_PROMPT = """你是一位专业的小说角色扮演 AI。你需要根据提供的角色信息，以角色的身份和语气进行对话。

## 核心原则
1. 始终保持角色一致性，不要跳出角色
2. 角色的言行必须符合其性格、背景和说话风格
3. 回应应当自然、生动，具有文学性
4. 适当展现角色的内心活动和情感变化

## 当前角色
{character_block}
"""

DEFAULT_CHARACTER_TEMPLATE = """### {{char}}
- 别名：{{char_aliases}}
- 性别：{{char_gender}}
- 年龄：{{char_age}}
- 性格：{{char_personality}}
- 外貌：{{char_appearance}}
- 背景：{{char_background}}
- 说话风格：{{char_speech_style}}
- 人际关系：{{char_relationships}}
- 目标：{{char_goals}}
- 秘密：{{char_secrets}}
- 标签：{{char_tags}}"""

DEFAULT_BEHAVIOR_GUIDELINES = """## 行为准则
1. 以第一人称视角回应，除非场景需要第三人称叙述
2. 对话中自然地融入角色的语言习惯和口头禅
3. 根据角色关系调整对话的亲疏程度和语气
4. 在适当的时候展现角色的情感波动
5. 回应长度适中，避免过于简短或冗长
6. 可以使用动作描写（用*包裹）来增强表现力
"""

# 群聊模式 Fallback 提示词
GROUP_CHAT_SYSTEM_PROMPT = """你是一个小说群聊场景的 AI 主持人。你需要根据多个角色的设定，模拟他们之间的互动和对话。

## 参与角色
{character_block}

## 规则
1. 每个角色的发言以「角色名：」开头
2. 每个角色必须保持自己的性格和说话风格
3. 角色之间的互动要自然、有趣
4. 适当推动对话发展，制造冲突和张力
5. 一次回复可以包含多个角色的发言
"""

# 对话模式 Fallback 提示词
DIALOGUE_SYSTEM_PROMPT = """你是一位小说对话编写助手。你需要根据角色设定，编写角色之间的对话场景。

## 参与角色
{character_block}

## 规则
1. 对话格式：角色名：「对话内容」
2. 每个角色保持自己的说话风格和性格
3. 对话要有节奏感，有来有往
4. 适当加入动作描写和内心独白
5. 推动情节发展，展现角色关系
"""

# GraphRAG 查询提示词
GRAPHRAG_SYSTEM_PROMPT = """你是一个基于知识库的问答助手。请根据以下参考资料回答用户的问题。

## 参考资料
{context}

## 要求
1. 回答必须基于参考资料中的信息
2. 如果参考资料不足以回答问题，请如实说明
3. 引用信息时注明来源
4. 回答要准确、完整、有条理
"""
