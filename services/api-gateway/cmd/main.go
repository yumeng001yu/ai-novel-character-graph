package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/config"
	neo4jRepo "github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/repository/neo4j"
	redisRepo "github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/repository/redis"
	postgresRepo "github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/repository/postgres"
	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/router"
	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/service"
)

func main() {
	// 加载 .env 配置
	if err := godotenv.Load(); err != nil {
		slog.Warn("未找到 .env 文件，使用环境变量")
	}

	// 加载配置
	cfg := config.Load()

	// 初始化 Neo4j 连接
	if err := neo4jRepo.InitDriver(cfg.Neo4j); err != nil {
		slog.Error("Neo4j 初始化失败", "error", err)
		os.Exit(1)
	}
	defer neo4jRepo.CloseDriver()

	// 初始化 Redis 连接
	if err := redisRepo.InitClient(cfg.Redis); err != nil {
		slog.Error("Redis 初始化失败", "error", err)
		os.Exit(1)
	}
	defer redisRepo.CloseClient()

	// 初始化 PostgreSQL 连接
	ctx := context.Background()
	if err := postgresRepo.InitPool(ctx, cfg.PostgreSQL); err != nil {
		slog.Error("PostgreSQL 初始化失败", "error", err)
		os.Exit(1)
	}
	defer postgresRepo.ClosePool()

	// 确保预设表存在
	presetRepo := postgresRepo.NewPresetRepo()
	if err := presetRepo.EnsureTable(ctx); err != nil {
		slog.Warn("预设表初始化失败", "error", err)
	}

	// 确保设置表存在
	settingsService := service.NewSettingsService()
	if err := settingsService.EnsureSettingsTable(ctx); err != nil {
		slog.Warn("设置表初始化失败", "error", err)
	}

	// 初始化路由
	r := router.SetupRouter(cfg)

	// 创建 HTTP 服务器
	addr := fmt.Sprintf(":%s", cfg.ServerPort)
	srv := &http.Server{
		Addr:    addr,
		Handler: r,
	}

	// 启动服务器（在 goroutine 中）
	go func() {
		slog.Info("API Gateway 启动中...", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("服务器启动失败", "error", err)
			os.Exit(1)
		}
	}()

	slog.Info("API Gateway 已启动", "addr", addr)

	// 等待中断信号，优雅关闭
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("正在关闭服务器...")

	// 设置 5 秒超时上下文
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("服务器关闭失败", "error", err)
		os.Exit(1)
	}

	slog.Info("服务器已优雅关闭")
}
