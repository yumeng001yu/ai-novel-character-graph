package handler

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/service"
)

// SettingsHandler 设置处理器
type SettingsHandler struct {
	aiProxyService  *service.AIProxyService
	settingsService *service.SettingsService
}

// NewSettingsHandler 创建设置处理器实例
func NewSettingsHandler(aiProxyService *service.AIProxyService) *SettingsHandler {
	return &SettingsHandler{
		aiProxyService:  aiProxyService,
		settingsService: service.NewSettingsService(),
	}
}

// GetAI 获取 AI 设置
// GET /settings/ai
func (h *SettingsHandler) GetAI(c *gin.Context) {
	config, err := h.settingsService.GetAIConfig(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取 AI 配置失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"settings": config})
}

// SaveAI 保存 AI 设置
// PUT /settings/ai
func (h *SettingsHandler) SaveAI(c *gin.Context) {
	var config service.AIConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	if err := h.settingsService.SaveAIConfig(c.Request.Context(), &config); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存 AI 配置失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "设置保存成功"})
}

// TestAI 测试 AI 连接
// POST /settings/ai/test
func (h *SettingsHandler) TestAI(c *gin.Context) {
	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	result, err := h.aiProxyService.ProxyTestConnection(c.Request.Context(), req)
	if err != nil {
		slog.Error("AI 连接测试失败", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "AI 连接测试失败", "detail": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// GetModels 获取 AI 模型列表
// POST /settings/ai/models
func (h *SettingsHandler) GetModels(c *gin.Context) {
	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	result, err := h.aiProxyService.ProxyGetModels(c.Request.Context(), req)
	if err != nil {
		slog.Error("获取模型列表失败", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取模型列表失败", "detail": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// GetBuild 获取构建设置
// GET /settings/build
func (h *SettingsHandler) GetBuild(c *gin.Context) {
	config, err := h.settingsService.GetBuildConfig(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取构建配置失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"settings": config})
}

// SaveBuild 保存构建设置
// PUT /settings/build
func (h *SettingsHandler) SaveBuild(c *gin.Context) {
	var config service.BuildConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	if err := h.settingsService.SaveBuildConfig(c.Request.Context(), &config); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存构建配置失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "设置保存成功"})
}

// ========== Embedding 配置端点 ==========

// GetEmbedding 获取 Embedding 配置
// GET /settings/embedding
func (h *SettingsHandler) GetEmbedding(c *gin.Context) {
	config, err := h.settingsService.GetEmbeddingConfig(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取 Embedding 配置失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"settings": config})
}

// SaveEmbedding 保存 Embedding 配置
// PUT /settings/embedding
func (h *SettingsHandler) SaveEmbedding(c *gin.Context) {
	var config service.EmbeddingConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	if err := h.settingsService.SaveEmbeddingConfig(c.Request.Context(), &config); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存 Embedding 配置失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Embedding 配置保存成功"})
}

// TestEmbedding 测试 Embedding 连接
// POST /settings/embedding/test
func (h *SettingsHandler) TestEmbedding(c *gin.Context) {
	var config service.EmbeddingConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	result, err := h.settingsService.TestEmbeddingConnection(c.Request.Context(), &config)
	if err != nil {
		slog.Error("Embedding 连接测试失败", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Embedding 连接测试失败", "detail": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// GetEmbeddingModels 获取 Embedding 模型列表
// POST /settings/embedding/models
func (h *SettingsHandler) GetEmbeddingModels(c *gin.Context) {
	models, err := h.settingsService.GetEmbeddingModels(c.Request.Context())
	if err != nil {
		slog.Error("获取 Embedding 模型列表失败", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取模型列表失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"models": models})
}

// ========== Reranker 配置端点 ==========

// GetReranker 获取 Reranker 配置
// GET /settings/reranker
func (h *SettingsHandler) GetReranker(c *gin.Context) {
	config, err := h.settingsService.GetRerankerConfig(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取 Reranker 配置失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"settings": config})
}

// SaveReranker 保存 Reranker 配置
// PUT /settings/reranker
func (h *SettingsHandler) SaveReranker(c *gin.Context) {
	var config service.RerankerConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	if err := h.settingsService.SaveRerankerConfig(c.Request.Context(), &config); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存 Reranker 配置失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Reranker 配置保存成功"})
}

// TestReranker 测试 Reranker 连接
// POST /settings/reranker/test
func (h *SettingsHandler) TestReranker(c *gin.Context) {
	var config service.RerankerConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	result, err := h.settingsService.TestRerankerConnection(c.Request.Context(), &config)
	if err != nil {
		slog.Error("Reranker 连接测试失败", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Reranker 连接测试失败", "detail": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}
