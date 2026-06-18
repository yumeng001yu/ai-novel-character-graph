package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/model"
	postgresRepo "github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/repository/postgres"
)

// PresetHandler 提示词预设处理器
type PresetHandler struct {
	presetRepo *postgresRepo.PresetRepo
}

// NewPresetHandler 创建预设处理器实例
func NewPresetHandler() *PresetHandler {
	return &PresetHandler{
		presetRepo: postgresRepo.NewPresetRepo(),
	}
}

// List 获取所有预设
// GET /prompt-presets
func (h *PresetHandler) List(c *gin.Context) {
	presets, err := h.presetRepo.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取预设列表失败"})
		return
	}
	if presets == nil {
		presets = []*model.PromptPreset{}
	}
	c.JSON(http.StatusOK, gin.H{"presets": presets})
}

// Get 获取预设详情
// GET /prompt-presets/:id
func (h *PresetHandler) Get(c *gin.Context) {
	id := c.Param("id")
	preset, err := h.presetRepo.FindByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取预设失败"})
		return
	}
	if preset == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "预设不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"preset": preset})
}

// Create 创建预设
// POST /prompt-presets
func (h *PresetHandler) Create(c *gin.Context) {
	var preset model.PromptPreset
	if err := c.ShouldBindJSON(&preset); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	if preset.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "预设名称不能为空"})
		return
	}

	if err := h.presetRepo.Create(c.Request.Context(), &preset); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建预设失败"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"preset": preset})
}

// Update 更新预设
// PUT /prompt-presets/:id
func (h *PresetHandler) Update(c *gin.Context) {
	id := c.Param("id")

	// 检查预设是否存在
	existing, err := h.presetRepo.FindByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询预设失败"})
		return
	}
	if existing == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "预设不存在"})
		return
	}

	var preset model.PromptPreset
	if err := c.ShouldBindJSON(&preset); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	preset.ID = id
	if err := h.presetRepo.Update(c.Request.Context(), &preset); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新预设失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"preset": preset})
}

// Delete 删除预设
// DELETE /prompt-presets/:id
func (h *PresetHandler) Delete(c *gin.Context) {
	id := c.Param("id")

	if err := h.presetRepo.Delete(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除预设失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

// SetDefault 设置默认预设
// POST /prompt-presets/:id/set-default
func (h *PresetHandler) SetDefault(c *gin.Context) {
	id := c.Param("id")

	// 检查预设是否存在
	existing, err := h.presetRepo.FindByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询预设失败"})
		return
	}
	if existing == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "预设不存在"})
		return
	}

	if err := h.presetRepo.SetDefault(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "设置默认预设失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "设置默认预设成功"})
}

// ListMacros 获取预设宏列表
// GET /prompt-presets/macros/list
func (h *PresetHandler) ListMacros(c *gin.Context) {
	// 返回可用的宏变量列表
	macros := []map[string]string{
		{"name": "{{character_name}}", "description": "角色名称"},
		{"name": "{{character_aliases}}", "description": "角色别名"},
		{"name": "{{character_gender}}", "description": "角色性别"},
		{"name": "{{character_faction}}", "description": "角色阵营"},
		{"name": "{{character_identity}}", "description": "角色身份"},
		{"name": "{{character_personality}}", "description": "角色性格"},
		{"name": "{{character_motivation}}", "description": "角色动机"},
		{"name": "{{novel_name}}", "description": "小说名称"},
		{"name": "{{novel_context}}", "description": "小说上下文"},
	}
	c.JSON(http.StatusOK, gin.H{"macros": macros})
}
