# 微服务架构 V2（Go + Python）

本文档说明新增的微服务架构（V2），以及它与原有单体框架（V1）的并存关系。

> **重要**：V2 为新增代码，**不替换、不覆盖** V1 的任何代码。两套架构并存，可独立部署。

---

## 一、架构对比

### V1（原有单体框架，保留不动）

- **位置**：`server/` 目录
- **技术栈**：Node.js + TypeScript + Express
- **部署**：`docker-compose.yml`
- **状态**：完整保留，不做任何修改

### V2（新增微服务架构）

- **位置**：`services/`、`infrastructure/` 目录
- **技术栈**：Go (Gin) API 网关 + Python (FastAPI) AI 服务
- **部署**：`docker-compose.v2.yml`
- **状态**：本次新增

---

## 二、V2 目录结构

```
ai-novel-character-graph/
├── server/                     # V1 原有框架（保留不动）
├── services/                   # V2 新增微服务
│   ├── api-gateway/            # Go API 网关（Gin，端口 8080）
│   │   ├── cmd/                # 程序入口
│   │   ├── internal/
│   │   │   ├── config/         # 配置加载
│   │   │   ├── handler/        # HTTP 处理器
│   │   │   ├── model/          # 数据模型
│   │   │   ├── repository/     # 数据访问层
│   │   │   │   ├── neo4j/      # Neo4j + 文件系统后备
│   │   │   │   └── redis/      # Redis 任务队列
│   │   │   ├── router/         # 路由配置
│   │   │   └── service/        # 业务逻辑层
│   │   ├── go.mod
│   │   └── Dockerfile
│   └── ai-service/             # Python AI 服务（FastAPI，端口 8000）
│       ├── app/
│       │   ├── api/            # API 端点（extract/embed/chat/graphrag）
│       │   ├── core/           # 核心服务（extractor/embedding/chat 等）
│       │   └── main.py
│       ├── pyproject.toml
│       └── Dockerfile
├── infrastructure/             # 基础设施配置
│   └── postgres/
│       └── init.sql            # PostgreSQL 初始化脚本
├── docker-compose.yml          # V1 部署（保留不动）
├── docker-compose.v2.yml       # V2 部署（新增）
└── web/                        # 前端（适配 V2 后端 API）
```

---

## 三、V2 关键特性

### 1. 文件系统后备存储（无 Neo4j 也能运行）

当 Neo4j 不可用时，系统自动降级到文件系统存储，数据保存在：

```
server/output/novels/{novelId}/
├── meta.json          # 小说元数据
├── chapters.json      # 章节数据
├── characters.json    # 角色数据
├── relations.json     # 关系数据
├── events.json        # 事件数据
├── original.txt       # 原文
└── snapshots/         # 快照
    └── step_N.json
```

**实现位置**：`services/api-gateway/internal/repository/neo4j/`
- `connection.go`：启动时检测 Neo4j 可用性（`IsAvailable()`）
- `fs_store.go`：文件系统后备读写函数
- 所有 repo 方法在入口检查 `IsAvailable()`，不可用时走文件系统

### 2. 启动时 Neo4j 可用性检测

避免 Neo4j 不可用时的 30 秒 × 6 次重试超时：

```go
// connection.go
func InitDriver(cfg config.Neo4jConfig) error {
    // ...
    ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
    defer cancel()
    err = driver.VerifyConnectivity(ctx)
    if err != nil {
        neo4jAvailable = false  // 标记不可用，后续走文件系统
    }
}
```

### 3. 图谱 API 返回角色姓名（非 ID）

`GraphService.GetFullGraph` 构建 ID→姓名映射，为边填充 `sourceName`/`targetName`：

```go
// graph_service.go
type GraphNode struct {
    ID            string `json:"id"`
    Label         string `json:"label"`
    Name          string `json:"name"`          // 新增
    IsProtagonist bool   `json:"isProtagonist"` // 新增
    // ...
}

type GraphEdge struct {
    ID           string `json:"id"`
    Source       string `json:"source"`
    Target       string `json:"target"`
    Label        string `json:"label"`
    RelationType string `json:"relationType"`  // 新增
    SourceName   string `json:"sourceName"`    // 新增
    TargetName   string `json:"targetName"`    // 新增
    IsInference  bool   `json:"isInference"`   // 新增
    // ...
}
```

### 4. 快照文件系统后备

快照功能在 Neo4j 不可用时也能正常工作：
- `GetSnapshots`/`GetSnapshot`：从 `snapshots/step_N.json` 读取
- `SaveSnapshot`：写入 `snapshots/step_N.json`
- `Rollback`：文件系统级别的回滚

### 5. 构建流程支持文件系统

`TaskService` 的构建流程在 Neo4j 不可用时完整降级：
- `getChapters`：改用 `ChapterRepo.FindByNovelId`（支持文件系统）
- `cleanBuildData`：调用 `FsCleanBuildData`
- `mergeExtraction`：角色/关系/事件写入文件系统
- `SaveSnapshot`：快照写入文件系统

---

## 四、本地运行 V2

### 前置依赖

- Go 1.21+
- Python 3.12+
- Redis（任务队列）
- PostgreSQL（设置/预设存储）
- Neo4j（可选，不可用时自动降级）

### 启动步骤

```bash
# 1. 启动 Redis 和 PostgreSQL
apt-get install -y redis-server postgresql
systemctl start redis-server postgresql

# 2. 创建 PostgreSQL 数据库
sudo -u postgres createdb novelgraph
sudo -u postgres createuser -P novelgraph

# 3. 启动 Python AI 服务
cd services/ai-service
pip install -e .
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# 4. 构建并启动 Go API 网关
cd services/api-gateway
go build -o api-gateway ./cmd/
./api-gateway  # 监听 8080

# 5. 构建前端
cd web
npm install && npm run build
cp -r dist/* ../services/api-gateway/static/

# 6. 访问
# http://localhost:8080/novelgraph/
```

### Docker 部署

```bash
docker-compose -f docker-compose.v2.yml up -d
```

---

## 五、V1 与 V2 共存说明

| 维度 | V1 | V2 |
|------|----|----|
| 后端代码 | `server/` | `services/` |
| 部署文件 | `docker-compose.yml` | `docker-compose.v2.yml` |
| 后端语言 | TypeScript | Go + Python |
| 数据库 | Neo4j | Neo4j（可选）+ 文件系统后备 |
| 端口 | 3000 | 8080（网关）+ 8000（AI） |
| 状态 | 保留不动 | 本次新增 |

**切换方式**：
- 使用 V1：`docker-compose up -d`
- 使用 V2：`docker-compose -f docker-compose.v2.yml up -d`

两套配置互不干扰，可按需选择。

---

## 六、本次更新内容

### 新增文件

- `services/api-gateway/`：Go API 网关完整代码
- `services/ai-service/`：Python AI 服务完整代码
- `infrastructure/postgres/init.sql`：PostgreSQL 初始化
- `docker-compose.v2.yml`：V2 部署配置
- `docs/ARCHITECTURE_V2.md`：本文档

### 修改文件

- `web/`：前端适配 V2 后端 API（API 路径、字段名兼容）
- `.gitignore`：排除 V2 构建产物

### 未修改

- `server/`：V1 原有框架代码完整保留
- `docker-compose.yml`：V1 部署配置完整保留
