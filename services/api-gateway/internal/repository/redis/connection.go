package redis

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/config"

	"github.com/redis/go-redis/v9"
)

var (
	client     *redis.Client
	clientOnce sync.Once
)

// InitClient 初始化 Redis 客户端（单例模式），启用 AOF 持久化
func InitClient(cfg config.RedisConfig) error {
	var initErr error
	clientOnce.Do(func() {
		client = redis.NewClient(&redis.Options{
			Addr:     fmt.Sprintf("%s:%s", cfg.Host, cfg.Port),
			Password: cfg.Password,
			DB:       0,
		})

		// 启用 AOF 持久化
		ctx := context.Background()
		err := client.ConfigSet(ctx, "appendonly", "yes").Err()
		if err != nil {
			slog.Warn("Redis AOF 持久化配置失败（可能无权限）", "error", err)
		}

		// 测试连接
		if err := client.Ping(ctx).Err(); err != nil {
			initErr = fmt.Errorf("Redis 连接测试失败: %w", err)
			slog.Error("Redis 连接失败", "error", err)
			return
		}
		slog.Info("Redis 连接成功", "addr", fmt.Sprintf("%s:%s", cfg.Host, cfg.Port))
	})
	return initErr
}

// GetClient 获取 Redis 客户端实例
func GetClient() *redis.Client {
	return client
}

// CloseClient 关闭 Redis 连接
func CloseClient() {
	if client != nil {
		if err := client.Close(); err != nil {
			slog.Error("Redis 连接关闭失败", "error", err)
		} else {
			slog.Info("Redis 连接已关闭")
		}
	}
}
