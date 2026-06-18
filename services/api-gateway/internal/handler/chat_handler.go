package handler

import (
	"io"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/service"
)

// ChatHandler 角色对话处理器
type ChatHandler struct {
	aiProxyService *service.AIProxyService
	characterService *service.CharacterService
}

// NewChatHandler 创建对话处理器实例
func NewChatHandler(aiProxyService *service.AIProxyService) *ChatHandler {
	return &ChatHandler{
		aiProxyService: aiProxyService,
		characterService: service.NewCharacterService(),
	}
}

// Chat 角色对话（SSE 流式代理到 Python AI Service）
// POST /characters/chat
func (h *ChatHandler) Chat(c *gin.Context) {
	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	// 字段名映射：前端驼峰 → Python 下划线
	if v, ok := req["characterIds"]; ok {
		req["character_ids"] = v
		delete(req, "characterIds")
	}
	if v, ok := req["novelId"]; ok {
		req["novel_id"] = v
		delete(req, "novelId")
	}
	if v, ok := req["presetId"]; ok {
		req["preset_id"] = v
		delete(req, "presetId")
	}

	// 转发到 AI 服务
	respBody, err := h.aiProxyService.ProxyChat(c.Request.Context(), req)
	if err != nil {
		slog.Error("AI 对话代理失败", "error", err)
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
				slog.Warn("读取 AI 响应流失败", "error", err)
			}
			return false
		}
		if n > 0 {
			w.Write(buf[:n])
		}
		return true
	})
}

// GetChatCharacters 获取角色对话的角色列表
// GET /character-chat/characters/:novelId
func (h *ChatHandler) GetChatCharacters(c *gin.Context) {
	novelId := c.Param("novelId")

	characters, err := h.characterService.ListByNovelId(c.Request.Context(), novelId)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取角色列表失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"characters": characters})
}
