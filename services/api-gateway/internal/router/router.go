package router

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/config"
	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/handler"
	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/middleware"
	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/service"
	neo4jRepo "github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/repository/neo4j"
	redisRepo "github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/repository/redis"
)

// SetupRouter 初始化并配置路由
func SetupRouter(cfg *config.Config) *gin.Engine {
	r := gin.New()

	// 应用全局中间件
	r.Use(middleware.Recovery())
	r.Use(middleware.Logger())
	r.Use(middleware.CORS(cfg))

	// 健康检查
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// 初始化服务
	aiProxyService := service.NewAIProxyService(cfg)
	taskService := service.NewTaskService(
		neo4jRepo.GetDriver(),
		redisRepo.NewCacheRepo(),
		aiProxyService,
	)

	// 初始化处理器
	novelHandler := handler.NewNovelHandler(taskService)
	novelService := service.NewNovelService()
	characterHandler := handler.NewCharacterHandler()
	graphHandler := handler.NewGraphHandler()
	chatHandler := handler.NewChatHandler(aiProxyService)
	knowledgeHandler := handler.NewKnowledgeHandler(aiProxyService, novelService)
	presetHandler := handler.NewPresetHandler()
	settingsHandler := handler.NewSettingsHandler(aiProxyService)
	graphragHandler := handler.NewGraphRAGHandler(aiProxyService)

	// API 路由组
	api := r.Group("/api")
	{
		// API 健康检查
		api.GET("/health", func(c *gin.Context) {
			c.JSON(200, gin.H{"status": "ok"})
		})

		// 小说相关路由
		novels := api.Group("/novels")
		{
			novels.POST("/upload", novelHandler.Upload)
			novels.POST("/text-paste", novelHandler.TextPaste)
			novels.GET("", novelHandler.List)
			novels.GET("/:id", novelHandler.Get)
			novels.DELETE("/:id", novelHandler.Delete)
			novels.GET("/:id/graph", novelHandler.GetGraph)
			novels.GET("/:id/events", novelHandler.GetEvents)
			novels.GET("/:id/export", novelHandler.Export)
			novels.POST("/:id/build", novelHandler.Build)
			novels.POST("/:id/build/cancel", novelHandler.CancelBuild)
			novels.GET("/:id/progress", novelHandler.GetProgress)
			// 原文查看
			novels.GET("/:id/text", novelHandler.GetText)
			novels.GET("/:id/chapters", novelHandler.GetChapters)
			// 快照
			novels.GET("/:id/snapshots", novelHandler.GetSnapshots)
			novels.GET("/:id/snapshots/:step", novelHandler.GetSnapshot)
			novels.GET("/:id/snapshots/:step/diff", novelHandler.GetSnapshotDiff)
			// 任务相关
			novels.GET("/:id/task", novelHandler.GetTask)
			novels.POST("/:id/cancel", novelHandler.Cancel)
			novels.POST("/:id/rollback", novelHandler.Rollback)
			novels.GET("/:id/cost-estimate", novelHandler.GetCostEstimate)
			// 续建
			novels.POST("/:id/continue/upload", novelHandler.ContinueUpload)
			novels.POST("/:id/continue/paste", novelHandler.ContinuePaste)
			novels.GET("/:id/continue/check", novelHandler.ContinueCheck)
		}

		// 角色相关路由
		characters := api.Group("/characters")
		{
			characters.GET("/:id", characterHandler.Get)
			characters.GET("/search", characterHandler.Search)
			characters.POST("/search", characterHandler.SearchPost)
			characters.GET("/:id/timeline", characterHandler.GetTimeline)
			characters.POST("/merge", characterHandler.Merge)
			characters.POST("/split", characterHandler.Split)
			characters.POST("/chat", chatHandler.Chat)
			// 角色冲突
			characters.GET("/conflicts", characterHandler.GetConflicts)
		}

		// 角色对话相关路由
		characterChat := api.Group("/character-chat")
		{
			characterChat.GET("/characters/:novelId", chatHandler.GetChatCharacters)
		}

		// 图谱相关路由
		graph := api.Group("/graph")
		{
			graph.GET("/nodes", graphHandler.GetNodes)
			graph.GET("/edges", graphHandler.GetEdges)
			graph.POST("/nodes", graphHandler.PostNodes)
			graph.POST("/edges", graphHandler.PostEdges)
		}

		// 知识库相关路由
		knowledgeBase := api.Group("/knowledge-base")
		{
			knowledgeBase.GET("", knowledgeHandler.List)
			knowledgeBase.GET("/search", knowledgeHandler.Search)
			knowledgeBase.GET("/:novelId/question", knowledgeHandler.Question)
			knowledgeBase.POST("/:novelId/question", knowledgeHandler.QuestionPost)
		}

		// GraphRAG 相关路由
		graphrag := api.Group("/graphrag")
		{
			graphrag.POST("/:novelId/query", graphragHandler.Query)
			graphrag.POST("/query", graphragHandler.GlobalQuery)
		}

		// 提示词预设相关路由
		presets := api.Group("/prompt-presets")
		{
			presets.GET("", presetHandler.List)
			presets.GET("/macros/list", presetHandler.ListMacros)
			presets.GET("/:id", presetHandler.Get)
			presets.POST("", presetHandler.Create)
			presets.PUT("/:id", presetHandler.Update)
			presets.DELETE("/:id", presetHandler.Delete)
			presets.POST("/:id/set-default", presetHandler.SetDefault)
		}

		// 设置相关路由
		settings := api.Group("/settings")
		{
			settings.GET("/ai", settingsHandler.GetAI)
			settings.PUT("/ai", settingsHandler.SaveAI)
			settings.POST("/ai/test", settingsHandler.TestAI)
			settings.POST("/ai/models", settingsHandler.GetModels)
			settings.GET("/build", settingsHandler.GetBuild)
			settings.PUT("/build", settingsHandler.SaveBuild)
			// Embedding 配置
			settings.GET("/embedding", settingsHandler.GetEmbedding)
			settings.PUT("/embedding", settingsHandler.SaveEmbedding)
			settings.POST("/embedding/test", settingsHandler.TestEmbedding)
			settings.POST("/embedding/models", settingsHandler.GetEmbeddingModels)
			// Reranker 配置
			settings.GET("/reranker", settingsHandler.GetReranker)
			settings.PUT("/reranker", settingsHandler.SaveReranker)
			settings.POST("/reranker/test", settingsHandler.TestReranker)
		}
	}

	// 前端静态文件服务
	staticDir := "./static"
	if _, err := os.Stat(staticDir); err == nil {
		// 服务 /novelgraph/ 下的静态资源
		r.Static("/novelgraph/assets", filepath.Join(staticDir, "assets"))
		r.StaticFile("/novelgraph/vite.svg", filepath.Join(staticDir, "vite.svg"))

		// /novelgraph/api 请求转发到 /api 路由
		r.Any("/novelgraph/api/*path", func(c *gin.Context) {
			path := c.Param("path")
			if len(path) == 0 || path[0] != '/' {
				path = "/" + path
			}
			c.Request.URL.Path = "/api" + path
			r.HandleContext(c)
		})

		// SPA 路由：所有 /novelgraph/* 非API、非静态资源路径返回 index.html
		r.NoRoute(func(c *gin.Context) {
			path := c.Request.URL.Path
			// 如果是 /novelgraph 下的路径（SPA前端路由），返回 index.html
			if strings.HasPrefix(path, "/novelgraph") {
				c.File(filepath.Join(staticDir, "index.html"))
				return
			}
			// 根路径重定向到 /novelgraph/
			if path == "/" {
				c.Redirect(http.StatusMovedPermanently, "/novelgraph/")
				return
			}
			c.JSON(http.StatusNotFound, gin.H{"error": "页面不存在"})
		})
	}

	return r
}
