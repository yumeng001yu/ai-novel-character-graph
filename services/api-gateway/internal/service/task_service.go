package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/neo4j/neo4j-go-driver/v5/neo4j"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/model"
	neo4jRepo "github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/repository/neo4j"
	redisRepo "github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/repository/redis"
)

// BuildPhase 构建阶段
type BuildPhase string

const (
	PhaseExtracting        BuildPhase = "extracting"
	PhaseDisambiguating    BuildPhase = "disambiguating"
	PhaseMerging           BuildPhase = "merging"
	PhaseConflictDetecting BuildPhase = "conflict_detecting"
	PhaseVectorIndexing    BuildPhase = "vector_indexing"
	PhaseSnapshotSaving    BuildPhase = "snapshot_saving"
	PhaseProfileEnrichment BuildPhase = "profile_enrichment"
	PhaseCompleted         BuildPhase = "completed"
)

// StepProgress 步骤进度
type StepProgress struct {
	StepNumber int        `json:"stepNumber"`
	Phase      BuildPhase `json:"phase"`
	Message    string     `json:"message"`
}

// ExtractionResult AI 提取结果
type ExtractionResult struct {
	Characters []ExtractedCharacter `json:"characters"`
	Relations  []ExtractedRelation  `json:"relations"`
	Events     []ExtractedEvent     `json:"events"`
}

// ExtractedCharacter 提取的角色
type ExtractedCharacter struct {
	Name        string   `json:"name"`
	Aliases     []string `json:"aliases"`
	Gender      string   `json:"gender"`
	Faction     string   `json:"faction"`
	Identity    string   `json:"identity"`
	Description string   `json:"description"`
}

// ExtractedRelation 提取的关系
type ExtractedRelation struct {
	SourceName     string  `json:"sourceName"`
	TargetName     string  `json:"targetName"`
	RelationType   string  `json:"relationType"`
	Description    string  `json:"description"`
	IsInference    bool    `json:"isInference"`
	InferenceBasis string  `json:"inferenceBasis"`
	Confidence     float64 `json:"confidence"`
	Importance     int     `json:"importance"`
}

// ExtractedEvent 提取的事件
type ExtractedEvent struct {
	Name             string   `json:"name"`
	Chapter          int      `json:"chapter"`
	Summary          string   `json:"summary"`
	EventType        string   `json:"eventType"`
	ParticipantNames []string `json:"participantNames"`
}

// BuildStep 构建步骤
type BuildStep struct {
	ChapterRange string
	StartChapter int
	EndChapter   int
}

// TaskService 构建任务服务
type TaskService struct {
	neo4jDriver   neo4j.DriverWithContext
	redisService  *redisRepo.CacheRepo
	taskRepo      *redisRepo.TaskQueueRepo
	aiProxy       *AIProxyService
	novelRepo     *neo4jRepo.NovelRepo
	characterRepo *neo4jRepo.CharacterRepo
	relationRepo  *neo4jRepo.RelationRepo
	eventRepo     *neo4jRepo.EventRepo
}

// NewTaskService 创建任务服务
func NewTaskService(driver neo4j.DriverWithContext, redis *redisRepo.CacheRepo, aiProxy *AIProxyService) *TaskService {
	return &TaskService{
		neo4jDriver:   driver,
		redisService:  redis,
		taskRepo:      redisRepo.NewTaskQueueRepo(),
		aiProxy:       aiProxy,
		novelRepo:     neo4jRepo.NewNovelRepo(),
		characterRepo: neo4jRepo.NewCharacterRepo(),
		relationRepo:  neo4jRepo.NewRelationRepo(),
		eventRepo:     neo4jRepo.NewEventRepo(),
	}
}

// StartBuild 启动构建任务
func (s *TaskService) StartBuild(ctx context.Context, novelId string) (*redisRepo.TaskInfo, error) {
	// 检查是否已有运行中的任务
	existing, err := s.taskRepo.GetTaskByNovelID(ctx, novelId)
	if err != nil {
		slog.Warn("检查现有任务失败", "novelId", novelId, "error", err)
	}
	if existing != nil && (existing.Status == redisRepo.TaskStatusPending || existing.Status == redisRepo.TaskStatusRunning) {
		return nil, fmt.Errorf("小说 %s 已有正在处理的任务", novelId)
	}

	// 创建新任务
	task, err := s.taskRepo.Enqueue(ctx, novelId, "build_graph")
	if err != nil {
		return nil, fmt.Errorf("创建构建任务失败: %w", err)
	}

	// 异步执行构建
	go s.executeBuild(novelId, task.ID)

	slog.Info("图谱构建任务已启动", "novelId", novelId, "taskId", task.ID)
	return task, nil
}

// GetProgress 获取构建进度
func (s *TaskService) GetProgress(ctx context.Context, novelId string) (*StepProgress, error) {
	data, err := s.redisService.Get(ctx, fmt.Sprintf("progress:%s", novelId))
	if err != nil || data == "" {
		return nil, nil
	}
	var progress StepProgress
	if err := json.Unmarshal([]byte(data), &progress); err != nil {
		return nil, err
	}
	return &progress, nil
}

// CancelBuild 取消构建
func (s *TaskService) CancelBuild(ctx context.Context, novelId string) error {
	// 设置取消标记
	s.redisService.Set(ctx, fmt.Sprintf("task:%s:cancel", novelId), "1", 0)

	task, err := s.taskRepo.GetTaskByNovelID(ctx, novelId)
	if err != nil || task == nil {
		return nil
	}

	switch task.Status {
	case redisRepo.TaskStatusPending:
		s.taskRepo.MarkFailed(ctx, task.ID, "任务已取消")
	case redisRepo.TaskStatusRunning:
		s.taskRepo.MarkRunningAsInterrupted(ctx, task.ID)
	}

	slog.Info("构建任务已取消", "novelId", novelId)
	return nil
}

// GetTaskInfo 获取任务信息
func (s *TaskService) GetTaskInfo(ctx context.Context, novelId string) (*redisRepo.TaskInfo, error) {
	return s.taskRepo.GetTaskByNovelID(ctx, novelId)
}

// executeBuild 执行构建
func (s *TaskService) executeBuild(novelId string, taskId string) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("构建任务 panic", "novelId", novelId, "error", r)
			s.taskRepo.MarkFailed(context.Background(), taskId, fmt.Sprintf("构建异常: %v", r))
		}
	}()

	ctx := context.Background()

	// 标记任务为运行中
	s.taskRepo.MarkRunning(ctx, taskId)

	// 1. 获取小说和章节信息
	novel, chapters, err := s.getNovelAndChapters(ctx, novelId)
	if err != nil {
		slog.Error("获取小说信息失败", "novelId", novelId, "error", err)
		s.taskRepo.MarkFailed(ctx, taskId, fmt.Sprintf("获取小说信息失败: %v", err))
		return
	}

	// 2. 步规划：根据上下文窗口大小分步
	steps := s.planSteps(chapters, novel.ContextSize)
	totalSteps := len(steps)

	slog.Info("开始构建", "novelId", novelId, "totalSteps", totalSteps)

	// 3. 清除旧构建数据
	s.cleanBuildData(ctx, novelId)

	// 4. 逐步构建
	for i, step := range steps {
		// 检查是否取消
		cancelFlag, _ := s.redisService.Get(ctx, fmt.Sprintf("task:%s:cancel", novelId))
		if cancelFlag == "1" {
			s.taskRepo.MarkFailed(ctx, taskId, "任务已取消")
			s.redisService.Delete(ctx, fmt.Sprintf("task:%s:cancel", novelId))
			return
		}

		// 更新进度：提取
		s.setProgress(ctx, novelId, i+1, PhaseExtracting, fmt.Sprintf("正在提取第%d/%d步的人物关系（%s）...", i+1, totalSteps, step.ChapterRange))
		s.taskRepo.UpdateProgress(ctx, taskId, (i+1)*100/totalSteps/2, fmt.Sprintf("提取步骤 %d/%d", i+1, totalSteps))

		// 获取步骤文本
		stepText := s.getStepText(novel, chapters, step)
		if stepText == "" {
			continue
		}

		// 获取已有角色名
		existingNames := s.getExistingCharacterNames(ctx, novelId)

		// 生成图谱摘要（非第一步）
		var graphSummary string
		if i > 0 {
			graphSummary = s.generateGraphSummary(ctx, novelId)
		}

		// 调用 Python AI Service 提取
		extraction, err := s.callExtractAPI(ctx, stepText, step.ChapterRange, existingNames, graphSummary)
		if err != nil {
			slog.Error("AI 提取失败", "step", i+1, "error", err)
			continue
		}

		slog.Info("提取完成", "step", i+1, "characters", len(extraction.Characters), "relations", len(extraction.Relations), "events", len(extraction.Events))

		// 更新进度：合并
		s.setProgress(ctx, novelId, i+1, PhaseMerging, "正在合并图谱数据...")

		// 合并到 Neo4j
		s.mergeExtraction(ctx, novelId, extraction, i+1)

		// 更新进度：向量索引
		s.setProgress(ctx, novelId, i+1, PhaseVectorIndexing, "正在更新向量索引...")

		// 向量索引（调用 Python AI Service）
		s.indexToVector(ctx, novelId, extraction, stepText, step.ChapterRange, i+1)

		// 更新进度：快照保存
		s.setProgress(ctx, novelId, i+1, PhaseSnapshotSaving, fmt.Sprintf("步骤 %d/%d 完成", i+1, totalSteps))

		// 保存快照
		novelSvc := NewNovelService()
		if err := novelSvc.SaveSnapshot(ctx, novelId, i+1); err != nil {
			slog.Warn("保存快照失败", "novelId", novelId, "step", i+1, "error", err)
		}

		// 更新小说步数
		s.updateNovelStep(ctx, novelId, i+1, totalSteps)

		slog.Info("步骤完成", "step", i+1, "totalSteps", totalSteps)
	}

	// 5. 主角识别
	s.setProgress(ctx, novelId, totalSteps, PhaseProfileEnrichment, "正在识别主角...")
	s.detectProtagonists(ctx, novelId)

	// 6. 完成
	s.setProgress(ctx, novelId, totalSteps, PhaseCompleted, "构建完成")
	s.taskRepo.MarkCompleted(ctx, taskId)
	s.updateNovelStep(ctx, novelId, totalSteps, totalSteps)

	slog.Info("构建完成", "novelId", novelId)
}

// getNovelAndChapters 从 Neo4j 获取小说和章节
func (s *TaskService) getNovelAndChapters(ctx context.Context, novelId string) (*model.Novel, []*Chapter, error) {
	novel, err := s.novelRepo.FindByID(ctx, novelId)
	if err != nil {
		return nil, nil, fmt.Errorf("查询小说失败: %w", err)
	}
	if novel == nil {
		return nil, nil, fmt.Errorf("小说不存在: %s", novelId)
	}

	chapters, err := s.getChapters(ctx, novelId)
	if err != nil {
		return nil, nil, fmt.Errorf("查询章节失败: %w", err)
	}

	return novel, chapters, nil
}

// Chapter 章节模型（内部使用）
type Chapter struct {
	ID        string `json:"id"`
	NovelID   string `json:"novelId"`
	Number    int    `json:"number"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	CharCount int    `json:"charCount"`
}

// getChapters 获取章节列表（使用仓库层，支持文件系统后备）
func (s *TaskService) getChapters(ctx context.Context, novelId string) ([]*Chapter, error) {
	// 使用 chapterRepo 而非直接驱动，支持文件系统后备
	chRepo := neo4jRepo.NewChapterRepo()
	dbChapters, err := chRepo.FindByNovelId(ctx, novelId)
	if err != nil {
		return nil, err
	}

	chapters := make([]*Chapter, 0, len(dbChapters))
	for _, dc := range dbChapters {
		chapter := &Chapter{
			ID:        dc.ID,
			NovelID:   dc.NovelId,
			Number:    dc.Index,
			Title:     dc.Title,
			Content:   "",
			CharCount: dc.CharCount,
		}
		chapters = append(chapters, chapter)
	}
	return chapters, nil
}

// planSteps 根据上下文窗口分步
func (s *TaskService) planSteps(chapters []*Chapter, contextSize int) []BuildStep {
	if len(chapters) == 0 {
		return nil
	}

	// 默认上下文窗口大小（字符数，约等于 token 数 * 2）
	if contextSize <= 0 {
		contextSize = 100000
	}

	var steps []BuildStep
	var currentStepChapters []*Chapter
	currentSize := 0

	for _, ch := range chapters {
		chSize := ch.CharCount
		if chSize == 0 {
			chSize = len(ch.Content)
		}
		if currentSize+chSize > contextSize && len(currentStepChapters) > 0 {
			// 当前步骤已满，创建步骤
			steps = append(steps, BuildStep{
				ChapterRange: fmt.Sprintf("第%d-%d章", currentStepChapters[0].Number, currentStepChapters[len(currentStepChapters)-1].Number),
				StartChapter: currentStepChapters[0].Number,
				EndChapter:   currentStepChapters[len(currentStepChapters)-1].Number,
			})
			currentStepChapters = nil
			currentSize = 0
		}
		currentStepChapters = append(currentStepChapters, ch)
		currentSize += chSize
	}

	// 处理剩余章节
	if len(currentStepChapters) > 0 {
		steps = append(steps, BuildStep{
			ChapterRange: fmt.Sprintf("第%d-%d章", currentStepChapters[0].Number, currentStepChapters[len(currentStepChapters)-1].Number),
			StartChapter: currentStepChapters[0].Number,
			EndChapter:   currentStepChapters[len(currentStepChapters)-1].Number,
		})
	}

	return steps
}

// cleanBuildData 清除旧构建数据
func (s *TaskService) cleanBuildData(ctx context.Context, novelId string) {
	// Neo4j 不可用时清除文件系统数据
	if !neo4jRepo.IsAvailable() {
		neo4jRepo.FsCleanBuildData(novelId)
		return
	}

	session := s.neo4jDriver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		// 删除小说下的所有事件、角色和关系
		cypher := `
			MATCH (n:Novel {id: $novelId})
			OPTIONAL MATCH (n)-[:HAS_EVENT]->(e:Event)
			OPTIONAL MATCH (n)-[:HAS_CHARACTER]->(c:Character)
			OPTIONAL MATCH (c)-[r:RELATES_TO]->()
			DETACH DELETE e, c
			RETURN count(c) AS deleted`
		_, err := tx.Run(ctx, cypher, map[string]interface{}{"novelId": novelId})
		return nil, err
	})
	if err != nil {
		slog.Warn("清除旧构建数据失败", "novelId", novelId, "error", err)
	}
}

// getStepText 获取步骤文本
func (s *TaskService) getStepText(novel *model.Novel, chapters []*Chapter, step BuildStep) string {
	// 尝试从文件读取原文
	novelDir := fmt.Sprintf("/workspace/ai-novel-character-graph/server/output/novels/%s", novel.ID)
	fullText, err := os.ReadFile(filepath.Join(novelDir, "original.txt"))
	if err != nil {
		slog.Warn("读取原文文件失败，使用章节内容", "novelId", novel.ID, "error", err)
		// 回退：使用章节 Content 字段
		var sb strings.Builder
		for _, ch := range chapters {
			if ch.Number >= step.StartChapter && ch.Number <= step.EndChapter {
				sb.WriteString(fmt.Sprintf("【第%d章 %s】\n", ch.Number, ch.Title))
				sb.WriteString(ch.Content)
				sb.WriteString("\n\n")
			}
		}
		return sb.String()
	}

	// 从原文中按章节偏移量截取
	text := string(fullText)
	var sb strings.Builder
	for _, ch := range chapters {
		if ch.Number >= step.StartChapter && ch.Number <= step.EndChapter {
			sb.WriteString(fmt.Sprintf("【%s】\n", ch.Title))
			// 如果有 startOffset 信息，可以从原文截取
			// 否则使用全文
			_ = text
			// 简化处理：直接使用全文（因为章节偏移量可能不准确）
		}
	}

	// 如果只有一步（所有章节），直接返回全文
	if step.StartChapter == 1 && step.EndChapter == len(chapters) {
		return text
	}

	// 否则返回全文（后续可优化为按章节截取）
	return text
}

// getExistingCharacterNames 获取已有角色名
func (s *TaskService) getExistingCharacterNames(ctx context.Context, novelId string) []string {
	characters, err := s.characterRepo.FindByNovelId(ctx, novelId)
	if err != nil {
		return nil
	}
	names := make([]string, 0, len(characters))
	for _, c := range characters {
		names = append(names, c.Name)
		names = append(names, c.Aliases...)
	}
	return names
}

// generateGraphSummary 生成图谱摘要
func (s *TaskService) generateGraphSummary(ctx context.Context, novelId string) string {
	characters, err := s.characterRepo.FindByNovelId(ctx, novelId)
	if err != nil || len(characters) == 0 {
		return ""
	}

	relations, err := s.relationRepo.FindByNovelId(ctx, novelId)
	if err != nil {
		relations = nil
	}

	var sb strings.Builder
	sb.WriteString("已有角色：\n")
	for _, c := range characters {
		sb.WriteString(fmt.Sprintf("- %s（%s，%s）\n", c.Name, c.Gender, c.Identity))
	}

	if len(relations) > 0 {
		sb.WriteString("\n已有关系：\n")
		for _, r := range relations {
			sb.WriteString(fmt.Sprintf("- %s → %s：%s\n", r.SourceID, r.TargetID, r.RelationType))
		}
	}

	return sb.String()
}

// callExtractAPI 调用 Python AI 提取端点
func (s *TaskService) callExtractAPI(ctx context.Context, text string, chapterRange string, existingNames []string, graphSummary string) (*ExtractionResult, error) {
	if s.aiProxy == nil {
		return nil, fmt.Errorf("AI 代理服务未初始化")
	}

	requestBody := map[string]interface{}{
		"text":          text,
		"chapterRange":  chapterRange,
		"existingNames": existingNames,
		"graphSummary":  graphSummary,
	}

	resp, err := s.aiProxy.ProxyExtract(ctx, requestBody)
	if err != nil {
		return nil, fmt.Errorf("调用 AI 提取服务失败: %w", err)
	}

	// 解析响应
	data, ok := resp["data"]
	if !ok {
		// 尝试直接解析整个响应
		data = resp
	}

	jsonBytes, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("序列化提取结果失败: %w", err)
	}

	var extraction ExtractionResult
	if err := json.Unmarshal(jsonBytes, &extraction); err != nil {
		return nil, fmt.Errorf("解析提取结果失败: %w", err)
	}

	return &extraction, nil
}

// mergeExtraction 合并提取结果到 Neo4j
func (s *TaskService) mergeExtraction(ctx context.Context, novelId string, extraction *ExtractionResult, stepNumber int) {
	// 合并角色
	nameToId := make(map[string]string)
	for _, ec := range extraction.Characters {
		charId := uuid.New().String()

		character := &model.Character{
			ID:                  charId,
			NovelID:             novelId,
			Name:                ec.Name,
			Aliases:             ec.Aliases,
			Gender:              ec.Gender,
			Faction:             ec.Faction,
			Identity:            ec.Identity,
			DisambiguationStatus: "pending",
		}

		if err := s.characterRepo.Create(ctx, character); err != nil {
			slog.Warn("创建角色失败", "name", ec.Name, "error", err)
			// 尝试查找已有角色
			existing, _ := s.findCharacterByName(ctx, novelId, ec.Name)
			if existing != nil {
				nameToId[ec.Name] = existing.ID
				// 合并别名
				for _, alias := range ec.Aliases {
					if !contains(existing.Aliases, alias) {
						existing.Aliases = append(existing.Aliases, alias)
					}
				}
				s.characterRepo.Update(ctx, existing)
			}
			continue
		}
		nameToId[ec.Name] = charId

		// 别名映射
		for _, alias := range ec.Aliases {
			nameToId[alias] = charId
		}
	}

	// 合并关系
	for _, er := range extraction.Relations {
		sourceId, ok := nameToId[er.SourceName]
		if !ok {
			slog.Warn("关系源角色未找到", "name", er.SourceName)
			continue
		}
		targetId, ok := nameToId[er.TargetName]
		if !ok {
			slog.Warn("关系目标角色未找到", "name", er.TargetName)
			continue
		}

		relation := &model.Relation{
			ID:             uuid.New().String(),
			SourceID:       sourceId,
			TargetID:       targetId,
			RelationType:   er.RelationType,
			SinceChapter:   stepNumber,
			Strength:       er.Confidence,
			IsInference:    er.IsInference,
			InferenceBasis: er.InferenceBasis,
		}

		if err := s.relationRepo.CreateWithNovelId(ctx, novelId, relation); err != nil {
			slog.Warn("创建关系失败", "source", er.SourceName, "target", er.TargetName, "error", err)
		}
	}

	// 合并事件
	for _, ee := range extraction.Events {
		event := &model.Event{
			ID:        uuid.New().String(),
			NovelID:   novelId,
			Name:      ee.Name,
			Chapter:   ee.Chapter,
			Summary:   ee.Summary,
			EventType: ee.EventType,
		}

		if err := s.eventRepo.Create(ctx, event); err != nil {
			slog.Warn("创建事件失败", "name", ee.Name, "error", err)
		}

		// 创建事件与角色的关联
		s.linkEventParticipants(ctx, event.ID, ee.ParticipantNames, nameToId)
	}
}

// findCharacterByName 根据名称查找角色
func (s *TaskService) findCharacterByName(ctx context.Context, novelId string, name string) (*model.Character, error) {
	characters, err := s.characterRepo.FindByNovelId(ctx, novelId)
	if err != nil {
		return nil, err
	}
	for _, c := range characters {
		if c.Name == name {
			return c, nil
		}
		for _, alias := range c.Aliases {
			if alias == name {
				return c, nil
			}
		}
	}
	return nil, nil
}

// linkEventParticipants 关联事件参与者
func (s *TaskService) linkEventParticipants(ctx context.Context, eventId string, participantNames []string, nameToId map[string]string) {
	// Neo4j 不可用时跳过（事件-角色关联关系在文件系统中不单独存储，
	// 事件本身已通过 fsAppendEvent 保存）
	if !neo4jRepo.IsAvailable() {
		return
	}

	session := s.neo4jDriver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	for _, name := range participantNames {
		charId, ok := nameToId[name]
		if !ok {
			continue
		}
		_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
			cypher := `
				MATCH (e:Event {id: $eventId})
				MATCH (c:Character {id: $charId})
				MERGE (c)-[:PARTICIPATED_IN]->(e)`
			_, err := tx.Run(ctx, cypher, map[string]interface{}{
				"eventId": eventId,
				"charId":  charId,
			})
			return nil, err
		})
		if err != nil {
			slog.Warn("关联事件参与者失败", "eventId", eventId, "charId", charId, "error", err)
		}
	}
}

// indexToVector 向量索引
func (s *TaskService) indexToVector(ctx context.Context, novelId string, extraction *ExtractionResult, text string, chapterRange string, stepNumber int) {
	if s.aiProxy == nil {
		return
	}

	// 构建向量索引请求
	characterDescs := make([]map[string]interface{}, 0, len(extraction.Characters))
	for _, c := range extraction.Characters {
		characterDescs = append(characterDescs, map[string]interface{}{
			"name":        c.Name,
			"description": c.Description,
			"faction":     c.Faction,
			"identity":    c.Identity,
		})
	}

	relationDescs := make([]map[string]interface{}, 0, len(extraction.Relations))
	for _, r := range extraction.Relations {
		relationDescs = append(relationDescs, map[string]interface{}{
			"sourceName":   r.SourceName,
			"targetName":   r.TargetName,
			"relationType": r.RelationType,
			"description":  r.Description,
		})
	}

	requestBody := map[string]interface{}{
		"novelId":       novelId,
		"chapterRange":  chapterRange,
		"characters":    characterDescs,
		"relations":     relationDescs,
		"text":          text,
	}

	_, err := s.aiProxy.ProxyEmbedding(ctx, requestBody)
	if err != nil {
		slog.Warn("向量索引失败", "novelId", novelId, "step", stepNumber, "error", err)
	}
}

// detectProtagonists 主角识别
func (s *TaskService) detectProtagonists(ctx context.Context, novelId string) {
	characters, err := s.characterRepo.FindByNovelId(ctx, novelId)
	if err != nil || len(characters) == 0 {
		return
	}

	relations, err := s.relationRepo.FindByNovelId(ctx, novelId)
	if err != nil {
		relations = nil
	}

	// 统计每个角色的关系数量
	relationCount := make(map[string]int)
	for _, r := range relations {
		relationCount[r.SourceID]++
		relationCount[r.TargetID]++
	}

	// 找出关系最多的角色作为主角
	maxRelations := 0
	for _, c := range characters {
		count := relationCount[c.ID]
		if count > maxRelations {
			maxRelations = count
		}
	}

	// 标记关系数超过阈值的主角
	threshold := maxRelations / 2
	if threshold < 1 {
		threshold = 1
	}

	for _, c := range characters {
		isProtagonist := relationCount[c.ID] >= threshold
		if c.IsProtagonist != isProtagonist {
			c.IsProtagonist = isProtagonist
			if err := s.characterRepo.Update(ctx, c); err != nil {
				slog.Warn("更新主角标记失败", "characterId", c.ID, "error", err)
			}
		}
	}
}

// setProgress 设置进度
func (s *TaskService) setProgress(ctx context.Context, novelId string, stepNumber int, phase BuildPhase, message string) {
	progress := StepProgress{
		StepNumber: stepNumber,
		Phase:      phase,
		Message:    message,
	}
	data, err := json.Marshal(progress)
	if err != nil {
		slog.Warn("序列化进度失败", "error", err)
		return
	}
	s.redisService.Set(ctx, fmt.Sprintf("progress:%s", novelId), string(data), 24*time.Hour)
}

// updateNovelStep 更新小说步数
func (s *TaskService) updateNovelStep(ctx context.Context, novelId string, currentStep int, totalSteps int) {
	novel, err := s.novelRepo.FindByID(ctx, novelId)
	if err != nil || novel == nil {
		return
	}
	novel.CurrentStep = currentStep
	novel.UpdatedAt = time.Now().Format(time.RFC3339)
	if err := s.novelRepo.Update(ctx, novel); err != nil {
		slog.Warn("更新小说步数失败", "novelId", novelId, "error", err)
	}
}

// contains 检查字符串切片是否包含指定字符串
func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}
