package middleware

import (
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"github.com/yumeng001yu/ai-novel-character-graph/services/api-gateway/internal/config"
)

// CORS 返回 CORS 中间件
func CORS(cfg *config.Config) gin.HandlerFunc {
	corsConfig := cors.Config{
		AllowOrigins:     cfg.CORS.AllowedOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Requested-With"},
		ExposeHeaders:    []string{"Content-Length", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}

	// 如果没有配置允许的源，则允许所有
	if len(cfg.CORS.AllowedOrigins) == 0 {
		corsConfig.AllowAllOrigins = true
	}

	return cors.New(corsConfig)
}
