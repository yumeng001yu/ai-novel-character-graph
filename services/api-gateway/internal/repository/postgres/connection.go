package postgres

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/config"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	pool     *pgxpool.Pool
	poolOnce sync.Once
)

// InitPool 初始化 PostgreSQL 连接池（单例模式）
func InitPool(ctx context.Context, cfg config.PostgreSQLConfig) error {
	var initErr error
	poolOnce.Do(func() {
		poolConfig, err := pgxpool.ParseConfig(cfg.DSN)
		if err != nil {
			initErr = fmt.Errorf("解析 PostgreSQL DSN 失败: %w", err)
			slog.Error("PostgreSQL DSN 解析失败", "error", err)
			return
		}

		// 连接池配置
		poolConfig.MaxConns = 20
		poolConfig.MinConns = 5

		p, err := pgxpool.NewWithConfig(ctx, poolConfig)
		if err != nil {
			initErr = fmt.Errorf("创建 PostgreSQL 连接池失败: %w", err)
			slog.Error("PostgreSQL 连接池创建失败", "error", err)
			return
		}

		// 测试连接
		if err := p.Ping(ctx); err != nil {
			initErr = fmt.Errorf("PostgreSQL 连接测试失败: %w", err)
			slog.Error("PostgreSQL 连接测试失败", "error", err)
			return
		}

		pool = p
		slog.Info("PostgreSQL 连接池初始化成功")
	})
	return initErr
}

// GetPool 获取 PostgreSQL 连接池实例
func GetPool() *pgxpool.Pool {
	return pool
}

// ClosePool 关闭 PostgreSQL 连接池
func ClosePool() {
	if pool != nil {
		pool.Close()
		slog.Info("PostgreSQL 连接池已关闭")
	}
}
