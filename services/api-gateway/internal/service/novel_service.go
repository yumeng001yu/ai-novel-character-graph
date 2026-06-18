package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/neo4j/neo4j-go-driver/v5/neo4j"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/model"
	neo4jRepo "github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/repository/neo4j"
	redisRepo "github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/repository/redis"
)

// NovelService 小说业务逻辑
type NovelService struct {
	novelRepo     *neo4jRepo.NovelRepo
	characterRepo *neo4jRepo.CharacterRepo
	relationRepo  *neo4jRepo.RelationRepo
	eventRepo     *neo4jRepo.EventRepo
	taskRepo      *redisRepo.TaskQueueRepo
	chapterRepo   *neo4jRepo.ChapterRepo
	parserService *ChapterParserService
}

// NewNovelService 创建小说服务实例
func NewNovelService() *NovelService {
	return &NovelService{
		novelRepo:     neo4jRepo.NewNovelRepo(),
		characterRepo: neo4jRepo.NewCharacterRepo(),
		relationRepo:  neo4jRepo.NewRelationRepo(),
		eventRepo:     neo4jRepo.NewEventRepo(),
		taskRepo:      redisRepo.NewTaskQueueRepo(),
		chapterRepo:   neo4jRepo.NewChapterRepo(),
		parserService: NewChapterParserService(),
	}
}

// List 获取小说列表
func (s *NovelService) List(ctx context.Context) ([]*model.Novel, error) {
	return s.novelRepo.FindAll(ctx)
}

// Get 获取小说详情
func (s *NovelService) Get(ctx context.Context, id string) (*model.Novel, error) {
	novel, err := s.novelRepo.FindByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("获取小说失败: %w", err)
	}
	if novel == nil {
		return nil, fmt.Errorf("小说不存在: %s", id)
	}
	return novel, nil
}

// Create 创建小说
func (s *NovelService) Create(ctx context.Context, novel *model.Novel) error {
	return s.novelRepo.Create(ctx, novel)
}

// Delete 删除小说
func (s *NovelService) Delete(ctx context.Context, id string) error {
	// 先删除关联的事件
	events, err := s.eventRepo.FindByNovelId(ctx, id)
	if err != nil {
		slog.Warn("删除小说时查询事件失败", "novelId", id, "error", err)
	} else {
		for _, event := range events {
			if err := s.eventRepo.Delete(ctx, event.ID); err != nil {
				slog.Warn("删除事件失败", "eventId", event.ID, "error", err)
			}
		}
	}

	// 删除关联的角色
	characters, err := s.characterRepo.FindByNovelId(ctx, id)
	if err != nil {
		slog.Warn("删除小说时查询角色失败", "novelId", id, "error", err)
	} else {
		for _, char := range characters {
			if err := s.characterRepo.Delete(ctx, char.ID); err != nil {
				slog.Warn("删除角色失败", "characterId", char.ID, "error", err)
			}
		}
	}

	// 最后删除小说节点
	return s.novelRepo.Delete(ctx, id)
}

// GetGraph 获取小说的角色关系图谱
func (s *NovelService) GetGraph(ctx context.Context, id string) (interface{}, error) {
	graphSvc := NewGraphService()
	return graphSvc.GetFullGraph(ctx, id)
}

// GetEvents 获取小说的事件列表
func (s *NovelService) GetEvents(ctx context.Context, id string) ([]*model.Event, error) {
	return s.eventRepo.FindByNovelId(ctx, id)
}

// GetGraphStats 获取图谱统计信息（角色数和关系数）
func (s *NovelService) GetGraphStats(ctx context.Context, novelId string) (charCount int, relCount int) {
	characters, err := s.characterRepo.FindByNovelId(ctx, novelId)
	if err == nil {
		charCount = len(characters)
	}
	relations, err := s.relationRepo.FindByNovelId(ctx, novelId)
	if err == nil {
		relCount = len(relations)
	}
	return
}

// SearchCharacters 在小说中搜索角色（按名称或别名匹配）
func (s *NovelService) SearchCharacters(ctx context.Context, novelId string, keyword string) ([]*model.Character, error) {
	characters, err := s.characterRepo.FindByNovelId(ctx, novelId)
	if err != nil {
		return nil, err
	}
	var results []*model.Character
	for _, c := range characters {
		if containsStr(c.Name, keyword) {
			results = append(results, c)
			continue
		}
		for _, alias := range c.Aliases {
			if containsStr(alias, keyword) {
				results = append(results, c)
				break
			}
		}
	}
	return results, nil
}

// containsStr 子串匹配
func containsStr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// SaveNovelText 保存原文到文件
func (s *NovelService) SaveNovelText(novelId string, content []byte) error {
	dir := filepath.Join("/workspace/ai-novel-character-graph/server/output/novels", novelId)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("创建小说目录失败: %w", err)
	}
	filePath := filepath.Join(dir, "original.txt")
	if err := os.WriteFile(filePath, content, 0644); err != nil {
		return fmt.Errorf("保存原文失败: %w", err)
	}
	slog.Info("原文保存成功", "novelId", novelId, "path", filePath)
	return nil
}

// ParseAndSaveChapters 解析并保存章节
func (s *NovelService) ParseAndSaveChapters(ctx context.Context, novelId string, content string, hasChapter bool) error {
	chapters := s.parserService.ParseChapters(content, novelId, hasChapter)
	if len(chapters) == 0 {
		slog.Warn("未解析到任何章节", "novelId", novelId)
		return nil
	}
	if err := s.chapterRepo.CreateBatch(ctx, chapters); err != nil {
		return fmt.Errorf("保存章节失败: %w", err)
	}
	slog.Info("章节解析保存成功", "novelId", novelId, "count", len(chapters))
	return nil
}

// UpdateNovelSteps 更新小说步数
func (s *NovelService) UpdateNovelSteps(ctx context.Context, novelId string, totalTokens int, totalSteps int) error {
	novel, err := s.novelRepo.FindByID(ctx, novelId)
	if err != nil || novel == nil {
		return fmt.Errorf("查询小说失败: %w", err)
	}
	novel.TotalTokens = totalTokens
	novel.TotalSteps = totalSteps
	novel.UpdatedAt = time.Now().Format(time.RFC3339)
	if err := s.novelRepo.Update(ctx, novel); err != nil {
		return fmt.Errorf("更新小说步数失败: %w", err)
	}
	slog.Info("小说步数更新成功", "novelId", novelId, "totalTokens", totalTokens, "totalSteps", totalSteps)
	return nil
}

// ========== 原文查看 ==========

// GetNovelText 获取小说原文
func (s *NovelService) GetNovelText(ctx context.Context, novelId string, chapterNum int) (map[string]interface{}, error) {
	// 检查小说是否存在
	novel, err := s.novelRepo.FindByID(ctx, novelId)
	if err != nil || novel == nil {
		return nil, fmt.Errorf("小说不存在: %s", novelId)
	}

	// 从文件读取原文
	filePath := filepath.Join("/workspace/ai-novel-character-graph/server/output/novels", novelId, "original.txt")
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("原文不存在: %w", err)
	}

	text := string(content)

	// 如果指定了章节，按章节分割返回
	if chapterNum > 0 {
		chapters := s.SplitTextByChapter(text)
		if chapterNum >= 1 && chapterNum <= len(chapters) {
			return map[string]interface{}{
				"text":       chapters[chapterNum-1].Content,
				"content":    chapters[chapterNum-1].Content,
				"chapter":    chapterNum,
				"chapterName": chapters[chapterNum-1].Title,
				"totalChapters": len(chapters),
			}, nil
		}
		return nil, fmt.Errorf("章节 %d 不存在，共 %d 章", chapterNum, len(chapters))
	}

	// 返回全文
	return map[string]interface{}{
		"text":    text,
		"content": text,
	}, nil
}

// ChapterInfo 章节信息
type ChapterInfo struct {
	Index     int    `json:"index"`
	Title     string `json:"title"`
	CharCount int    `json:"charCount"`
	Content   string `json:"content,omitempty"`
}

// SplitTextByChapter 按章节分割文本
func (s *NovelService) SplitTextByChapter(text string) []ChapterInfo {
	re := regexp.MustCompile(`(?:^|\n)\s*(第[零一二三四五六七八九十百千万\d]+[回章节])\s*(.*)`)
	matches := re.FindAllStringSubmatchIndex(text, -1)

	if len(matches) == 0 {
		// 无章节标记，返回全文作为一章
		return []ChapterInfo{
			{Index: 1, Title: "全文", CharCount: len(text), Content: text},
		}
	}

	var chapters []ChapterInfo
	for i, loc := range matches {
		titleStart := loc[2]
		titleEnd := loc[3]
		subtitleStart := loc[4]
		subtitleEnd := loc[5]

		title := text[titleStart:titleEnd]
		if subtitleEnd > subtitleStart {
			subtitle := strings.TrimSpace(text[subtitleStart:subtitleEnd])
			if subtitle != "" {
				title = title + " " + subtitle
			}
		}

		contentStart := loc[0]
		// 跳过标题行前面的换行符
		if contentStart > 0 && text[contentStart] == '\n' {
			contentStart++
		}

		var contentEnd int
		if i+1 < len(matches) {
			contentEnd = matches[i+1][0]
		} else {
			contentEnd = len(text)
		}

		content := text[contentStart:contentEnd]
		chapters = append(chapters, ChapterInfo{
			Index:     i + 1,
			Title:     title,
			CharCount: len(content),
			Content:   content,
		})
	}

	return chapters
}

// GetChapterList 获取章节列表
func (s *NovelService) GetChapterList(ctx context.Context, novelId string) ([]map[string]interface{}, error) {
	// 先从 Neo4j 查询章节
	chapters, err := s.chapterRepo.FindByNovelId(ctx, novelId)
	if err != nil {
		slog.Warn("从 Neo4j 查询章节失败，尝试从文件解析", "novelId", novelId, "error", err)
	}

	if len(chapters) > 0 {
		result := make([]map[string]interface{}, 0, len(chapters))
		for _, ch := range chapters {
			result = append(result, map[string]interface{}{
				"index":     ch.Index,
				"title":     ch.Title,
				"charCount": ch.CharCount,
			})
		}
		return result, nil
	}

	// 回退：从文件解析章节
	filePath := filepath.Join("/workspace/ai-novel-character-graph/server/output/novels", novelId, "original.txt")
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("原文文件不存在")
	}

	chapterInfos := s.SplitTextByChapter(string(content))
	result := make([]map[string]interface{}, 0, len(chapterInfos))
	for _, ch := range chapterInfos {
		result = append(result, map[string]interface{}{
			"index":     ch.Index,
			"title":     ch.Title,
			"charCount": ch.CharCount,
		})
	}
	return result, nil
}

// ========== 快照 ==========

// SnapshotData 快照数据
type SnapshotData struct {
	Step           int                    `json:"step"`
	NovelId        string                 `json:"novelId"`
	Characters     []map[string]interface{} `json:"characters"`
	Relations      []map[string]interface{} `json:"relations"`
	Events         []map[string]interface{} `json:"events"`
	CharacterCount int                    `json:"characterCount"`
	RelationCount  int                    `json:"relationCount"`
	CreatedAt      string                 `json:"createdAt"`
}

// GetSnapshots 获取快照列表
func (s *NovelService) GetSnapshots(ctx context.Context, novelId string) ([]map[string]interface{}, error) {
	// Neo4j 不可用时从文件系统读取
	if !neo4jRepo.IsAvailable() {
		return neo4jRepo.FsLoadSnapshots(novelId), nil
	}

	session := neo4jRepo.GetDriver().NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `
			MATCH (n:Novel {id: $novelId})-[:HAS_SNAPSHOT]->(s:Snapshot)
			RETURN s.step AS step, s.characterCount AS characterCount,
			       s.relationCount AS relationCount, s.createdAt AS createdAt
			ORDER BY s.step`
		records, err := tx.Run(ctx, cypher, map[string]interface{}{"novelId": novelId})
		if err != nil {
			return nil, err
		}
		snapshots := make([]map[string]interface{}, 0)
		for records.Next(ctx) {
			record := records.Record()
			step := 0
			if v, ok := record.Get("step"); ok && v != nil {
				step = neo4jRepo.GetIntPropVal(v)
			}
			charCount := 0
			if v, ok := record.Get("characterCount"); ok && v != nil {
				charCount = neo4jRepo.GetIntPropVal(v)
			}
			relCount := 0
			if v, ok := record.Get("relationCount"); ok && v != nil {
				relCount = neo4jRepo.GetIntPropVal(v)
			}
			createdAt := ""
			if v, ok := record.Get("createdAt"); ok && v != nil {
				if s, ok := v.(string); ok {
					createdAt = s
				}
			}
			snapshots = append(snapshots, map[string]interface{}{
				"step":           step,
				"characterCount": charCount,
				"relationCount":  relCount,
				"createdAt":      createdAt,
			})
		}
		return snapshots, nil
	})
	if err != nil {
		return nil, err
	}
	if result == nil {
		return []map[string]interface{}{}, nil
	}
	return result.([]map[string]interface{}), nil
}

// GetSnapshot 获取某个步骤的快照
func (s *NovelService) GetSnapshot(ctx context.Context, novelId string, step int) (*SnapshotData, error) {
	// Neo4j 不可用时从文件系统读取
	if !neo4jRepo.IsAvailable() {
		fsSnap, err := neo4jRepo.FsLoadSnapshot(novelId, step)
		if err != nil {
			return nil, err
		}
		return &SnapshotData{
			Step:           fsSnap.Step,
			NovelId:        fsSnap.NovelId,
			Characters:     fsSnap.Characters,
			Relations:      fsSnap.Relations,
			Events:         fsSnap.Events,
			CharacterCount: fsSnap.CharacterCount,
			RelationCount:  fsSnap.RelationCount,
			CreatedAt:      fsSnap.CreatedAt,
		}, nil
	}

	session := neo4jRepo.GetDriver().NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `
			MATCH (n:Novel {id: $novelId})-[:HAS_SNAPSHOT]->(s:Snapshot {step: $step})
			RETURN s`
		records, err := tx.Run(ctx, cypher, map[string]interface{}{"novelId": novelId, "step": step})
		if err != nil {
			return nil, err
		}
		if !records.Next(ctx) {
			return nil, nil
		}
		nodeVal, ok := records.Record().Get("s")
		if !ok {
			return nil, nil
		}
		node, ok := nodeVal.(neo4j.Node)
		if !ok {
			return nil, nil
		}
		props := node.Props

		// 解析角色数据（存储为 JSON 字符串）
		var characters []map[string]interface{}
		if v, ok := props["characters"]; ok && v != nil {
			if s, ok := v.(string); ok && s != "" {
				json.Unmarshal([]byte(s), &characters)
			}
		}

		// 解析关系数据（存储为 JSON 字符串）
		var relations []map[string]interface{}
		if v, ok := props["relations"]; ok && v != nil {
			if s, ok := v.(string); ok && s != "" {
				json.Unmarshal([]byte(s), &relations)
			}
		}

		// 解析事件数据（存储为 JSON 字符串）
		var events []map[string]interface{}
		if v, ok := props["events"]; ok && v != nil {
			if s, ok := v.(string); ok && s != "" {
				json.Unmarshal([]byte(s), &events)
			}
		}

		snapshot := &SnapshotData{
			Step:           neo4jRepo.GetIntPropVal(props["step"]),
			NovelId:        neo4jRepo.GetStringProp(props["novelId"]),
			Characters:     characters,
			Relations:      relations,
			Events:         events,
			CharacterCount: neo4jRepo.GetIntPropVal(props["characterCount"]),
			RelationCount:  neo4jRepo.GetIntPropVal(props["relationCount"]),
			CreatedAt:      neo4jRepo.GetStringProp(props["createdAt"]),
		}
		return snapshot, nil
	})
	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, fmt.Errorf("快照不存在: 步骤 %d", step)
	}
	return result.(*SnapshotData), nil
}

// GetSnapshotDiff 获取快照差异
func (s *NovelService) GetSnapshotDiff(ctx context.Context, novelId string, step int) (map[string]interface{}, error) {
	// 获取当前步骤和上一步骤的快照
	current, err := s.GetSnapshot(ctx, novelId, step)
	if err != nil {
		return nil, err
	}

	var previous *SnapshotData
	if step > 1 {
		previous, _ = s.GetSnapshot(ctx, novelId, step-1)
	}

	diff := map[string]interface{}{
		"step":    step,
		"current": current,
	}

	if previous != nil {
		// 计算新增角色
		prevCharNames := make(map[string]bool)
		for _, c := range previous.Characters {
			if name, ok := c["name"].(string); ok {
				prevCharNames[name] = true
			}
		}
		var addedChars []map[string]interface{}
		for _, c := range current.Characters {
			if name, ok := c["name"].(string); ok {
				if !prevCharNames[name] {
					addedChars = append(addedChars, c)
				}
			}
		}

		// 计算新增关系
		prevRelKeys := make(map[string]bool)
		for _, r := range previous.Relations {
			key := fmt.Sprintf("%v->%v:%v", r["sourceName"], r["targetName"], r["relationType"])
			prevRelKeys[key] = true
		}
		var addedRels []map[string]interface{}
		for _, r := range current.Relations {
			key := fmt.Sprintf("%v->%v:%v", r["sourceName"], r["targetName"], r["relationType"])
			if !prevRelKeys[key] {
				addedRels = append(addedRels, r)
			}
		}

		diff["previous"] = previous
		diff["addedCharacters"] = addedChars
		diff["addedRelations"] = addedRels
		diff["characterDelta"] = current.CharacterCount - previous.CharacterCount
		diff["relationDelta"] = current.RelationCount - previous.RelationCount
	} else {
		diff["previous"] = nil
		diff["addedCharacters"] = current.Characters
		diff["addedRelations"] = current.Relations
		diff["characterDelta"] = current.CharacterCount
		diff["relationDelta"] = current.RelationCount
	}

	return diff, nil
}

// SaveSnapshot 保存快照到 Neo4j
func (s *NovelService) SaveSnapshot(ctx context.Context, novelId string, step int) error {
	// 获取当前角色和关系数据
	characters, err := s.characterRepo.FindByNovelId(ctx, novelId)
	if err != nil {
		return fmt.Errorf("获取角色数据失败: %w", err)
	}

	relations, err := s.relationRepo.FindByNovelId(ctx, novelId)
	if err != nil {
		return fmt.Errorf("获取关系数据失败: %w", err)
	}

	events, err := s.eventRepo.FindByNovelId(ctx, novelId)
	if err != nil {
		slog.Warn("获取事件数据失败", "novelId", novelId, "error", err)
	}

	// 转换角色为 map 列表
	charMaps := make([]map[string]interface{}, 0, len(characters))
	for _, c := range characters {
		charMaps = append(charMaps, map[string]interface{}{
			"id":       c.ID,
			"name":     c.Name,
			"aliases":  c.Aliases,
			"gender":   c.Gender,
			"faction":  c.Faction,
			"identity": c.Identity,
		})
	}

	// 转换关系为 map 列表
	relMaps := make([]map[string]interface{}, 0, len(relations))
	for _, r := range relations {
		relMaps = append(relMaps, map[string]interface{}{
			"id":           r.ID,
			"sourceId":     r.SourceID,
			"targetId":     r.TargetID,
			"relationType": r.RelationType,
			"strength":     r.Strength,
		})
	}

	// 转换事件为 map 列表
	eventMaps := make([]map[string]interface{}, 0)
	if events != nil {
		for _, e := range events {
			eventMaps = append(eventMaps, map[string]interface{}{
				"id":        e.ID,
				"name":      e.Name,
				"chapter":   e.Chapter,
				"summary":   e.Summary,
				"eventType": e.EventType,
			})
		}
	}

	// 序列化为 JSON 字符串存储（Neo4j 不支持直接存储 Map 列表属性）
	charMapsJSON, err := json.Marshal(charMaps)
	if err != nil {
		return fmt.Errorf("序列化角色数据失败: %w", err)
	}
	relMapsJSON, err := json.Marshal(relMaps)
	if err != nil {
		return fmt.Errorf("序列化关系数据失败: %w", err)
	}
	eventMapsJSON, err := json.Marshal(eventMaps)
	if err != nil {
		return fmt.Errorf("序列化事件数据失败: %w", err)
	}

	// 保存到 Neo4j 或文件系统
	if !neo4jRepo.IsAvailable() {
		// 文件系统后备
		fsSnap := &neo4jRepo.FSSnapshot{
			Step:           step,
			NovelId:        novelId,
			Characters:     charMaps,
			Relations:      relMaps,
			Events:         eventMaps,
			CharacterCount: len(characters),
			RelationCount:  len(relations),
			CreatedAt:      time.Now().Format(time.RFC3339),
		}
		if err := neo4jRepo.FsSaveSnapshot(fsSnap); err != nil {
			return fmt.Errorf("保存快照到文件系统失败: %w", err)
		}
		slog.Info("快照保存成功（文件系统）", "novelId", novelId, "step", step, "characters", len(characters), "relations", len(relations))
		return nil
	}

	session := neo4jRepo.GetDriver().NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	_, err = session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `
			MATCH (n:Novel {id: $novelId})
			MERGE (n)-[:HAS_SNAPSHOT]->(s:Snapshot {step: $step, novelId: $novelId})
			SET s.characters = $characters,
			    s.relations = $relations,
			    s.events = $events,
			    s.characterCount = $characterCount,
			    s.relationCount = $relationCount,
			    s.createdAt = $createdAt
			RETURN s`
		_, err := tx.Run(ctx, cypher, map[string]interface{}{
			"novelId":        novelId,
			"step":           step,
			"characters":     string(charMapsJSON),
			"relations":      string(relMapsJSON),
			"events":         string(eventMapsJSON),
			"characterCount": len(characters),
			"relationCount":  len(relations),
			"createdAt":      time.Now().Format(time.RFC3339),
		})
		return nil, err
	})
	if err != nil {
		return fmt.Errorf("保存快照失败: %w", err)
	}

	slog.Info("快照保存成功", "novelId", novelId, "step", step, "characters", len(characters), "relations", len(relations))
	return nil
}

// ========== 任务状态 ==========

// GetTaskStatus 获取任务状态
func (s *NovelService) GetTaskStatus(ctx context.Context, novelId string) (map[string]interface{}, error) {
	// 从 Redis 获取任务信息
	taskInfo, err := s.taskRepo.GetTaskByNovelID(ctx, novelId)
	if err != nil || taskInfo == nil {
		// 没有任务，检查小说状态
		novel, err := s.novelRepo.FindByID(ctx, novelId)
		if err != nil || novel == nil {
			return nil, fmt.Errorf("小说不存在")
		}
		return map[string]interface{}{
			"status":      "idle",
			"progress":    0,
			"currentStep": novel.CurrentStep,
			"totalSteps":  novel.TotalSteps,
			"message":     "无构建任务",
		}, nil
	}

	return map[string]interface{}{
		"status":      string(taskInfo.Status),
		"progress":    taskInfo.Progress,
		"currentStep": 0,
		"totalSteps":  0,
		"message":     taskInfo.Message,
		"taskId":      taskInfo.ID,
	}, nil
}

// ========== 续建 ==========

// ContinueCheck 续建检查
func (s *NovelService) ContinueCheck(ctx context.Context, novelId string) (map[string]interface{}, error) {
	novel, err := s.novelRepo.FindByID(ctx, novelId)
	if err != nil || novel == nil {
		return nil, fmt.Errorf("小说不存在")
	}

	// 检查是否有图谱数据
	charCount, relCount := s.GetGraphStats(ctx, novelId)

	return map[string]interface{}{
		"canContinue":    charCount > 0,
		"novel":          novel,
		"currentStep":    novel.CurrentStep,
		"totalSteps":     novel.TotalSteps,
		"characterCount": charCount,
		"relationCount":  relCount,
	}, nil
}

// ContinueUpload 续建上传
func (s *NovelService) ContinueUpload(ctx context.Context, novelId string, content []byte, fileName string) error {
	// 检查小说是否存在
	novel, err := s.novelRepo.FindByID(ctx, novelId)
	if err != nil || novel == nil {
		return fmt.Errorf("小说不存在")
	}

	// 追加内容到原文
	filePath := filepath.Join("/workspace/ai-novel-character-graph/server/output/novels", novelId, "original.txt")
	existing, err := os.ReadFile(filePath)
	if err != nil {
		// 如果原文不存在，直接写入
		if err := s.SaveNovelText(novelId, content); err != nil {
			return fmt.Errorf("保存续建原文失败: %w", err)
		}
	} else {
		// 追加到原文
		newContent := append(existing, []byte("\n\n")...)
		newContent = append(newContent, content...)
		if err := os.WriteFile(filePath, newContent, 0644); err != nil {
			return fmt.Errorf("追加续建原文失败: %w", err)
		}
	}

	// 解析并追加新章节
	if err := s.ParseAndSaveChapters(ctx, novelId, string(content), true); err != nil {
		slog.Warn("续建解析章节失败", "novelId", novelId, "error", err)
	}

	// 更新小说字数
	novel.TotalChars += len(content)
	novel.UpdatedAt = time.Now().Format(time.RFC3339)
	if err := s.novelRepo.Update(ctx, novel); err != nil {
		slog.Warn("更新小说字数失败", "novelId", novelId, "error", err)
	}

	slog.Info("续建上传成功", "novelId", novelId, "fileName", fileName, "addedChars", len(content))
	return nil
}

// ContinuePaste 续建粘贴
func (s *NovelService) ContinuePaste(ctx context.Context, novelId string, text string) error {
	// 检查小说是否存在
	novel, err := s.novelRepo.FindByID(ctx, novelId)
	if err != nil || novel == nil {
		return fmt.Errorf("小说不存在")
	}

	// 追加内容到原文
	filePath := filepath.Join("/workspace/ai-novel-character-graph/server/output/novels", novelId, "original.txt")
	existing, err := os.ReadFile(filePath)
	if err != nil {
		if err := s.SaveNovelText(novelId, []byte(text)); err != nil {
			return fmt.Errorf("保存续建原文失败: %w", err)
		}
	} else {
		newContent := append(existing, []byte("\n\n")...)
		newContent = append(newContent, []byte(text)...)
		if err := os.WriteFile(filePath, newContent, 0644); err != nil {
			return fmt.Errorf("追加续建原文失败: %w", err)
		}
	}

	// 解析并追加新章节
	if err := s.ParseAndSaveChapters(ctx, novelId, text, true); err != nil {
		slog.Warn("续建解析章节失败", "novelId", novelId, "error", err)
	}

	// 更新小说字数
	novel.TotalChars += len(text)
	novel.UpdatedAt = time.Now().Format(time.RFC3339)
	if err := s.novelRepo.Update(ctx, novel); err != nil {
		slog.Warn("更新小说字数失败", "novelId", novelId, "error", err)
	}

	slog.Info("续建粘贴成功", "novelId", novelId, "addedChars", len(text))
	return nil
}

// ========== 费用估算 ==========

// CostEstimate 费用估算
func (s *NovelService) CostEstimate(ctx context.Context, novelId string) (map[string]interface{}, error) {
	novel, err := s.novelRepo.FindByID(ctx, novelId)
	if err != nil || novel == nil {
		return nil, fmt.Errorf("小说不存在")
	}

	// 基于字数估算 token 数和费用
	totalChars := novel.TotalChars
	if totalChars == 0 {
		totalChars = novel.TotalTokens * 2
	}

	// 粗略估算：中文 1 字 ≈ 1.5 token
	estimatedTokens := int(float64(totalChars) * 1.5)
	// 构建需要多次调用 AI（提取、消歧、合并等），约 3 倍 token 消耗
	totalEstimatedTokens := estimatedTokens * 3
	// 假设 GPT-4 价格：输入 $0.03/1K tokens，输出 $0.06/1K tokens
	inputCost := float64(estimatedTokens*2) / 1000 * 0.03
	outputCost := float64(estimatedTokens) / 1000 * 0.06
	totalCost := inputCost + outputCost

	return map[string]interface{}{
		"novelId":               novelId,
		"totalChars":            totalChars,
		"estimatedTokens":       estimatedTokens,
		"totalEstimatedTokens":  totalEstimatedTokens,
		"estimatedCost":         fmt.Sprintf("%.4f", totalCost),
		"currency":              "USD",
		"steps":                 novel.TotalSteps,
	}, nil
}

// ========== 回滚 ==========

// Rollback 回滚到某个步骤
func (s *NovelService) Rollback(ctx context.Context, novelId string, step int) error {
	// 获取目标步骤的快照
	snapshot, err := s.GetSnapshot(ctx, novelId, step)
	if err != nil {
		return fmt.Errorf("获取快照失败: %w", err)
	}

	// Neo4j 不可用时使用文件系统操作
	if !neo4jRepo.IsAvailable() {
		// 清除当前构建数据（文件系统）
		neo4jRepo.FsCleanBuildData(novelId)

		// 从快照恢复角色
		for _, charMap := range snapshot.Characters {
			character := &model.Character{
				ID:       getMapStr(charMap, "id"),
				NovelID:  novelId,
				Name:     getMapStr(charMap, "name"),
				Aliases:  getMapStrSlice(charMap, "aliases"),
				Gender:   getMapStr(charMap, "gender"),
				Faction:  getMapStr(charMap, "faction"),
				Identity: getMapStr(charMap, "identity"),
			}
			if character.ID == "" {
				character.ID = uuid.New().String()
			}
			if err := s.characterRepo.Create(ctx, character); err != nil {
				slog.Warn("回滚恢复角色失败", "name", character.Name, "error", err)
			}
		}

		// 从快照恢复关系
		for _, relMap := range snapshot.Relations {
			relation := &model.Relation{
				ID:           getMapStr(relMap, "id"),
				SourceID:     getMapStr(relMap, "sourceId"),
				TargetID:     getMapStr(relMap, "targetId"),
				RelationType: getMapStr(relMap, "relationType"),
				Strength:     getMapFloat(relMap, "strength"),
			}
			if relation.ID == "" {
				relation.ID = uuid.New().String()
			}
			s.relationRepo.CreateWithNovelId(ctx, novelId, relation)
		}

		// 从快照恢复事件
		for _, eventMap := range snapshot.Events {
			event := &model.Event{
				ID:        getMapStr(eventMap, "id"),
				NovelID:   novelId,
				Name:      getMapStr(eventMap, "name"),
				Chapter:   getMapInt(eventMap, "chapter"),
				Summary:   getMapStr(eventMap, "summary"),
				EventType: getMapStr(eventMap, "eventType"),
			}
			if event.ID == "" {
				event.ID = uuid.New().String()
			}
			if err := s.eventRepo.Create(ctx, event); err != nil {
				slog.Warn("回滚恢复事件失败", "name", event.Name, "error", err)
			}
		}

		// 重新保存该步骤的快照（因为 FsCleanBuildData 删除了所有快照）
		fsSnap := &neo4jRepo.FSSnapshot{
			Step:           snapshot.Step,
			NovelId:        novelId,
			Characters:     snapshot.Characters,
			Relations:      snapshot.Relations,
			Events:         snapshot.Events,
			CharacterCount: snapshot.CharacterCount,
			RelationCount:  snapshot.RelationCount,
			CreatedAt:      snapshot.CreatedAt,
		}
		neo4jRepo.FsSaveSnapshot(fsSnap)

		// 更新小说步数
		novel, _ := s.novelRepo.FindByID(ctx, novelId)
		if novel != nil {
			novel.CurrentStep = step
			novel.UpdatedAt = time.Now().Format(time.RFC3339)
			s.novelRepo.Update(ctx, novel)
		}

		slog.Info("回滚成功（文件系统）", "novelId", novelId, "step", step)
		return nil
	}

	// Neo4j 可用时的回滚逻辑
	// 清除当前构建数据
	session := neo4jRepo.GetDriver().NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	_, err = session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		// 删除小说下的所有事件和角色（及关系）
		cypher := `
			MATCH (n:Novel {id: $novelId})
			OPTIONAL MATCH (n)-[:HAS_EVENT]->(e:Event)
			OPTIONAL MATCH (n)-[:HAS_CHARACTER]->(c:Character)
			OPTIONAL MATCH (c)-[r:RELATES_TO]->()
			DETACH DELETE e, c`
		_, err := tx.Run(ctx, cypher, map[string]interface{}{"novelId": novelId})
		return nil, err
	})
	if err != nil {
		return fmt.Errorf("清除构建数据失败: %w", err)
	}

	// 从快照恢复角色
	for _, charMap := range snapshot.Characters {
		character := &model.Character{
			ID:       getMapStr(charMap, "id"),
			NovelID:  novelId,
			Name:     getMapStr(charMap, "name"),
			Aliases:  getMapStrSlice(charMap, "aliases"),
			Gender:   getMapStr(charMap, "gender"),
			Faction:  getMapStr(charMap, "faction"),
			Identity: getMapStr(charMap, "identity"),
		}
		if character.ID == "" {
			character.ID = uuid.New().String()
		}
		if err := s.characterRepo.Create(ctx, character); err != nil {
			slog.Warn("回滚恢复角色失败", "name", character.Name, "error", err)
		}
	}

	// 从快照恢复关系
	for _, relMap := range snapshot.Relations {
		relation := &model.Relation{
			ID:           getMapStr(relMap, "id"),
			SourceID:     getMapStr(relMap, "sourceId"),
			TargetID:     getMapStr(relMap, "targetId"),
			RelationType: getMapStr(relMap, "relationType"),
			Strength:     getMapFloat(relMap, "strength"),
		}
		if relation.ID == "" {
			relation.ID = uuid.New().String()
		}
		if err := s.relationRepo.Create(ctx, relation); err != nil {
			slog.Warn("回滚恢复关系失败", "error", err)
		}
	}

	// 从快照恢复事件
	for _, eventMap := range snapshot.Events {
		event := &model.Event{
			ID:        getMapStr(eventMap, "id"),
			NovelID:   novelId,
			Name:      getMapStr(eventMap, "name"),
			Chapter:   getMapInt(eventMap, "chapter"),
			Summary:   getMapStr(eventMap, "summary"),
			EventType: getMapStr(eventMap, "eventType"),
		}
		if event.ID == "" {
			event.ID = uuid.New().String()
		}
		if err := s.eventRepo.Create(ctx, event); err != nil {
			slog.Warn("回滚恢复事件失败", "name", event.Name, "error", err)
		}
	}

	// 更新小说步数
	novel, _ := s.novelRepo.FindByID(ctx, novelId)
	if novel != nil {
		novel.CurrentStep = step
		novel.UpdatedAt = time.Now().Format(time.RFC3339)
		s.novelRepo.Update(ctx, novel)
	}

	// 删除该步骤之后的快照
	_, err = session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		cypher := `
			MATCH (n:Novel {id: $novelId})-[:HAS_SNAPSHOT]->(s:Snapshot)
			WHERE s.step > $step
			DETACH DELETE s`
		_, err := tx.Run(ctx, cypher, map[string]interface{}{"novelId": novelId, "step": step})
		return nil, err
	})
	if err != nil {
		slog.Warn("删除后续快照失败", "novelId", novelId, "step", step, "error", err)
	}

	slog.Info("回滚成功", "novelId", novelId, "step", step)
	return nil
}

// ========== 角色冲突 ==========

// CharacterConflict 角色冲突
type CharacterConflict struct {
	Type       string                   `json:"type"`
	Characters []map[string]interface{} `json:"characters"`
}

// GetCharacterConflicts 获取角色冲突列表
func (s *NovelService) GetCharacterConflicts(ctx context.Context, novelId string) ([]CharacterConflict, error) {
	characters, err := s.characterRepo.FindByNovelId(ctx, novelId)
	if err != nil {
		return nil, err
	}

	var conflicts []CharacterConflict

	// 检查同名角色
	nameMap := make(map[string][]*model.Character)
	for _, c := range characters {
		nameMap[c.Name] = append(nameMap[c.Name], c)
	}
	for _, chars := range nameMap {
		if len(chars) > 1 {
			conflictChars := make([]map[string]interface{}, 0, len(chars))
			for _, c := range chars {
				conflictChars = append(conflictChars, map[string]interface{}{
					"id":       c.ID,
					"name":     c.Name,
					"aliases":  c.Aliases,
					"identity": c.Identity,
					"faction":  c.Faction,
				})
			}
			conflicts = append(conflicts, CharacterConflict{
				Type:       "duplicate_name",
				Characters: conflictChars,
			})
		}
	}

	// 检查别名重叠
	aliasMap := make(map[string][]*model.Character)
	for _, c := range characters {
		for _, alias := range c.Aliases {
			aliasMap[alias] = append(aliasMap[alias], c)
		}
		// 角色名本身也可以作为别名被其他角色引用
		aliasMap[c.Name] = append(aliasMap[c.Name], c)
	}
	for _, chars := range aliasMap {
		if len(chars) > 1 {
			// 别名被多个角色使用
			conflictChars := make([]map[string]interface{}, 0, len(chars))
			for _, c := range chars {
				conflictChars = append(conflictChars, map[string]interface{}{
					"id":       c.ID,
					"name":     c.Name,
					"aliases":  c.Aliases,
					"identity": c.Identity,
					"faction":  c.Faction,
				})
			}
			conflicts = append(conflicts, CharacterConflict{
				Type:       "alias_overlap",
				Characters: conflictChars,
			})
		}
	}

	if conflicts == nil {
		conflicts = []CharacterConflict{}
	}
	return conflicts, nil
}

// ========== 辅助函数 ==========

// getMapStr 从 map 中获取字符串
func getMapStr(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok && v != nil {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// getMapInt 从 map 中获取整数
func getMapInt(m map[string]interface{}, key string) int {
	if v, ok := m[key]; ok && v != nil {
		switch val := v.(type) {
		case int64:
			return int(val)
		case int:
			return val
		case float64:
			return int(val)
		}
	}
	return 0
}

// getMapFloat 从 map 中获取浮点数
func getMapFloat(m map[string]interface{}, key string) float64 {
	if v, ok := m[key]; ok && v != nil {
		if f, ok := v.(float64); ok {
			return f
		}
	}
	return 0
}

// getMapStrSlice 从 map 中获取字符串切片
func getMapStrSlice(m map[string]interface{}, key string) []string {
	if v, ok := m[key]; ok && v != nil {
		if arr, ok := v.([]interface{}); ok {
			result := make([]string, 0, len(arr))
			for _, item := range arr {
				if s, ok := item.(string); ok {
					result = append(result, s)
				}
			}
			return result
		}
	}
	return nil
}
