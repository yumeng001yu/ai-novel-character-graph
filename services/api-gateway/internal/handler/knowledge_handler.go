package handler

import (
	"io"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/service"
)

// KnowledgeHandler 知识库处理器
type KnowledgeHandler struct {
	aiProxyService *service.AIProxyService
	novelService   *service.NovelService
}

// NewKnowledgeHandler 创建知识库处理器实例
func NewKnowledgeHandler(aiProxyService *service.AIProxyService, novelService *service.NovelService) *KnowledgeHandler {
	return &KnowledgeHandler{
		aiProxyService: aiProxyService,
		novelService:   novelService,
	}
}

// List 获取知识库小说列表（带统计信息）
// GET /knowledge-base
func (h *KnowledgeHandler) List(c *gin.Context) {
	novels, err := h.novelService.List(c.Request.Context())
	if err != nil {
		slog.Error("获取知识库列表失败", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取知识库列表失败"})
		return
	}

	// 构建带统计信息的响应
	type NovelItem struct {
		ID             string `json:"id"`
		Name           string `json:"name"`
		TotalChars     int    `json:"totalChars"`
		TotalTokens    int    `json:"totalTokens"`
		GraphBuilt     bool   `json:"graphBuilt"`
		CharacterCount int    `json:"characterCount"`
		RelationCount  int    `json:"relationCount"`
		BuildStatus    string `json:"buildStatus"`
		CreatedAt      string `json:"createdAt"`
	}

	items := make([]NovelItem, 0, len(novels))
	for _, n := range novels {
		// 直接查询角色和关系统计
		charCount, relCount := h.novelService.GetGraphStats(c.Request.Context(), n.ID)

		buildStatus := "pending"
		if charCount > 0 {
			buildStatus = "completed"
		}

		items = append(items, NovelItem{
			ID:             n.ID,
			Name:           n.Name,
			TotalChars:     n.TotalChars,
			TotalTokens:    n.TotalTokens,
			GraphBuilt:     charCount > 0,
			CharacterCount: charCount,
			RelationCount:  relCount,
			BuildStatus:    buildStatus,
			CreatedAt:      n.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"novels": items})
}

// Search 搜索知识库
// GET /knowledge-base/search?q=
func (h *KnowledgeHandler) Search(c *gin.Context) {
	q := c.Query("q")
	if q == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "搜索关键词不能为空"})
		return
	}

	novels, err := h.novelService.List(c.Request.Context())
	if err != nil {
		slog.Error("搜索知识库失败", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "搜索知识库失败"})
		return
	}

	type NovelItem struct {
		ID             string `json:"id"`
		Name           string `json:"name"`
		GraphBuilt     bool   `json:"graphBuilt"`
		CharacterCount int    `json:"characterCount"`
		BuildStatus    string `json:"buildStatus"`
	}

	var results []NovelItem
	for _, n := range novels {
		nameMatch := contains(n.Name, q)

		// 搜索角色名
		characterMatch := false
		charCount, _ := h.novelService.GetGraphStats(c.Request.Context(), n.ID)
		if !nameMatch && charCount > 0 {
			// 用角色搜索接口
			characters, err := h.novelService.SearchCharacters(c.Request.Context(), n.ID, q)
			if err == nil && len(characters) > 0 {
				characterMatch = true
			}
		}

		if !nameMatch && !characterMatch {
			continue
		}

		buildStatus := "pending"
		if charCount > 0 {
			buildStatus = "completed"
		}

		results = append(results, NovelItem{
			ID:             n.ID,
			Name:           n.Name,
			GraphBuilt:     charCount > 0,
			CharacterCount: charCount,
			BuildStatus:    buildStatus,
		})
	}

	if results == nil {
		results = []NovelItem{}
	}
	c.JSON(http.StatusOK, gin.H{"novels": results})
}

// contains 模糊匹配（不区分大小写）
func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchSubstring(s, substr)
}

func searchSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// Question 知识库问答（GET 方式）
// GET /knowledge-base/:novelId/question?q=
func (h *KnowledgeHandler) Question(c *gin.Context) {
	novelId := c.Param("novelId")
	question := c.Query("q")

	if question == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "q 参数必填"})
		return
	}

	reqBody := map[string]interface{}{
		"novel_id": novelId,
		"question": question,
	}

	// SSE 流式代理
	respBody, err := h.aiProxyService.ProxyGraphRAG(c.Request.Context(), novelId, reqBody)
	if err != nil {
		slog.Error("知识库问答代理失败", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "AI 服务请求失败"})
		return
	}
	defer respBody.Close()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Transfer-Encoding", "chunked")

	c.Stream(func(w io.Writer) bool {
		buf := make([]byte, 1024)
		n, err := respBody.Read(buf)
		if err != nil {
			if err != io.EOF {
				slog.Warn("读取知识库问答响应流失败", "error", err)
			}
			return false
		}
		if n > 0 {
			w.Write(buf[:n])
		}
		return true
	})
}

// QuestionPost 知识库问答（POST 方式）
// POST /knowledge-base/:novelId/question
func (h *KnowledgeHandler) QuestionPost(c *gin.Context) {
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

	reqBody := map[string]interface{}{
		"novel_id": novelId,
		"question": req.Question,
	}

	// SSE 流式代理
	respBody, err := h.aiProxyService.ProxyGraphRAG(c.Request.Context(), novelId, reqBody)
	if err != nil {
		slog.Error("知识库问答代理失败", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "AI 服务请求失败"})
		return
	}
	defer respBody.Close()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Transfer-Encoding", "chunked")

	c.Stream(func(w io.Writer) bool {
		buf := make([]byte, 1024)
		n, err := respBody.Read(buf)
		if err != nil {
			if err != io.EOF {
				slog.Warn("读取知识库问答响应流失败", "error", err)
			}
			return false
		}
		if n > 0 {
			w.Write(buf[:n])
		}
		return true
	})
}
