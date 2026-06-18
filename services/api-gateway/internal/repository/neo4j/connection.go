package neo4j

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/config"

	neo4jDriver "github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

var (
	driver         neo4jDriver.DriverWithContext
	driverOnce     sync.Once
	neo4jAvailable bool // Neo4j 是否可用（启动时检测）
	availableOnce  sync.Once
)

// InitDriver 初始化 Neo4j 驱动（单例模式）
func InitDriver(cfg config.Neo4jConfig) error {
	var initErr error
	driverOnce.Do(func() {
		d, err := neo4jDriver.NewDriverWithContext(cfg.URI, neo4jDriver.BasicAuth(cfg.Username, cfg.Password, ""))
		if err != nil {
			initErr = err
			slog.Error("Neo4j 驱动创建失败", "error", err)
			return
		}
		driver = d
		slog.Info("Neo4j 驱动初始化成功", "uri", cfg.URI)

		// 启动时检测 Neo4j 可用性（3 秒超时）
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		err = driver.VerifyConnectivity(ctx)
		if err != nil {
			neo4jAvailable = false
			slog.Warn("Neo4j 连接失败，系统将使用文件系统后备存储", "uri", cfg.URI, "error", err)
		} else {
			neo4jAvailable = true
			slog.Info("Neo4j 连接成功，系统将使用 Neo4j 存储", "uri", cfg.URI)
		}
	})
	return initErr
}

// IsAvailable 返回 Neo4j 是否可用
func IsAvailable() bool {
	return neo4jAvailable
}

// GetDriver 获取 Neo4j 驱动实例
func GetDriver() neo4jDriver.DriverWithContext {
	return driver
}

// CloseDriver 关闭 Neo4j 驱动连接
func CloseDriver() {
	if driver != nil {
		if err := driver.Close(context.Background()); err != nil {
			slog.Error("Neo4j 驱动关闭失败", "error", err)
		} else {
			slog.Info("Neo4j 驱动已关闭")
		}
	}
}

// NewSession 创建新的 Neo4j 会话（读写模式）
func NewSession(ctx context.Context) neo4jDriver.SessionWithContext {
	return driver.NewSession(ctx, neo4jDriver.SessionConfig{AccessMode: neo4jDriver.AccessModeWrite})
}

// NewReadSession 创建只读会话
func NewReadSession(ctx context.Context) neo4jDriver.SessionWithContext {
	return driver.NewSession(ctx, neo4jDriver.SessionConfig{AccessMode: neo4jDriver.AccessModeRead})
}
