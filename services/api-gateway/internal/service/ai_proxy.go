package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/config"
)

// AIProxyService AI 服务代理，将请求转发到 Python AI Service
type AIProxyService struct {
	cfg        *config.Config
	httpClient *http.Client
}

// NewAIProxyService 创建 AI 代理服务实例
func NewAIProxyService(cfg *config.Config) *AIProxyService {
	return &AIProxyService{
		cfg: cfg,
		httpClient: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

// ProxyChat 转发角色对话请求（SSE 流式）
// 返回响应体供调用方以 SSE 方式流式传输
func (s *AIProxyService) ProxyChat(ctx context.Context, requestBody interface{}) (io.ReadCloser, error) {
	url := fmt.Sprintf("%s/api/ai/chat", s.cfg.AIService.URL)
	return s.doStreamRequest(ctx, "POST", url, requestBody)
}

// ProxyGraphRAG 转发知识库问答请求
func (s *AIProxyService) ProxyGraphRAG(ctx context.Context, novelId string, requestBody interface{}) (io.ReadCloser, error) {
	url := fmt.Sprintf("%s/api/ai/query", s.cfg.AIService.URL)
	return s.doStreamRequest(ctx, "POST", url, requestBody)
}

// ProxyEmbedding 转发向量嵌入请求
func (s *AIProxyService) ProxyEmbedding(ctx context.Context, requestBody interface{}) (map[string]interface{}, error) {
	url := fmt.Sprintf("%s/api/ai/embed", s.cfg.AIService.URL)
	return s.doJSONRequest(ctx, "POST", url, requestBody)
}

// ProxyTestConnection 转发 AI 连接测试
func (s *AIProxyService) ProxyTestConnection(ctx context.Context, requestBody interface{}) (map[string]interface{}, error) {
	url := fmt.Sprintf("%s/api/ai/test", s.cfg.AIService.URL)
	return s.doJSONRequest(ctx, "POST", url, requestBody)
}

// ProxyGetModels 转发获取 AI 模型列表
func (s *AIProxyService) ProxyGetModels(ctx context.Context, requestBody interface{}) (map[string]interface{}, error) {
	url := fmt.Sprintf("%s/api/ai/models", s.cfg.AIService.URL)
	return s.doJSONRequest(ctx, "POST", url, requestBody)
}

// ProxyExtract 转发 AI 提取请求
func (s *AIProxyService) ProxyExtract(ctx context.Context, requestBody interface{}) (map[string]interface{}, error) {
	url := fmt.Sprintf("%s/api/ai/extract", s.cfg.AIService.URL)
	return s.doJSONRequest(ctx, "POST", url, requestBody)
}

// ProxyGraphSummary 转发图谱摘要请求
func (s *AIProxyService) ProxyGraphSummary(ctx context.Context, requestBody interface{}) (map[string]interface{}, error) {
	url := fmt.Sprintf("%s/api/ai/graph-summary", s.cfg.AIService.URL)
	return s.doJSONRequest(ctx, "POST", url, requestBody)
}

// doStreamRequest 执行流式 HTTP 请求，返回响应体
func (s *AIProxyService) doStreamRequest(ctx context.Context, method, url string, body interface{}) (io.ReadCloser, error) {
	var reqBody io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("序列化请求体失败: %w", err)
		}
		reqBody = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, reqBody)
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求 AI 服务失败: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("AI 服务返回错误: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
	}

	slog.Info("AI 流式请求已建立", "url", url)
	return resp.Body, nil
}

// doJSONRequest 执行普通 JSON HTTP 请求
func (s *AIProxyService) doJSONRequest(ctx context.Context, method, url string, body interface{}) (map[string]interface{}, error) {
	var reqBody io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("序列化请求体失败: %w", err)
		}
		reqBody = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, reqBody)
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求 AI 服务失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应体失败: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("AI 服务返回错误: status=%d, body=%s", resp.StatusCode, string(respBody))
	}

	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		// 如果不是 JSON，返回原始文本
		result = map[string]interface{}{
			"data": string(respBody),
		}
	}

	return result, nil
}
