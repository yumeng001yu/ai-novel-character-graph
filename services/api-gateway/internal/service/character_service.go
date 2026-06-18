package service

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/model"
	neo4jRepo "github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/repository/neo4j"
)

// CharacterService 角色业务逻辑
type CharacterService struct {
	characterRepo *neo4jRepo.CharacterRepo
	relationRepo  *neo4jRepo.RelationRepo
	eventRepo     *neo4jRepo.EventRepo
}

// NewCharacterService 创建角色服务实例
func NewCharacterService() *CharacterService {
	return &CharacterService{
		characterRepo: neo4jRepo.NewCharacterRepo(),
		relationRepo:  neo4jRepo.NewRelationRepo(),
		eventRepo:     neo4jRepo.NewEventRepo(),
	}
}

// Get 获取角色详情
func (s *CharacterService) Get(ctx context.Context, id string) (*model.Character, error) {
	character, err := s.characterRepo.FindByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("获取角色失败: %w", err)
	}
	if character == nil {
		return nil, fmt.Errorf("角色不存在: %s", id)
	}
	return character, nil
}

// Search 搜索角色
func (s *CharacterService) Search(ctx context.Context, novelId string, keyword string) ([]*model.Character, error) {
	return s.characterRepo.Search(ctx, novelId, keyword)
}

// ListByNovelId 获取小说的所有角色（用于角色对话列表）
func (s *CharacterService) ListByNovelId(ctx context.Context, novelId string) ([]*model.Character, error) {
	return s.characterRepo.FindByNovelId(ctx, novelId)
}

// GetTimeline 获取角色时间线（相关事件和关系变化）
func (s *CharacterService) GetTimeline(ctx context.Context, id string) (interface{}, error) {
	// 获取角色信息
	character, err := s.characterRepo.FindByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("获取角色失败: %w", err)
	}
	if character == nil {
		return nil, fmt.Errorf("角色不存在: %s", id)
	}

	// 获取角色相关的关系
	relations, err := s.relationRepo.FindByCharacterIds(ctx, []string{id})
	if err != nil {
		slog.Warn("获取角色关系失败", "characterId", id, "error", err)
	}

	// 获取小说相关的事件
	events, err := s.eventRepo.FindByNovelId(ctx, character.NovelID)
	if err != nil {
		slog.Warn("获取小说事件失败", "novelId", character.NovelID, "error", err)
	}

	// 构建时间线
	// 将事件转换为前端期望的 experienceTimeline 格式
	experienceTimeline := make([]map[string]interface{}, 0)
	for _, evt := range events {
		experienceTimeline = append(experienceTimeline, map[string]interface{}{
			"chapter":    evt.Chapter,
			"event":      evt.Name,
			"type":       evt.EventType,
			"importance": 5,
		})
	}

	timeline := map[string]interface{}{
		"character":          character,
		"relations":          relations,
		"events":             events,
		"experienceTimeline": experienceTimeline,
		"personalAnalysis": map[string]interface{}{
			"characterArc": "",
			"personality":  "",
			"motivation":   "",
			"inferences":   []interface{}{},
		},
	}
	return timeline, nil
}

// Merge 合并角色（将多个角色合并为一个）
func (s *CharacterService) Merge(ctx context.Context, targetId string, sourceIds []string) (*model.Character, error) {
	// 获取目标角色
	target, err := s.characterRepo.FindByID(ctx, targetId)
	if err != nil {
		return nil, fmt.Errorf("获取目标角色失败: %w", err)
	}
	if target == nil {
		return nil, fmt.Errorf("目标角色不存在: %s", targetId)
	}

	// 获取所有源角色
	sources, err := s.characterRepo.FindByIds(ctx, sourceIds)
	if err != nil {
		return nil, fmt.Errorf("获取源角色失败: %w", err)
	}

	// 合并别名
	mergedAliases := make(map[string]bool)
	for _, alias := range target.Aliases {
		mergedAliases[alias] = true
	}
	for _, source := range sources {
		mergedAliases[source.Name] = true
		for _, alias := range source.Aliases {
			mergedAliases[alias] = true
		}
	}

	// 去除与目标名称相同的别名
	delete(mergedAliases, target.Name)

	newAliases := make([]string, 0, len(mergedAliases))
	for alias := range mergedAliases {
		newAliases = append(newAliases, alias)
	}
	target.Aliases = newAliases

	// 更新目标角色
	if err := s.characterRepo.Update(ctx, target); err != nil {
		return nil, fmt.Errorf("更新目标角色失败: %w", err)
	}

	// 删除源角色（关系会通过 DETACH DELETE 自动删除）
	for _, source := range sources {
		if err := s.characterRepo.Delete(ctx, source.ID); err != nil {
			slog.Warn("删除源角色失败", "characterId", source.ID, "error", err)
		}
	}

	slog.Info("角色合并完成", "targetId", targetId, "sourceCount", len(sources))
	return target, nil
}

// Split 拆分角色（将一个角色拆分为多个）
func (s *CharacterService) Split(ctx context.Context, sourceId string, newCharacters []*model.Character) ([]*model.Character, error) {
	// 获取源角色
	source, err := s.characterRepo.FindByID(ctx, sourceId)
	if err != nil {
		return nil, fmt.Errorf("获取源角色失败: %w", err)
	}
	if source == nil {
		return nil, fmt.Errorf("源角色不存在: %s", sourceId)
	}

	// 创建新角色
	created := make([]*model.Character, 0, len(newCharacters))
	for _, char := range newCharacters {
		char.NovelID = source.NovelID
		if err := s.characterRepo.Create(ctx, char); err != nil {
			slog.Warn("创建拆分角色失败", "name", char.Name, "error", err)
			continue
		}
		created = append(created, char)
	}

	// 删除源角色
	if err := s.characterRepo.Delete(ctx, sourceId); err != nil {
		slog.Warn("删除源角色失败", "sourceId", sourceId, "error", err)
	}

	slog.Info("角色拆分完成", "sourceId", sourceId, "newCount", len(created))
	return created, nil
}
