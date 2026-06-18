package handler

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/model"
	redisRepo "github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/repository/redis"
	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/service"
)

// NovelHandler 小说处理器
type NovelHandler struct {
	novelService  *service.NovelService
	taskService   *service.TaskService
	exportService *service.ExportService
}

// NewNovelHandler 创建小说处理器实例
func NewNovelHandler(taskService *service.TaskService) *NovelHandler {
	return &NovelHandler{
		novelService:  service.NewNovelService(),
		taskService:   taskService,
		exportService: service.NewExportService(),
	}
}

// Upload 上传小说文件
// POST /novels/upload
func (h *NovelHandler) Upload(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未找到上传文件"})
		return
	}

	name := c.PostForm("name")
	if name == "" {
		name = file.Filename
	}

	// 读取 hasChapter 参数
	hasChapter := true
	if v := c.PostForm("hasChapter"); v != "" {
		hasChapter, _ = strconv.ParseBool(v)
	}

	// 读取文件内容
	src, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取文件失败"})
		return
	}
	defer src.Close()

	content, err := io.ReadAll(src)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取文件内容失败"})
		return
	}

	// 创建小说记录
	novel := &model.Novel{
		ID:          uuid.New().String(),
		Name:        name,
		TotalChars:  len(content),
		InputMode:   "upload",
		CurrentStep: 0,
		CreatedAt:   time.Now().Format(time.RFC3339),
		UpdatedAt:   time.Now().Format(time.RFC3339),
	}

	if err := h.novelService.Create(c.Request.Context(), novel); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建小说失败"})
		return
	}

	// 保存原文到文件
	if err := h.novelService.SaveNovelText(novel.ID, content); err != nil {
		slog.Warn("保存原文失败", "novelId", novel.ID, "error", err)
	}

	// 解析并保存章节
	if err := h.novelService.ParseAndSaveChapters(c.Request.Context(), novel.ID, string(content), hasChapter); err != nil {
		slog.Warn("解析章节失败", "novelId", novel.ID, "error", err)
	}

	// 更新小说的 TotalTokens 和 TotalSteps
	totalTokens := len(content) / 2
	totalSteps := 1
	if err := h.novelService.UpdateNovelSteps(c.Request.Context(), novel.ID, totalTokens, totalSteps); err != nil {
		slog.Warn("更新小说步数失败", "novelId", novel.ID, "error", err)
	}

	// 获取章节数量
	chapters, _ := h.novelService.GetChapterList(c.Request.Context(), novel.ID)
	chapterCount := 0
	if chapters != nil {
		chapterCount = len(chapters)
	}
	if chapterCount == 0 {
		chapterCount = totalSteps
	}

	c.JSON(http.StatusCreated, gin.H{
		"novel":    novel,
		"chapters": chapterCount,
		"steps":    totalSteps,
	})
}

// TextPaste 粘贴小说文本
// POST /novels/text-paste
func (h *NovelHandler) TextPaste(c *gin.Context) {
	var req struct {
		Name       string `json:"name"`
		Content    string `json:"content"`
		HasChapter bool   `json:"hasChapter"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	novel := &model.Novel{
		ID:          uuid.New().String(),
		Name:        req.Name,
		TotalChars:  len(req.Content),
		InputMode:   "paste",
		CurrentStep: 0,
		CreatedAt:   time.Now().Format(time.RFC3339),
		UpdatedAt:   time.Now().Format(time.RFC3339),
	}

	if err := h.novelService.Create(c.Request.Context(), novel); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建小说失败"})
		return
	}

	// 保存原文到文件
	if err := h.novelService.SaveNovelText(novel.ID, []byte(req.Content)); err != nil {
		slog.Warn("保存原文失败", "novelId", novel.ID, "error", err)
	}

	// 解析并保存章节
	if err := h.novelService.ParseAndSaveChapters(c.Request.Context(), novel.ID, req.Content, req.HasChapter); err != nil {
		slog.Warn("解析章节失败", "novelId", novel.ID, "error", err)
	}

	// 更新小说的 TotalTokens 和 TotalSteps
	totalTokens := len(req.Content) / 2
	totalSteps := 1
	if err := h.novelService.UpdateNovelSteps(c.Request.Context(), novel.ID, totalTokens, totalSteps); err != nil {
		slog.Warn("更新小说步数失败", "novelId", novel.ID, "error", err)
	}

	// 获取章节数量
	chaptersList, _ := h.novelService.GetChapterList(c.Request.Context(), novel.ID)
	chapterCount := 0
	if chaptersList != nil {
		chapterCount = len(chaptersList)
	}
	if chapterCount == 0 {
		chapterCount = totalSteps
	}

	c.JSON(http.StatusCreated, gin.H{
		"novel":    novel,
		"chapters": chapterCount,
		"steps":    totalSteps,
	})
}

// List 获取小说列表
// GET /novels
func (h *NovelHandler) List(c *gin.Context) {
	novels, err := h.novelService.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取小说列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"novels": novels})
}

// Get 获取小说详情
// GET /novels/:id
func (h *NovelHandler) Get(c *gin.Context) {
	id := c.Param("id")
	novel, err := h.novelService.Get(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"novel": novel})
}

// Delete 删除小说
// DELETE /novels/:id
func (h *NovelHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if err := h.novelService.Delete(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除小说失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

// GetGraph 获取小说图谱
// GET /novels/:id/graph
func (h *NovelHandler) GetGraph(c *gin.Context) {
	id := c.Param("id")
	graph, err := h.novelService.GetGraph(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取图谱失败"})
		return
	}
	c.JSON(http.StatusOK, graph)
}

// GetEvents 获取小说事件
// GET /novels/:id/events
func (h *NovelHandler) GetEvents(c *gin.Context) {
	id := c.Param("id")
	events, err := h.novelService.GetEvents(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取事件失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"events": events})
}

// Build 触发图谱构建
// POST /novels/:id/build
func (h *NovelHandler) Build(c *gin.Context) {
	id := c.Param("id")

	task, err := h.taskService.StartBuild(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusAccepted, gin.H{
		"taskId":  task.ID,
		"status":  task.Status,
		"message": "构建任务已启动",
	})
}

// CancelBuild 取消图谱构建
// POST /novels/:id/build/cancel
func (h *NovelHandler) CancelBuild(c *gin.Context) {
	id := c.Param("id")

	if err := h.taskService.CancelBuild(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "构建任务已取消"})
}

// Export 导出小说数据
// GET /novels/:id/export?format=json
func (h *NovelHandler) Export(c *gin.Context) {
	id := c.Param("id")
	format := c.DefaultQuery("format", "json")

	switch format {
	case "json":
		data, err := h.exportService.ExportJSON(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "导出失败"})
			return
		}
		c.Data(http.StatusOK, "application/json", data)

	case "graphml":
		data, err := h.exportService.ExportGraphML(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "导出失败"})
			return
		}
		c.Data(http.StatusOK, "application/xml", []byte(data))

	case "gexf":
		data, err := h.exportService.ExportGEXF(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "导出失败"})
			return
		}
		c.Data(http.StatusOK, "application/xml", []byte(data))

	case "csv":
		nodesCSV, edgesCSV, err := h.exportService.ExportCSV(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "导出失败"})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"nodes": nodesCSV,
			"edges": edgesCSV,
		})

	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("不支持的导出格式: %s", format)})
	}
}

// GetProgress 获取构建进度（SSE 流式）
// GET /novels/:id/progress
func (h *NovelHandler) GetProgress(c *gin.Context) {
	id := c.Param("id")

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")

	c.Stream(func(w io.Writer) bool {
		// 获取步骤进度
		stepProgress, err := h.taskService.GetProgress(c.Request.Context(), id)
		if err != nil {
			slog.Warn("获取进度失败", "novelId", id, "error", err)
		}

		// 获取任务信息
		taskInfo, err := h.taskService.GetTaskInfo(c.Request.Context(), id)
		if err != nil {
			slog.Warn("获取任务信息失败", "novelId", id, "error", err)
			return false
		}

		if taskInfo != nil {
			eventData := gin.H{
				"taskId":   taskInfo.ID,
				"status":   string(taskInfo.Status),
				"progress": taskInfo.Progress,
				"message":  taskInfo.Message,
			}
			if stepProgress != nil {
				eventData["stepNumber"] = stepProgress.StepNumber
				eventData["phase"] = string(stepProgress.Phase)
				eventData["stepMessage"] = stepProgress.Message
			}
			c.SSEvent("progress", eventData)
		}

		// 如果任务完成或失败，停止流式传输
		if taskInfo != nil && (taskInfo.Status == redisRepo.TaskStatusCompleted || taskInfo.Status == redisRepo.TaskStatusFailed || taskInfo.Status == redisRepo.TaskStatusInterrupted) {
			return false
		}

		// 等待一段时间再轮询
		time.Sleep(2 * time.Second)
		return true
	})
}

// taskID 安全获取任务 ID
func taskID(task *redisRepo.TaskInfo) string {
	if task == nil {
		return ""
	}
	return task.ID
}

// ========== 原文查看端点 ==========

// GetText 获取小说原文
// GET /novels/:id/text?chapter=N
func (h *NovelHandler) GetText(c *gin.Context) {
	novelId := c.Param("id")
	chapterStr := c.Query("chapter")

	chapterNum := 0
	if chapterStr != "" {
		var err error
		chapterNum, err = strconv.Atoi(chapterStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "chapter 参数必须是整数"})
			return
		}
	}

	result, err := h.novelService.GetNovelText(c.Request.Context(), novelId, chapterNum)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// GetChapters 获取章节列表
// GET /novels/:id/chapters
func (h *NovelHandler) GetChapters(c *gin.Context) {
	novelId := c.Param("id")

	chapters, err := h.novelService.GetChapterList(c.Request.Context(), novelId)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"chapters": chapters})
}

// ========== 快照端点 ==========

// GetSnapshots 获取快照列表
// GET /novels/:id/snapshots
func (h *NovelHandler) GetSnapshots(c *gin.Context) {
	novelId := c.Param("id")

	snapshots, err := h.novelService.GetSnapshots(c.Request.Context(), novelId)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取快照列表失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"snapshots": snapshots})
}

// GetSnapshot 获取某个步骤的快照
// GET /novels/:id/snapshots/:step
func (h *NovelHandler) GetSnapshot(c *gin.Context) {
	novelId := c.Param("id")
	stepStr := c.Param("step")

	step, err := strconv.Atoi(stepStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "step 参数必须是整数"})
		return
	}

	snapshot, err := h.novelService.GetSnapshot(c.Request.Context(), novelId, step)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"snapshot": snapshot})
}

// GetSnapshotDiff 获取快照差异
// GET /novels/:id/snapshots/:step/diff
func (h *NovelHandler) GetSnapshotDiff(c *gin.Context) {
	novelId := c.Param("id")
	stepStr := c.Param("step")

	step, err := strconv.Atoi(stepStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "step 参数必须是整数"})
		return
	}

	diff, err := h.novelService.GetSnapshotDiff(c.Request.Context(), novelId, step)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, diff)
}

// ========== 任务相关端点 ==========

// GetTask 获取任务状态
// GET /novels/:id/task
func (h *NovelHandler) GetTask(c *gin.Context) {
	novelId := c.Param("id")

	status, err := h.novelService.GetTaskStatus(c.Request.Context(), novelId)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, status)
}

// Cancel 取消构建（前端调用 /cancel 而非 /build/cancel）
// POST /novels/:id/cancel
func (h *NovelHandler) Cancel(c *gin.Context) {
	novelId := c.Param("id")

	if err := h.taskService.CancelBuild(c.Request.Context(), novelId); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "构建任务已取消"})
}

// Rollback 回滚到某个步骤
// POST /novels/:id/rollback
func (h *NovelHandler) Rollback(c *gin.Context) {
	novelId := c.Param("id")

	var req struct {
		Step int `json:"step"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效，需要 step 字段"})
		return
	}

	if req.Step <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "step 必须大于 0"})
		return
	}

	if err := h.novelService.Rollback(c.Request.Context(), novelId, req.Step); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("已回滚到步骤 %d", req.Step)})
}

// GetCostEstimate 费用估算
// GET /novels/:id/cost-estimate
func (h *NovelHandler) GetCostEstimate(c *gin.Context) {
	novelId := c.Param("id")

	estimate, err := h.novelService.CostEstimate(c.Request.Context(), novelId)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, estimate)
}

// ========== 续建端点 ==========

// ContinueUpload 续建上传
// POST /novels/:id/continue/upload
func (h *NovelHandler) ContinueUpload(c *gin.Context) {
	novelId := c.Param("id")

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未找到上传文件"})
		return
	}

	src, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取文件失败"})
		return
	}
	defer src.Close()

	content, err := io.ReadAll(src)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取文件内容失败"})
		return
	}

	if err := h.novelService.ContinueUpload(c.Request.Context(), novelId, content, file.Filename); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "续建上传成功", "addedChars": len(content)})
}

// ContinuePaste 续建粘贴
// POST /novels/:id/continue/paste
func (h *NovelHandler) ContinuePaste(c *gin.Context) {
	novelId := c.Param("id")

	var req struct {
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	if req.Content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "content 不能为空"})
		return
	}

	if err := h.novelService.ContinuePaste(c.Request.Context(), novelId, req.Content); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "续建粘贴成功", "addedChars": len(req.Content)})
}

// ContinueCheck 续建检查
// GET /novels/:id/continue/check
func (h *NovelHandler) ContinueCheck(c *gin.Context) {
	novelId := c.Param("id")

	result, err := h.novelService.ContinueCheck(c.Request.Context(), novelId)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}
