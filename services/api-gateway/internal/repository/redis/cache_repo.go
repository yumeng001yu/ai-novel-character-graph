package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"
)

// CacheRepo 缓存仓库
type CacheRepo struct{}

// NewCacheRepo 创建缓存仓库实例
func NewCacheRepo() *CacheRepo {
	return &CacheRepo{}
}

// Get 获取缓存值
func (r *CacheRepo) Get(ctx context.Context, key string) (string, error) {
	val, err := GetClient().Get(ctx, key).Result()
	if err != nil {
		if isRedisNil(err) {
			return "", nil
		}
		return "", fmt.Errorf("获取缓存失败: %w", err)
	}
	return val, nil
}

// Set 设置缓存值
func (r *CacheRepo) Set(ctx context.Context, key string, value interface{}, ttl time.Duration) error {
	var data string
	switch v := value.(type) {
	case string:
		data = v
	default:
		bytes, err := json.Marshal(v)
		if err != nil {
			return fmt.Errorf("序列化缓存值失败: %w", err)
		}
		data = string(bytes)
	}

	if err := GetClient().Set(ctx, key, data, ttl).Err(); err != nil {
		return fmt.Errorf("设置缓存失败: %w", err)
	}
	return nil
}

// Delete 删除缓存
func (r *CacheRepo) Delete(ctx context.Context, keys ...string) error {
	if err := GetClient().Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("删除缓存失败: %w", err)
	}
	return nil
}

// WithCache 泛型缓存包装器，先查缓存，未命中则执行 fetcher 并缓存结果
func WithCache[T any](ctx context.Context, key string, ttl time.Duration, fetcher func() (T, error)) (T, error) {
	var zero T

	// 尝试从缓存获取
	val, err := GetClient().Get(ctx, key).Result()
	if err == nil && val != "" {
		var result T
		if err := json.Unmarshal([]byte(val), &result); err == nil {
			slog.Debug("缓存命中", "key", key)
			return result, nil
		}
	}

	// 缓存未命中，执行数据获取
	slog.Debug("缓存未命中", "key", key)
	result, err := fetcher()
	if err != nil {
		return zero, err
	}

	// 将结果写入缓存
	data, err := json.Marshal(result)
	if err == nil {
		if err := GetClient().Set(ctx, key, string(data), ttl).Err(); err != nil {
			slog.Warn("写入缓存失败", "key", key, "error", err)
		}
	}

	return result, nil
}
