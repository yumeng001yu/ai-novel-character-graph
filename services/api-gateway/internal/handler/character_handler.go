package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/service"
)

// CharacterHandler 角色处理器
type CharacterHandler struct {
	characterService *service.CharacterService
}

// NewCharacterHandler 创建角色处理器实例
func NewCharacterHandler() *CharacterHandler {
	return &CharacterHandler{
		characterService: service.NewCharacterService(),
	}
}

// Get 获取角色详情
// GET /characters/:id
func (h *CharacterHandler) Get(c *gin.Context) {
	id := c.Param("id")
	character, err := h.characterService.Get(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"character": character})
}

// Search 搜索角色（GET 方式）
// GET /characters/search?novelId=&keyword=
func (h *CharacterHandler) Search(c *gin.Context) {
	novelId := c.Query("novelId")
	keyword := c.Query("keyword")

	if novelId == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "novelId 参数必填"})
		return
	}

	characters, err := h.characterService.Search(c.Request.Context(), novelId, keyword)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "搜索角色失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"characters": characters})
}

// SearchPost 搜索角色（POST 方式）
// POST /characters/search
func (h *CharacterHandler) SearchPost(c *gin.Context) {
	var req struct {
		NovelId string `json:"novelId"`
		Keyword string `json:"keyword"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	if req.NovelId == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "novelId 参数必填"})
		return
	}

	characters, err := h.characterService.Search(c.Request.Context(), req.NovelId, req.Keyword)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "搜索角色失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"characters": characters})
}

// GetTimeline 获取角色时间线
// GET /characters/:id/timeline
func (h *CharacterHandler) GetTimeline(c *gin.Context) {
	id := c.Param("id")
	timeline, err := h.characterService.GetTimeline(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, timeline)
}

// Merge 合并角色
// POST /characters/merge
func (h *CharacterHandler) Merge(c *gin.Context) {
	var req struct {
		TargetId  string   `json:"targetId"`
		SourceIds []string `json:"sourceIds"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	if req.TargetId == "" || len(req.SourceIds) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "targetId 和 sourceIds 参数必填"})
		return
	}

	character, err := h.characterService.Merge(c.Request.Context(), req.TargetId, req.SourceIds)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"character": character})
}

// Split 拆分角色
// POST /characters/split
func (h *CharacterHandler) Split(c *gin.Context) {
	var req struct {
		SourceId      string                   `json:"sourceId"`
		NewCharacters []map[string]interface{} `json:"newCharacters"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	if req.SourceId == "" || len(req.NewCharacters) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sourceId 和 newCharacters 参数必填"})
		return
	}

	characters, err := h.characterService.Split(c.Request.Context(), req.SourceId, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"characters": characters})
}

// GetConflicts 获取角色冲突列表
// GET /characters/conflicts?novelId=
func (h *CharacterHandler) GetConflicts(c *gin.Context) {
	novelId := c.Query("novelId")
	if novelId == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "novelId 参数必填"})
		return
	}

	// 使用 NovelService 的 GetCharacterConflicts 方法
	novelService := service.NewNovelService()
	conflicts, err := novelService.GetCharacterConflicts(c.Request.Context(), novelId)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取角色冲突失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"conflicts": conflicts})
}
