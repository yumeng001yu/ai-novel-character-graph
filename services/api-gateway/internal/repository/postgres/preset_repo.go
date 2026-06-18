package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/model"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// PresetRepo 提示词预设仓库（使用 PostgreSQL 存储）
type PresetRepo struct{}

// NewPresetRepo 创建提示词预设仓库实例
func NewPresetRepo() *PresetRepo {
	return &PresetRepo{}
}

// EnsureTable 确保预设表存在
func (r *PresetRepo) EnsureTable(ctx context.Context) error {
	sql := `
		CREATE TABLE IF NOT EXISTS prompt_presets (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			is_default BOOLEAN NOT NULL DEFAULT FALSE,
			system_prompt TEXT NOT NULL DEFAULT '',
			character_template TEXT NOT NULL DEFAULT '',
			behavior_guidelines TEXT NOT NULL DEFAULT '',
			group_system_prompt TEXT NOT NULL DEFAULT '',
			dialogue_system_prompt TEXT NOT NULL DEFAULT '',
			first_message_suffix TEXT NOT NULL DEFAULT '',
			max_tokens INTEGER NOT NULL DEFAULT 4096,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`
	_, err := GetPool().Exec(ctx, sql)
	if err != nil {
		return fmt.Errorf("创建预设表失败: %w", err)
	}
	slog.Info("预设表确保完成")

	// 如果表为空，种子一个默认预设
	var count int
	err = GetPool().QueryRow(ctx, `SELECT COUNT(*) FROM prompt_presets`).Scan(&count)
	if err != nil {
		return fmt.Errorf("查询预设数量失败: %w", err)
	}
	if count == 0 {
		if err := r.seedDefault(ctx); err != nil {
			return fmt.Errorf("种子默认预设失败: %w", err)
		}
	}
	return nil
}

// seedDefault 种子默认预设
func (r *PresetRepo) seedDefault(ctx context.Context) error {
	defaultPreset := &model.PromptPreset{
		ID:                  "default-preset",
		Name:                "默认预设",
		IsDefault:           true,
		SystemPrompt:        "你现在是小说角色{{character_name}}，请完全以该角色的身份进行对话。保持角色性格、语气和背景设定的一致性。",
		CharacterTemplate:   "姓名：{{character_name}}\n性别：{{character_gender}}\n阵营：{{character_faction}}\n身份：{{character_identity}}\n性格：{{character_personality}}\n动机：{{character_motivation}}",
		BehaviorGuidelines:  "- 你必须始终保持角色身份\n- 绝对不要提及你是AI或语言模型\n- 保持角色性格的一致性\n- 回复内容要符合角色的知识范围和世界观\n- 对话要自然流畅，避免机械式回答",
		GroupSystemPrompt:   "以下是一场群聊场景，多个角色同时参与对话：\n{{characters}}\n请各角色根据自身性格和关系自然互动。",
		DialogueSystemPrompt: "以下是角色之间的对话场景：\n{{characters}}\n请根据角色关系和性格，生成自然的对话内容。",
		FirstMessageSuffix:  "请先简要介绍自己的身份和背景。",
		MaxTokens:           60000,
	}
	now := time.Now()
	defaultPreset.CreatedAt = now.Format(time.RFC3339)
	defaultPreset.UpdatedAt = now.Format(time.RFC3339)

	sql := `INSERT INTO prompt_presets (
		id, name, is_default, system_prompt, character_template,
		behavior_guidelines, group_system_prompt, dialogue_system_prompt,
		first_message_suffix, max_tokens, created_at, updated_at
	) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`

	_, err := GetPool().Exec(ctx, sql,
		defaultPreset.ID, defaultPreset.Name, defaultPreset.IsDefault,
		defaultPreset.SystemPrompt, defaultPreset.CharacterTemplate,
		defaultPreset.BehaviorGuidelines, defaultPreset.GroupSystemPrompt,
		defaultPreset.DialogueSystemPrompt, defaultPreset.FirstMessageSuffix,
		defaultPreset.MaxTokens, defaultPreset.CreatedAt, defaultPreset.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("创建默认预设失败: %w", err)
	}
	slog.Info("默认预设种子完成", "id", defaultPreset.ID)
	return nil
}

// List 获取所有预设列表
func (r *PresetRepo) List(ctx context.Context) ([]*model.PromptPreset, error) {
	sql := `SELECT id, name, is_default, system_prompt, character_template,
	        behavior_guidelines, group_system_prompt, dialogue_system_prompt,
	        first_message_suffix, max_tokens, created_at, updated_at
	        FROM prompt_presets ORDER BY created_at ASC`

	rows, err := GetPool().Query(ctx, sql)
	if err != nil {
		return nil, fmt.Errorf("查询预设列表失败: %w", err)
	}
	defer rows.Close()

	var presets []*model.PromptPreset
	for rows.Next() {
		preset, err := scanPreset(rows)
		if err != nil {
			return nil, err
		}
		presets = append(presets, preset)
	}
	return presets, nil
}

// FindByID 根据 ID 查找预设
func (r *PresetRepo) FindByID(ctx context.Context, id string) (*model.PromptPreset, error) {
	sql := `SELECT id, name, is_default, system_prompt, character_template,
	        behavior_guidelines, group_system_prompt, dialogue_system_prompt,
	        first_message_suffix, max_tokens, created_at, updated_at
	        FROM prompt_presets WHERE id = $1`

	rows, err := GetPool().Query(ctx, sql, id)
	if err != nil {
		return nil, fmt.Errorf("查询预设失败: %w", err)
	}
	defer rows.Close()

	if rows.Next() {
		return scanPreset(rows)
	}
	return nil, nil
}

// Create 创建预设
func (r *PresetRepo) Create(ctx context.Context, preset *model.PromptPreset) error {
	if preset.ID == "" {
		preset.ID = uuid.New().String()
	}
	now := time.Now()
	preset.CreatedAt = now.Format(time.RFC3339)
	preset.UpdatedAt = now.Format(time.RFC3339)

	sql := `INSERT INTO prompt_presets (
		id, name, is_default, system_prompt, character_template,
		behavior_guidelines, group_system_prompt, dialogue_system_prompt,
		first_message_suffix, max_tokens, created_at, updated_at
	) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`

	_, err := GetPool().Exec(ctx, sql,
		preset.ID, preset.Name, preset.IsDefault, preset.SystemPrompt,
		preset.CharacterTemplate, preset.BehaviorGuidelines,
		preset.GroupSystemPrompt, preset.DialogueSystemPrompt,
		preset.FirstMessageSuffix, preset.MaxTokens,
		preset.CreatedAt, preset.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("创建预设失败: %w", err)
	}
	slog.Info("预设创建成功", "id", preset.ID, "name", preset.Name)
	return nil
}

// Update 更新预设
func (r *PresetRepo) Update(ctx context.Context, preset *model.PromptPreset) error {
	preset.UpdatedAt = time.Now().Format(time.RFC3339)

	sql := `UPDATE prompt_presets SET
		name = $2, is_default = $3, system_prompt = $4, character_template = $5,
		behavior_guidelines = $6, group_system_prompt = $7, dialogue_system_prompt = $8,
		first_message_suffix = $9, max_tokens = $10, updated_at = $11
		WHERE id = $1`

	_, err := GetPool().Exec(ctx, sql,
		preset.ID, preset.Name, preset.IsDefault, preset.SystemPrompt,
		preset.CharacterTemplate, preset.BehaviorGuidelines,
		preset.GroupSystemPrompt, preset.DialogueSystemPrompt,
		preset.FirstMessageSuffix, preset.MaxTokens,
		preset.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("更新预设失败: %w", err)
	}
	slog.Info("预设更新成功", "id", preset.ID)
	return nil
}

// Delete 删除预设
func (r *PresetRepo) Delete(ctx context.Context, id string) error {
	sql := `DELETE FROM prompt_presets WHERE id = $1`
	_, err := GetPool().Exec(ctx, sql, id)
	if err != nil {
		return fmt.Errorf("删除预设失败: %w", err)
	}
	slog.Info("预设删除成功", "id", id)
	return nil
}

// SetDefault 设置默认预设
func (r *PresetRepo) SetDefault(ctx context.Context, id string) error {
	tx, err := GetPool().Begin(ctx)
	if err != nil {
		return fmt.Errorf("开启事务失败: %w", err)
	}
	defer tx.Rollback(ctx)

	// 先取消所有默认
	_, err = tx.Exec(ctx, `UPDATE prompt_presets SET is_default = FALSE, updated_at = $1 WHERE is_default = TRUE`, time.Now().Format(time.RFC3339))
	if err != nil {
		return fmt.Errorf("取消默认预设失败: %w", err)
	}

	// 设置新的默认
	_, err = tx.Exec(ctx, `UPDATE prompt_presets SET is_default = TRUE, updated_at = $1 WHERE id = $2`, time.Now().Format(time.RFC3339), id)
	if err != nil {
		return fmt.Errorf("设置默认预设失败: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("提交事务失败: %w", err)
	}

	slog.Info("默认预设设置成功", "id", id)
	return nil
}

// GetDefault 获取默认预设
func (r *PresetRepo) GetDefault(ctx context.Context) (*model.PromptPreset, error) {
	sql := `SELECT id, name, is_default, system_prompt, character_template,
	        behavior_guidelines, group_system_prompt, dialogue_system_prompt,
	        first_message_suffix, max_tokens, created_at, updated_at
	        FROM prompt_presets WHERE is_default = TRUE LIMIT 1`

	rows, err := GetPool().Query(ctx, sql)
	if err != nil {
		return nil, fmt.Errorf("查询默认预设失败: %w", err)
	}
	defer rows.Close()

	if rows.Next() {
		return scanPreset(rows)
	}
	return nil, nil
}

// scanPreset 扫描行数据到预设模型
func scanPreset(rows pgx.Rows) (*model.PromptPreset, error) {
	var preset model.PromptPreset
	var createdAt, updatedAt time.Time

	err := rows.Scan(
		&preset.ID, &preset.Name, &preset.IsDefault, &preset.SystemPrompt,
		&preset.CharacterTemplate, &preset.BehaviorGuidelines,
		&preset.GroupSystemPrompt, &preset.DialogueSystemPrompt,
		&preset.FirstMessageSuffix, &preset.MaxTokens,
		&createdAt, &updatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("扫描预设数据失败: %w", err)
	}

	preset.CreatedAt = createdAt.Format(time.RFC3339)
	preset.UpdatedAt = updatedAt.Format(time.RFC3339)

	return &preset, nil
}

// toJSON 辅助函数，将值序列化为 JSON 字符串
func toJSON(v interface{}) string {
	data, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(data)
}
