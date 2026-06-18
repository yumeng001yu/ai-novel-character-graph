package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/repository/postgres"
)

// SettingsService 设置服务，管理 Embedding/Reranker 等配置
type SettingsService struct{}

// NewSettingsService 创建设置服务实例
func NewSettingsService() *SettingsService {
	return &SettingsService{}
}

// EmbeddingConfig Embedding 配置
type EmbeddingConfig struct {
	ApiUrl     string `json:"apiUrl"`
	ApiKey     string `json:"apiKey"`
	Model      string `json:"model"`
	Dimensions int    `json:"dimensions"`
}

// RerankerConfig Reranker 配置
type RerankerConfig struct {
	ApiUrl string `json:"apiUrl"`
	ApiKey string `json:"apiKey"`
	Model  string `json:"model"`
	TopN   int    `json:"topN"`
}

// AIConfig AI 配置
type AIConfig struct {
	Provider      string  `json:"provider"`
	ApiUrl        string  `json:"apiUrl"`
	ApiKey        string  `json:"apiKey"`
	Model         string  `json:"model"`
	Temperature   float64 `json:"temperature"`
	ContextSize   int     `json:"contextSize"`
}

// BuildConfig 构建配置
type BuildConfig struct {
	ChunkSize   int  `json:"chunkSize"`
	OverlapSize int  `json:"overlapSize"`
	MaxTokens   int  `json:"maxTokens"`
	AutoExtract bool `json:"autoExtract"`
}

// EnsureSettingsTable 确保设置表存在
func (s *SettingsService) EnsureSettingsTable(ctx context.Context) error {
	sql := `
		CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL DEFAULT '{}',
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`
	_, err := postgres.GetPool().Exec(ctx, sql)
	if err != nil {
		return fmt.Errorf("创建设置表失败: %w", err)
	}
	slog.Info("设置表确保完成")

	// 初始化默认配置：如果数据库中没有配置，从环境变量同步
	s.syncFromEnv(ctx)

	return nil
}

// syncFromEnv 从环境变量同步配置到数据库（仅在数据库无配置时）
func (s *SettingsService) syncFromEnv(ctx context.Context) {
	// 同步 AI 配置
	if _, err := s.getSetting(ctx, "ai"); err != nil {
		aiConfig := AIConfig{
			Provider:    "openai",
			ApiUrl:      getEnvOrDefault("AI_API_URL", "https://api.minimaxi.com/v1"),
			ApiKey:      getEnvOrDefault("AI_API_KEY", ""),
			Model:       getEnvOrDefault("AI_MODEL", "MiniMax-M2.7"),
			Temperature: 0.7,
			ContextSize: 200000,
		}
		data, _ := json.Marshal(aiConfig)
		s.saveSetting(ctx, "ai", string(data))
		slog.Info("从环境变量同步 AI 配置到数据库")
	}

	// 同步 Embedding 配置
	if _, err := s.getSetting(ctx, "embedding"); err != nil {
		embConfig := EmbeddingConfig{
			ApiUrl:     getEnvOrDefault("EMBEDDING_API_URL", "https://api.siliconflow.cn/v1"),
			ApiKey:     getEnvOrDefault("EMBEDDING_API_KEY", ""),
			Model:      getEnvOrDefault("EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-8B"),
			Dimensions: 4096,
		}
		if dimStr := getEnvOrDefault("EMBEDDING_DIMENSIONS", ""); dimStr != "" {
			var dim int
			fmt.Sscanf(dimStr, "%d", &dim)
			if dim > 0 {
				embConfig.Dimensions = dim
			}
		}
		data, _ := json.Marshal(embConfig)
		s.saveSetting(ctx, "embedding", string(data))
		slog.Info("从环境变量同步 Embedding 配置到数据库")
	}

	// 同步 Reranker 配置
	if _, err := s.getSetting(ctx, "reranker"); err != nil {
		rerankerConfig := RerankerConfig{
			ApiUrl: getEnvOrDefault("RERANKER_API_URL", "https://api.siliconflow.cn/v1"),
			ApiKey: getEnvOrDefault("RERANKER_API_KEY", ""),
			Model:  getEnvOrDefault("RERANKER_MODEL", "Qwen/Qwen3-Reranker-8B"),
			TopN:   3,
		}
		data, _ := json.Marshal(rerankerConfig)
		s.saveSetting(ctx, "reranker", string(data))
		slog.Info("从环境变量同步 Reranker 配置到数据库")
	}

	// 同步构建配置
	if _, err := s.getSetting(ctx, "build"); err != nil {
		buildConfig := BuildConfig{
			ChunkSize:   2000,
			OverlapSize: 200,
			MaxTokens:   4096,
			AutoExtract: true,
		}
		data, _ := json.Marshal(buildConfig)
		s.saveSetting(ctx, "build", string(data))
		slog.Info("初始化构建配置到数据库")
	}
}

// getEnvOrDefault 获取环境变量，不存在则返回默认值
func getEnvOrDefault(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists && value != "" {
		return value
	}
	return defaultValue
}

// GetAIConfig 获取 AI 配置
func (s *SettingsService) GetAIConfig(ctx context.Context) (*AIConfig, error) {
	value, err := s.getSetting(ctx, "ai")
	if err != nil {
		// 从环境变量回退
		return &AIConfig{
			Provider:    "openai",
			ApiUrl:      getEnvOrDefault("AI_API_URL", "https://api.minimaxi.com/v1"),
			ApiKey:      "****",
			Model:       getEnvOrDefault("AI_MODEL", "MiniMax-M2.7"),
			Temperature: 0.7,
			ContextSize: 200000,
		}, nil
	}

	var config AIConfig
	if err := json.Unmarshal([]byte(value), &config); err != nil {
		return nil, fmt.Errorf("解析 AI 配置失败: %w", err)
	}

	// 隐藏 API Key
	if config.ApiKey != "" {
		config.ApiKey = "****"
	}

	return &config, nil
}

// SaveAIConfig 保存 AI 配置
func (s *SettingsService) SaveAIConfig(ctx context.Context, config *AIConfig) error {
	if config.ApiKey == "****" {
		existing, err := s.getSetting(ctx, "ai")
		if err == nil && existing != "" {
			var oldConfig AIConfig
			if json.Unmarshal([]byte(existing), &oldConfig) == nil {
				config.ApiKey = oldConfig.ApiKey
			}
		}
	}

	data, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("序列化 AI 配置失败: %w", err)
	}

	return s.saveSetting(ctx, "ai", string(data))
}

// GetBuildConfig 获取构建配置
func (s *SettingsService) GetBuildConfig(ctx context.Context) (*BuildConfig, error) {
	value, err := s.getSetting(ctx, "build")
	if err != nil {
		return &BuildConfig{
			ChunkSize:   2000,
			OverlapSize: 200,
			MaxTokens:   4096,
			AutoExtract: true,
		}, nil
	}

	var config BuildConfig
	if err := json.Unmarshal([]byte(value), &config); err != nil {
		return nil, fmt.Errorf("解析构建配置失败: %w", err)
	}

	return &config, nil
}

// SaveBuildConfig 保存构建配置
func (s *SettingsService) SaveBuildConfig(ctx context.Context, config *BuildConfig) error {
	data, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("序列化构建配置失败: %w", err)
	}
	return s.saveSetting(ctx, "build", string(data))
}

// GetEmbeddingConfig 获取 Embedding 配置
func (s *SettingsService) GetEmbeddingConfig(ctx context.Context) (*EmbeddingConfig, error) {
	value, err := s.getSetting(ctx, "embedding")
	if err != nil {
		// 从环境变量回退
		return &EmbeddingConfig{
			ApiUrl:     getEnvOrDefault("EMBEDDING_API_URL", "https://api.siliconflow.cn/v1"),
			ApiKey:     "****",
			Model:      getEnvOrDefault("EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-8B"),
			Dimensions: 4096,
		}, nil
	}

	var config EmbeddingConfig
	if err := json.Unmarshal([]byte(value), &config); err != nil {
		return nil, fmt.Errorf("解析 Embedding 配置失败: %w", err)
	}

	// 隐藏 API Key
	if config.ApiKey != "" {
		config.ApiKey = "****"
	}

	return &config, nil
}

// SaveEmbeddingConfig 保存 Embedding 配置
func (s *SettingsService) SaveEmbeddingConfig(ctx context.Context, config *EmbeddingConfig) error {
	// 如果 apiKey 是掩码，保留原值
	if config.ApiKey == "****" {
		existing, err := s.getSetting(ctx, "embedding")
		if err == nil && existing != "" {
			var oldConfig EmbeddingConfig
			if json.Unmarshal([]byte(existing), &oldConfig) == nil {
				config.ApiKey = oldConfig.ApiKey
			}
		}
	}

	data, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("序列化 Embedding 配置失败: %w", err)
	}

	return s.saveSetting(ctx, "embedding", string(data))
}

// TestEmbeddingConnection 测试 Embedding 连接
func (s *SettingsService) TestEmbeddingConnection(ctx context.Context, config *EmbeddingConfig) (map[string]interface{}, error) {
	// 如果 apiKey 是掩码，使用保存的值
	if config.ApiKey == "****" {
		existing, err := s.getSetting(ctx, "embedding")
		if err == nil && existing != "" {
			var oldConfig EmbeddingConfig
			if json.Unmarshal([]byte(existing), &oldConfig) == nil {
				config.ApiKey = oldConfig.ApiKey
			}
		}
	}

	// 实际调用 Embedding API 测试连接
	apiUrl := config.ApiUrl
	if apiUrl == "" {
		apiUrl = "https://api.siliconflow.cn/v1"
	}
	// 确保URL以 /embeddings 结尾
	testUrl := apiUrl
	if len(testUrl) > 0 && testUrl[len(testUrl)-1] == '/' {
		testUrl = testUrl[:len(testUrl)-1]
	}
	if !endsWith(testUrl, "/embeddings") {
		testUrl = testUrl + "/embeddings"
	}

	// 构造测试请求：对 "测试" 文本生成 embedding
	reqBody := map[string]interface{}{
		"model": config.Model,
		"input": "测试",
	}
	if config.Dimensions > 0 {
		reqBody["dimensions"] = config.Dimensions
	}
	reqData, _ := json.Marshal(reqBody)

	req, err := http.NewRequestWithContext(ctx, "POST", testUrl, bytes.NewReader(reqData))
	if err != nil {
		return map[string]interface{}{"success": false, "message": fmt.Sprintf("创建请求失败: %v", err)}, nil
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.ApiKey)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return map[string]interface{}{"success": false, "message": fmt.Sprintf("连接失败: %v", err)}, nil
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("API 返回错误 (HTTP %d): %s", resp.StatusCode, string(body)),
		}, nil
	}

	return map[string]interface{}{
		"success": true,
		"message": "连接测试成功",
	}, nil
}

// GetEmbeddingModels 获取 Embedding 模型列表
func (s *SettingsService) GetEmbeddingModels(ctx context.Context) ([]map[string]interface{}, error) {
	models := []map[string]interface{}{
		{
			"id":         "Qwen/Qwen3-Embedding-8B",
			"name":       "Qwen3 Embedding 8B (SiliconFlow)",
			"dimensions": 4096,
			"provider":   "SiliconFlow",
		},
		{
			"id":         "BAAI/bge-large-zh-v1.5",
			"name":       "BGE Large Chinese v1.5",
			"dimensions": 1024,
			"provider":   "SiliconFlow",
		},
		{
			"id":         "BAAI/bge-m3",
			"name":       "BGE M3",
			"dimensions": 1024,
			"provider":   "SiliconFlow",
		},
		{
			"id":         "text-embedding-3-small",
			"name":       "OpenAI Text Embedding 3 Small",
			"dimensions": 1536,
			"provider":   "OpenAI",
		},
		{
			"id":         "text-embedding-3-large",
			"name":       "OpenAI Text Embedding 3 Large",
			"dimensions": 3072,
			"provider":   "OpenAI",
		},
	}
	return models, nil
}

// GetRerankerConfig 获取 Reranker 配置
func (s *SettingsService) GetRerankerConfig(ctx context.Context) (*RerankerConfig, error) {
	value, err := s.getSetting(ctx, "reranker")
	if err != nil {
		// 从环境变量回退
		return &RerankerConfig{
			ApiUrl: getEnvOrDefault("RERANKER_API_URL", "https://api.siliconflow.cn/v1"),
			ApiKey: "****",
			Model:  getEnvOrDefault("RERANKER_MODEL", "Qwen/Qwen3-Reranker-8B"),
			TopN:   3,
		}, nil
	}

	var config RerankerConfig
	if err := json.Unmarshal([]byte(value), &config); err != nil {
		return nil, fmt.Errorf("解析 Reranker 配置失败: %w", err)
	}

	// 隐藏 API Key
	if config.ApiKey != "" {
		config.ApiKey = "****"
	}

	return &config, nil
}

// SaveRerankerConfig 保存 Reranker 配置
func (s *SettingsService) SaveRerankerConfig(ctx context.Context, config *RerankerConfig) error {
	// 如果 apiKey 是掩码，保留原值
	if config.ApiKey == "****" {
		existing, err := s.getSetting(ctx, "reranker")
		if err == nil && existing != "" {
			var oldConfig RerankerConfig
			if json.Unmarshal([]byte(existing), &oldConfig) == nil {
				config.ApiKey = oldConfig.ApiKey
			}
		}
	}

	data, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("序列化 Reranker 配置失败: %w", err)
	}

	return s.saveSetting(ctx, "reranker", string(data))
}

// TestRerankerConnection 测试 Reranker 连接
func (s *SettingsService) TestRerankerConnection(ctx context.Context, config *RerankerConfig) (map[string]interface{}, error) {
	// 如果 apiKey 是掩码，使用保存的值
	if config.ApiKey == "****" {
		existing, err := s.getSetting(ctx, "reranker")
		if err == nil && existing != "" {
			var oldConfig RerankerConfig
			if json.Unmarshal([]byte(existing), &oldConfig) == nil {
				config.ApiKey = oldConfig.ApiKey
			}
		}
	}

	// 实际调用 Reranker API 测试连接
	apiUrl := config.ApiUrl
	if apiUrl == "" {
		apiUrl = "https://api.siliconflow.cn/v1"
	}
	testUrl := apiUrl
	if len(testUrl) > 0 && testUrl[len(testUrl)-1] == '/' {
		testUrl = testUrl[:len(testUrl)-1]
	}
	if !endsWith(testUrl, "/rerank") {
		testUrl = testUrl + "/rerank"
	}

	// 构造测试请求
	reqBody := map[string]interface{}{
		"model": config.Model,
		"query": "测试查询",
		"documents": []string{"测试文档1", "测试文档2"},
		"top_n":     config.TopN,
	}
	reqData, _ := json.Marshal(reqBody)

	req, err := http.NewRequestWithContext(ctx, "POST", testUrl, bytes.NewReader(reqData))
	if err != nil {
		return map[string]interface{}{"success": false, "message": fmt.Sprintf("创建请求失败: %v", err)}, nil
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.ApiKey)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return map[string]interface{}{"success": false, "message": fmt.Sprintf("连接失败: %v", err)}, nil
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("API 返回错误 (HTTP %d): %s", resp.StatusCode, string(body)),
		}, nil
	}

	return map[string]interface{}{
		"success": true,
		"message": "连接测试成功",
	}, nil
}

// endsWith 检查字符串是否以指定后缀结尾
func endsWith(s, suffix string) bool {
	if len(suffix) > len(s) {
		return false
	}
	return s[len(s)-len(suffix):] == suffix
}

// ========== 内部方法 ==========

// getSetting 从数据库获取设置值
func (s *SettingsService) getSetting(ctx context.Context, key string) (string, error) {
	pool := postgres.GetPool()
	if pool == nil {
		return "", fmt.Errorf("数据库连接未初始化")
	}

	var value string
	err := pool.QueryRow(ctx, "SELECT value FROM settings WHERE key = $1", key).Scan(&value)
	if err != nil {
		return "", err
	}
	return value, nil
}

// saveSetting 保存设置值到数据库
func (s *SettingsService) saveSetting(ctx context.Context, key string, value string) error {
	pool := postgres.GetPool()
	if pool == nil {
		return fmt.Errorf("数据库连接未初始化")
	}

	_, err := pool.Exec(ctx,
		`INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3)
		 ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3`,
		key, value, time.Now().Format(time.RFC3339))
	if err != nil {
		return fmt.Errorf("保存设置失败: %w", err)
	}

	slog.Info("设置保存成功", "key", key)
	return nil
}
