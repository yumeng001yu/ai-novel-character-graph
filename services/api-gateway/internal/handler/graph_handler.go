package handler

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/service"
)

// GraphHandler 图谱处理器
type GraphHandler struct {
	graphService *service.GraphService
}

// NewGraphHandler 创建图谱处理器实例
func NewGraphHandler() *GraphHandler {
	return &GraphHandler{
		graphService: service.NewGraphService(),
	}
}

// GetNodes 获取图谱节点
// GET /graph/nodes?novelId=
func (h *GraphHandler) GetNodes(c *gin.Context) {
	novelId := c.Query("novelId")
	if novelId == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "novelId 参数必填"})
		return
	}

	nodes, err := h.graphService.GetNodes(c.Request.Context(), novelId)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取图谱节点失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"nodes": nodes})
}

// GetEdges 获取图谱边
// GET /graph/edges?novelId=
func (h *GraphHandler) GetEdges(c *gin.Context) {
	novelId := c.Query("novelId")
	if novelId == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "novelId 参数必填"})
		return
	}

	edges, err := h.graphService.GetEdges(c.Request.Context(), novelId)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取图谱边失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"edges": edges})
}

// PostNodes 批量创建图谱节点
// POST /graph/nodes
func (h *GraphHandler) PostNodes(c *gin.Context) {
	var req struct {
		NovelId   string                   `json:"novelId"`
		NodesData []map[string]interface{} `json:"nodesData"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	if req.NovelId == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "novelId 参数必填"})
		return
	}

	createdCount, err := h.graphService.CreateNodes(c.Request.Context(), req.NovelId, req.NodesData)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("创建节点失败: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "节点创建成功", "count": createdCount})
}

// PostEdges 批量创建图谱边
// POST /graph/edges
func (h *GraphHandler) PostEdges(c *gin.Context) {
	var req struct {
		NovelId   string                   `json:"novelId"`
		EdgesData []map[string]interface{} `json:"edgesData"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	if req.NovelId == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "novelId 参数必填"})
		return
	}

	createdCount, err := h.graphService.CreateEdges(c.Request.Context(), req.NovelId, req.EdgesData)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("创建边失败: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "边创建成功", "count": createdCount})
}
