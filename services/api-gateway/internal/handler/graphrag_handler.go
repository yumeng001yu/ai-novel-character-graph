package handler

import (
	"io"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/service"
)

// GraphRAGHandler GraphRAG 问答处理器
type GraphRAGHandler struct {
	aiProxyService *service.AIProxyService
}

// NewGraphRAGHandler 创建 GraphRAG 处理器实例
func NewGraphRAGHandler(aiProxyService *service.AIProxyService) *GraphRAGHandler {
	return &GraphRAGHandler{
		aiProxyService: aiProxyService,
	}
}

// Query GraphRAG 问答（SSE 流式代理到 Python AI Service）
// POST /graphrag/:novelId/query
func (h *GraphRAGHandler) Query(c *gin.Context) {
	novelId := c.Param("novelId")

	var req struct {
		Question string `json:"question"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	if req.Question == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "question 参数必填"})
		return
	}

	// 构建转发请求体
	reqBody := map[string]interface{}{
		"novel_id": novelId,
		"question": req.Question,
	}

	// SSE 流式代理到 AI 服务
	respBody, err := h.aiProxyService.ProxyGraphRAG(c.Request.Context(), novelId, reqBody)
	if err != nil {
		slog.Error("GraphRAG 问答代理失败", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "AI 服务请求失败"})
		return
	}
	defer respBody.Close()

	// 设置 SSE 响应头
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Transfer-Encoding", "chunked")

	// 流式转发响应
	c.Stream(func(w io.Writer) bool {
		buf := make([]byte, 1024)
		n, err := respBody.Read(buf)
		if err != nil {
			if err != io.EOF {
				slog.Warn("读取 GraphRAG 响应流失败", "error", err)
			}
			return false
		}
		if n > 0 {
			w.Write(buf[:n])
		}
		return true
	})
}

// GlobalQuery 全局 GraphRAG 问答（暂不支持）
// POST /graphrag/query
func (h *GraphRAGHandler) GlobalQuery(c *gin.Context) {
	c.JSON(http.StatusBadRequest, gin.H{
		"error": "全局 GraphRAG 问答暂不支持，请指定小说 ID 使用 /graphrag/:novelId/query",
	})
}
