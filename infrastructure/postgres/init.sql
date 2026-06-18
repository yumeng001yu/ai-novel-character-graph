-- 提示词预设表
CREATE TABLE IF NOT EXISTS prompt_presets (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    system_prompt TEXT NOT NULL DEFAULT '',
    character_template TEXT NOT NULL DEFAULT '',
    behavior_guidelines TEXT NOT NULL DEFAULT '',
    group_system_prompt TEXT NOT NULL DEFAULT '',
    dialogue_system_prompt TEXT NOT NULL DEFAULT '',
    first_message_suffix TEXT NOT NULL DEFAULT '',
    max_tokens INTEGER NOT NULL DEFAULT 60000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AI 配置表（加密存储）
CREATE TABLE IF NOT EXISTS ai_settings (
    id SERIAL PRIMARY KEY,
    api_url TEXT NOT NULL DEFAULT '',
    api_key_encrypted TEXT NOT NULL DEFAULT '',
    model VARCHAR(255) NOT NULL DEFAULT '',
    context_size INTEGER NOT NULL DEFAULT 200000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Embedding 配置表
CREATE TABLE IF NOT EXISTS embedding_settings (
    id SERIAL PRIMARY KEY,
    api_url TEXT NOT NULL DEFAULT '',
    api_key_encrypted TEXT NOT NULL DEFAULT '',
    model VARCHAR(255) NOT NULL DEFAULT '',
    dimensions INTEGER NOT NULL DEFAULT 1536,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reranker 配置表
CREATE TABLE IF NOT EXISTS reranker_settings (
    id SERIAL PRIMARY KEY,
    api_url TEXT NOT NULL DEFAULT '',
    api_key_encrypted TEXT NOT NULL DEFAULT '',
    model VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 构建配置表
CREATE TABLE IF NOT EXISTS build_settings (
    id SERIAL PRIMARY KEY,
    max_retries INTEGER NOT NULL DEFAULT 3,
    show_cost_estimate BOOLEAN NOT NULL DEFAULT TRUE,
    max_concurrent_ai_calls INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 插入默认预设
INSERT INTO prompt_presets (id, name, is_default, system_prompt, character_template, behavior_guidelines, group_system_prompt, dialogue_system_prompt, first_message_suffix, max_tokens)
VALUES (
    'default',
    '默认预设',
    TRUE,
    '你是一位小说角色扮演专家。请根据角色设定，以角色的口吻和风格进行对话。保持角色性格的一致性，引用角色在小说中的经历和关系来丰富对话内容。',
    '## {{char}}的角色设定

**姓名**：{{char}}
**别名**：{{char_aliases}}
**性别**：{{char_gender}}
**阵营**：{{char_faction}}
**身份**：{{char_identity}}
**性格**：{{char_personality}}
**动机**：{{char_motivation}}

### 关键关系
{{char_relationships}}

### 关键经历
{{char_experiences}}

### 原文参考
{{char_original_texts}}',
    '## 行为准则

1. 始终以{{char}}的视角和口吻说话，不要跳出角色
2. 引用小说中的具体经历和关系来支撑你的回应
3. 如果不确定某件事，可以含糊回应，但不要编造小说中没有的信息
4. 保持{{char}}的性格特征，包括说话方式、用词习惯
5. 对{{user}}的态度要符合{{char}}的性格和关系',
    '你是一场群聊的主持人。多个小说角色同时参与对话，他们之间会互相回应。请确保每个角色保持自己的性格和说话风格。',
    '你是一场对话场景的叙述者。多个角色在特定场景中对话，请以第三人称叙述场景，同时让每个角色用自己的方式说话。',
    '',
    60000
) ON CONFLICT (id) DO NOTHING;

-- 更新时间触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_prompt_presets_updated_at BEFORE UPDATE ON prompt_presets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ai_settings_updated_at BEFORE UPDATE ON ai_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_embedding_settings_updated_at BEFORE UPDATE ON embedding_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reranker_settings_updated_at BEFORE UPDATE ON reranker_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_build_settings_updated_at BEFORE UPDATE ON build_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
