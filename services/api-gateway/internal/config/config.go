package config

import (
	"os"
	"strings"
)

// Config 应用配置结构体
type Config struct {
	ServerPort string
	Neo4j      Neo4jConfig
	Redis      RedisConfig
	PostgreSQL PostgreSQLConfig
	AIService  AIServiceConfig
	CORS       CORSConfig
}

// Neo4jConfig Neo4j 数据库配置
type Neo4jConfig struct {
	URI      string
	Username string
	Password string
}

// RedisConfig Redis 配置
type RedisConfig struct {
	Host     string
	Port     string
	Password string
}

// PostgreSQLConfig PostgreSQL 配置
type PostgreSQLConfig struct {
	DSN string
}

// AIServiceConfig AI 服务配置
type AIServiceConfig struct {
	URL string
}

// CORSConfig CORS 跨域配置
type CORSConfig struct {
	AllowedOrigins []string
}

// Load 从环境变量加载配置
func Load() *Config {
	cfg := &Config{
		ServerPort: getEnv("SERVER_PORT", "8080"),
		Neo4j: Neo4jConfig{
			URI:      getEnv("NEO4J_URI", "bolt://localhost:7687"),
			Username: getEnv("NEO4J_USERNAME", "neo4j"),
			Password: getEnv("NEO4J_PASSWORD", ""),
		},
		Redis: RedisConfig{
			Host:     getEnv("REDIS_HOST", "localhost"),
			Port:     getEnv("REDIS_PORT", "6379"),
			Password: getEnv("REDIS_PASSWORD", ""),
		},
		PostgreSQL: PostgreSQLConfig{
			DSN: getEnv("POSTGRES_DSN", "postgres://user:password@localhost:5432/ai_novel?sslmode=disable"),
		},
		AIService: AIServiceConfig{
			URL: getEnv("AI_SERVICE_URL", "http://ai-service:8000"),
		},
		CORS: CORSConfig{
			AllowedOrigins: getEnvSlice("CORS_ALLOWED_ORIGINS", []string{"http://localhost:3000", "http://localhost:5173"}),
		},
	}
	return cfg
}

// getEnv 获取环境变量，不存在则返回默认值
func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}

// getEnvSlice 获取逗号分隔的环境变量切片
func getEnvSlice(key string, defaultValue []string) []string {
	if value, exists := os.LookupEnv(key); exists {
		parts := strings.Split(value, ",")
		result := make([]string, 0, len(parts))
		for _, part := range parts {
			trimmed := strings.TrimSpace(part)
			if trimmed != "" {
				result = append(result, trimmed)
			}
		}
		return result
	}
	return defaultValue
}
