# 构建阶段
FROM golang:1.22-alpine AS builder

WORKDIR /app

# 安装依赖
COPY go.mod go.sum ./
RUN go mod download

# 复制源代码
COPY . .

# 编译应用
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/api-gateway ./cmd/main.go

# 运行阶段
FROM alpine:3.19

WORKDIR /app

# 安装 ca-certificates（用于 HTTPS 请求）
RUN apk --no-cache add ca-certificates tzdata

# 从构建阶段复制二进制文件
COPY --from=builder /app/api-gateway .

# 复制环境变量示例文件
COPY --from=builder /app/.env.example .env.example

# 暴露端口
EXPOSE 8080

# 运行应用
CMD ["./api-gateway"]
