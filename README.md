# AI 小说角色图谱

AI 驱动的小说角色关系图谱构建工具 —— 自动解析小说文本，逐步构建人物关系图谱，支持角色搜索、经历回溯、推断标注与图谱演变回放。

> **架构说明**：本项目采用微服务架构（V2）。`main` 分支保留旧版单体框架（TypeScript，位于 `server/`），`feat/microservice-v2` 分支为当前微服务版本（Go + Python，位于 `services/`）。详见 [docs/ARCHITECTURE_V2.md](docs/ARCHITECTURE_V2.md)。

## 功能概览

- **三种输入模式**：上传有章节 TXT / 上传无章节 TXT / 手动粘贴文本
- **智能章节识别**：AI 自动识别章节边界，无章节小说按语义自动分段
- **基于 Token 的增量构建**：每步不超过模型上下文限制，多章节聚合为一步，保证 AI 理解准确性
- **角色档案**：每个角色维护独立档案（基本信息、经历时间线、个人解析、推断标注）
- **角色消歧**：自动检测同名异人/同人异名，前端提供合并/拆分操作
- **推断标注**：对作者未明说之处进行小幅度推断，统一标注 `[推断]` 并记录依据
- **继承续建**：支持分批上传，自动检测重复内容，去重后继续构建
- **快照回放**：每步生成独立快照，支持时间轴步进查看图谱演变
- **中途取消 & 事后回退**：构建过程中可取消，完成后可回退到任意步
- **角色搜索**：搜索任意角色，以该角色为中心展示关系图，查看角色详情
- **AI 模型前端配置**：用户在界面配置 OpenAI 兼容 API 地址、Key、选择模型
- **成本预估**：构建前展示预估调用次数和 Token 用量，用户可自行选择是否开启
- **数据导出**：支持导出为 JSON / GraphML / GEXF / CSV 格式
- **角色对话**：支持与小说角色进行 AI 对话，包含单角色对话、群聊模式、对话模式三种模式
- **自定义提示词预设**：仿 SillyTavern 设计，支持创建/编辑/切换提示词预设，12 个宏变量自动替换
- **知识库问答**：基于 GraphRAG 的小说知识库，支持向量检索 + 图谱推理 + 重排序
- **角色档案按章节分段构建**：按章节逐步提取角色关键经历，支持并行处理与次要角色过滤

## 技术栈（微服务架构 V2）

| 层级 | 技术 | 说明 |
|------|------|------|
| API 网关 | Go 1.21+ + Gin | 路由、鉴权、任务调度、文件系统后备存储 |
| AI 服务 | Python 3.12+ + FastAPI | 角色提取、向量嵌入、角色对话、GraphRAG |
| 图数据库 | Neo4j 5.x | 图谱存储、关系查询（可选，不可用时自动降级） |
| 关系数据库 | PostgreSQL 16 | 设置、提示词预设存储 |
| 缓存/队列 | Redis | 任务队列、进度状态、快照缓存 |
| 前端 | React 18 + TypeScript + Ant Design 5 | SPA 应用 |
| 图谱可视化 | AntV G6 | 力导向图渲染 |
| 构建 | Vite | 前端构建 |

### 核心特性：文件系统后备存储

当 Neo4j 不可用时，系统自动降级到文件系统存储，**无需 Neo4j 也能完整运行**：

- 启动时 3 秒超时检测 Neo4j 可用性（`IsAvailable()`）
- 所有数据访问层在入口检查可用性，不可用时走文件系统
- 数据保存在 `server/output/novels/{novelId}/` 下的 JSON 文件
- 快照、角色、关系、事件均支持文件系统读写

## 项目流程

### 整体流程图

```
TXT/文本输入
     │
     ▼
┌─────────────────────────────────────────────┐
│  输入模式判断                                  │
│  ├─ 有章节TXT → 章节识别 → 步划分               │
│  ├─ 无章节TXT → AI语义分段 → 步划分             │
│  └─ 文本粘贴  → Token校验 → 直接作为一步         │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│  逐步构建图谱（核心循环）                        │
│                                               │
│  for each step:                               │
│    1. 拼接该步所有章节原文                       │
│    2. Token 计数，确保不超过模型上下文限制         │
│    3. AI 提取人物/关系/事件/推断                 │
│    4. 角色消歧（同名异人/同人异名检测）            │
│    5. 与上一步图谱增量合并到 Neo4j/文件系统        │
│    6. 冲突检测与标记                            │
│    7. 更新涉及角色的个人档案                     │
│    8. 保存本步快照                              │
│                                               │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│  主角识别 → AI 判定主角（多主角按首次登场排序）    │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│  可视化展示                                    │
│  ├─ 默认：以主角为中心的全局关系图               │
│  ├─ 搜索：以任意角色为中心的关系图               │
│  ├─ 时间轴：按步回放图谱变化                     │
│  ├─ 角色详情：经历时间线 + 个人解析 + 推断        │
│  └─ 数据导出：JSON / GraphML / GEXF / CSV      │
└─────────────────────────────────────────────┘
```

### 步划分规则

步划分基于 **Token 数**而非字符数。用户可自行配置模型上下文大小，不配置则默认 **200,000 Token**。

每步的输入 Token 数（原文 + 提示词）不得超过模型上下文限制，同时需预留输出空间。当加入下一章节会超过限制时，当前步在该章节之前截止。

```
计算公式：
  可用输入 Token = 模型上下文大小 - 提示词 Token - 预留输出 Token
  每步 Token 总和 ≤ 可用输入 Token

示例：模型上下文 200000，提示词约 2000，预留输出 8000
  可用输入 = 200000 - 2000 - 8000 = 190000 Token
  中文约 2~3 Token/字，即可输入约 63000~95000 中文字

示例：小说共30章，每章约4000字（约10000 Token）

第1步：第1章~第18章（180000 Token，加入第19章=190000 ≤ 190000 截止线，刚好）
第2步：第19章~第30章（120000 Token，剩余章节，结束）
```

### 继续航建流程

```
用户上传新文件/粘贴新文本
         │
         ▼
  检查是否有同小说的已有图谱
         │
    ┌────┴─────┐
    │          │
 无已有图谱  有已有图谱
    │          │
    ▼          ▼
 新建流程   重复内容检测（文本指纹 + AI语义确认）
                │
           ┌────┴─────┐
           │          │
       无重复     有重复
           │          │
           ▼          ▼
       全量续建   去重后续建（从重复结束位置开始）
```

### 回退机制

| 操作 | 说明 |
|------|------|
| 中途取消 | 等当前步原子完成后取消，清理半成品，回退到上一步快照 |
| 事后回退 | 逆序执行写操作日志，删除对应步的数据，恢复目标快照 |
| 撤销回退 | 回退前保存临时快照，撤销时恢复 |

## AI 模型配置

用户在前端设置页面配置 AI 模型，支持任何 OpenAI 兼容格式的 API。

### 配置流程

1. 输入 API 地址（如 `https://api.openai.com/v1`）
2. 输入 API Key
3. 点击"获取模型列表"→ 系统调用 API 获取可用模型
4. 从列表中选择模型
5. 输入模型上下文大小（不填则默认 200,000 Token）
6. 保存配置

### API 地址自动补全规则

系统会检测用户输入的 API 地址，仅在缺失时自动补全：

| 用户输入 | 系统处理 | 最终请求地址 |
|---------|---------|-------------|
| `https://api.openai.com/v1` | 检测到已有 `/v1`，不补全 | `https://api.openai.com/v1/models` |
| `https://api.openai.com/v1/` | 检测到已有 `/v1/`，不补全 | `https://api.openai.com/v1/models` |
| `https://api.openai.com/v1/models` | 检测到已是完整路径，不补全 | `https://api.openai.com/v1/models` |
| `https://api.openai.com` | 检测到缺失 `/v1`，自动补全 | `https://api.openai.com/v1/models` |
| `http://localhost:11434` | 检测到缺失 `/v1`，自动补全 | `http://localhost:11434/v1/models` |
| `http://localhost:11434/v1` | 检测到已有 `/v1`，不补全 | `http://localhost:11434/v1/models` |

**核心原则**：只补全缺失项，不修改用户已有的输入。

### 安全性

- API Key 使用 AES-256-GCM 加密存储在后端
- 前端仅显示脱敏值（如 `sk-***...x5DZ`）
- 加密密钥从环境变量读取，不进入代码仓库

## 关键设计

### Token 计数与步划分

步划分基于 Token 数而非字符数，原因：

- 中文字符在大多数模型中约 2~3 Token/字
- AI 模型的上下文限制是 Token 数，不是字符数
- 提示词和输出也需要占用 Token 空间

**Token 计数流程**：

1. 用户配置模型上下文大小（默认 200,000）
2. 系统计算可用输入 Token = 模型上下文 - 提示词 Token - 预留输出 Token
3. 对每个章节的文本估算 Token 数（使用 tiktoken 或模型对应的 Tokenizer）
4. 贪心聚合章节，确保每步 Token 总和 ≤ 可用输入 Token

### 角色消歧

AI 在不同章节可能用不同名字指代同一角色，或用相同名字指代不同角色：

| 问题 | 示例 | 处理方式 |
|------|------|---------|
| 同人异名 | "张三" / "三哥" / "张前辈" | AI 提取时附带外貌/身份/上下文描述，系统自动匹配相似度，疑似同一人时标记为"待确认" |
| 同名异人 | 两个不同角色都叫"小明" | AI 提取时附带区分信息，系统检测到同名不同描述时标记为"待确认" |

前端提供 **角色合并/拆分操作**，用户可手动确认或修正消歧结果。

### 增量合并冲突处理

不同章节对同一角色的描述或关系可能矛盾：

| 冲突类型 | 示例 | 处理方式 |
|---------|------|---------|
| 属性冲突 | 第3章"张三，男" vs 第50章"张三，女" | 标记为冲突，前端展示冲突列表，用户选择保留哪个版本 |
| 关系冲突 | 第5章"张三和李四是朋友" vs 第20章"张三和李四是敌对" | 新增关系边（关系可随剧情变化），标记变化章节 |

### 关系的时间维度

关系会随剧情变化，每条关系边包含时间信息：

```json
{
  "source": "char_001",
  "target": "char_002",
  "relation_type": "朋友",
  "since_chapter": 5,
  "until_chapter": 20,
  "is_inference": false
},
{
  "source": "char_001",
  "target": "char_002",
  "relation_type": "敌对",
  "since_chapter": 20,
  "until_chapter": null,
  "is_inference": false
}
```

- `since_chapter`：关系起始章节
- `until_chapter`：关系结束章节（null 表示持续到最新）
- 可视化时支持按章节筛选，展示该时间点的关系状态

### AI 调用重试机制

- 默认重试 **3 次**，用户可在设置中自行更改
- 采用指数退避策略（1s → 2s → 4s）
- 区分可重试错误（网络超时、限流 429）和不可重试错误（API Key 无效、余额不足）
- 记录失败步骤，支持从失败处继续构建

### 角色对话

支持与小说角色进行 AI 对话，三种对话模式：

| 模式 | 说明 |
|------|------|
| 单角色对话 | 与单个角色进行一对一对话，角色基于自身性格和经历回复 |
| 群聊模式 | 多个角色同时参与，角色之间会互相回应 |
| 对话模式 | 指定多个角色进行特定场景对话，用户作为旁观者或引导者 |

**核心特性**：

- **SSE 流式输出**：对话内容实时流式推送，支持思维链过滤（`<think/>` 标签自动过滤）
- **startBuffer 机制**：积累初始输出内容（至少 8 个非空白字符）后统一清理，解决思维链后单字前缀和前导空行问题
- **maxTokens 60000**：支持多角色多轮长对话，避免输出截断
- **角色人设注入**：自动将角色的性格、经历、关系等信息注入系统提示词

### 自定义提示词预设

仿 SillyTavern 设计，支持自定义提示词预设系统：

**预设结构**：

| 字段 | 说明 |
|------|------|
| `systemPrompt` | 系统提示词模板 |
| `characterTemplate` | 角色描述模板 |
| `behaviorGuidelines` | 行为准则模板 |
| `groupSystemPrompt` | 群聊系统提示词模板 |
| `dialogueSystemPrompt` | 对话系统提示词模板 |
| `firstMessageSuffix` | 首条消息后缀 |
| `maxTokens` | 最大输出 Token 数 |

**宏变量替换**：预设模板中支持 12 个宏变量，对话时自动替换为角色实际数据：

| 宏变量 | 替换内容 |
|--------|---------|
| `{{char}}` | 角色名 |
| `{{char_aliases}}` | 角色别名（逗号分隔） |
| `{{char_gender}}` | 角色性别 |
| `{{char_faction}}` | 角色阵营 |
| `{{char_identity}}` | 角色身份 |
| `{{char_personality}}` | 角色性格 |
| `{{char_motivation}}` | 角色动机 |
| `{{char_relationships}}` | 角色关键关系 |
| `{{char_experiences}}` | 角色关键经历 |
| `{{char_original_texts}}` | 角色原文参考 |
| `{{user}}` | 用户名（默认为"你"） |
| `{{novel}}` | 小说名 |

**预设管理**：支持创建、编辑、删除、设为默认、基于已有预设创建新预设。

### 知识库问答（GraphRAG）

基于图谱增强检索生成（GraphRAG）的小说知识库问答系统：

1. **向量检索**：将问题向量化，在文本块向量索引中检索相关内容
2. **图谱推理**：基于角色关系图谱，扩展检索相关角色和事件
3. **重排序**：对检索结果进行重排序，提高相关性
4. **AI 生成**：将检索结果作为上下文，由 AI 生成最终回答

**性能优化**：

- Redis 缓存查询结果，避免重复计算
- N+1 批量查询优化，减少数据库访问次数
- 向量搜索 + 关键词搜索混合检索

### 成本预估

构建前和每步执行前，系统展示预估信息：

```
┌──────────────────────────────────────┐
│  下一步预估（可在设置中关闭）            │
│                                      │
│  预估 AI 调用次数：5 次                │
│  预估输入 Token：约 185,000           │
│  预估输出 Token：约 8,000             │
│  预估总 Token：约 193,000             │
│                                      │
│  [ 继续构建 ]  [ 取消 ]               │
└──────────────────────────────────────┘
```

- 用户可在设置中选择是否开启成本预估提示
- 每次构建任务记录实际 Token 用量，供后续参考

### 文件编码自动检测

中文 TXT 文件常见 GBK/GB2312/UTF-8 等多种编码，上传时自动检测编码，统一转为 UTF-8 后处理，避免乱码。

### 大图谱可视化性能优化

长篇小说可能有数百个角色、上千条关系，优化策略：

| 策略 | 说明 |
|------|------|
| 按重要性过滤 | 默认只显示核心关系（强度 > 阈值），可调整 |
| 分层展示 | 先显示主角核心圈 → 点击展开二级关系 |
| 虚拟化渲染 | G6 按视口裁剪，只渲染可见区域节点 |
| 缩略图导航 | 大图谱时提供缩略图，快速定位 |
| 多关系边合并 | 同一对角色的多条关系合并为一条，点击展开详情 |

### 同一对角色多条关系的展示

两个角色可能同时存在多种关系（如"师徒"+"朋友"+"敌对"）：

- 可视化时将同一对角色的多条边合并为一条复合边
- 点击复合边展开详细关系列表
- 不同关系类型用不同颜色标注

### 构建进度实时推送

使用 **SSE（Server-Sent Events）** 实时推送构建进度：

- 每步完成时推送进度更新
- 角色提取、关系提取等子步骤进度
- 错误和警告信息实时推送

### 构建任务并发控制

| 规则 | 说明 |
|------|------|
| 同一小说 | 同一时间只允许一个构建任务 |
| 不同小说 | 可并行构建，但控制 AI 调用并发数，避免触发 API 限流 |
| 最大并发 | 默认 3 个并发 AI 调用，可在配置中调整 |

### 文件上传限制

- 默认限制 **50MB**（约 1500 万字，覆盖绝大多数小说）
- 超大文件采用流式读取，不全量加载到内存

### 数据导出

支持将图谱数据导出为多种格式：

| 格式 | 用途 |
|------|------|
| JSON | 完整数据，可用于程序处理 |
| GraphML | Gephi 等图分析工具 |
| GEXF | Gephi 原生格式 |
| CSV | 节点表 + 边表，可用于 Excel/数据库导入 |

## 数据模型

### 节点类型

| 标签 | 属性 | 说明 |
|------|------|------|
| `Novel` | id, name, total_chars, total_tokens, input_mode, current_step, context_size | 小说 |
| `Chapter` | index, title, start_offset, char_count, token_count | 章节（含虚拟章节） |
| `Character` | id, name, aliases[], gender, faction, identity, first_appear_chapter, is_protagonist, disambiguation_status | 角色 |
| `Event` | id, name, chapter, summary, event_type | 事件 |
| `Snapshot` | step, character_count, relation_count, created_at | 快照 |

### 关系类型

| 类型 | 起点 → 终点 | 属性 | 说明 |
|------|-------------|------|------|
| `HAS_CHAPTER` | Novel → Chapter | order | 小说包含章节 |
| `APPEARS_IN` | Character → Chapter | — | 角色出场 |
| `PARTICIPATES` | Character → Event | role | 角色参与事件 |
| `RELATES_TO` | Character → Character | relation_type, since_chapter, until_chapter, strength, is_inference, inference_basis | 角色间关系（含时间维度） |
| `HAPPENS_IN` | Event → Chapter | — | 事件发生章节 |
| `HAS_SNAPSHOT` | Novel → Snapshot | step | 小说快照 |

### 文件系统后备存储结构

Neo4j 不可用时，数据以 JSON 文件形式存储：

```
server/output/novels/{novelId}/
├── meta.json          # 小说元数据
├── chapters.json      # 章节数据
├── characters.json    # 角色数据
├── relations.json     # 关系数据
├── events.json        # 事件数据
├── original.txt       # 原文
└── snapshots/         # 快照
    └── step_N.json    # 第 N 步快照
```

## API 设计

API 网关统一前缀：`/novelgraph/api/*`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/novels/upload` | 上传 TXT（`has_chapter` 参数指定是否有章节） |
| POST | `/api/novels/text-paste` | 文本粘贴构建 |
| GET | `/api/novels` | 小说列表 |
| GET | `/api/novels/:id` | 小说详情 |
| POST | `/api/novels/:id/build` | 启动图谱构建 |
| POST | `/api/novels/:id/cancel` | 中途取消构建 |
| POST | `/api/novels/:id/rollback` | 回退到指定步 |
| GET | `/api/novels/:id/graph` | 获取图谱（支持 `center`、`step` 参数） |
| GET | `/api/novels/:id/snapshots` | 快照列表 |
| GET | `/api/novels/:id/snapshots/:step` | 某步快照 |
| GET | `/api/novels/:id/snapshots/:step/diff` | 快照差异对比 |
| GET | `/api/novels/:id/events` | 小说事件列表 |
| GET | `/api/characters/:id` | 角色详情（含档案） |
| GET | `/api/characters/search` | 角色搜索（支持别名模糊匹配） |
| POST | `/api/characters/merge` | 角色合并（消歧确认） |
| POST | `/api/characters/split` | 角色拆分（消歧确认） |
| POST | `/api/characters/chat` | 角色对话（SSE 流式，支持 `presetId` 参数） |
| GET | `/api/knowledge-base` | 知识库列表 |
| POST | `/api/knowledge-base/:novelId/question` | 知识库问答 |
| GET | `/api/prompt-presets` | 列出所有提示词预设 |
| POST | `/api/prompt-presets` | 创建预设 |
| PUT | `/api/prompt-presets/:id` | 更新预设 |
| DELETE | `/api/prompt-presets/:id` | 删除预设 |
| GET | `/api/settings/ai` | 获取当前 AI 配置（Key 脱敏） |
| PUT | `/api/settings/ai` | 保存 AI 配置 |
| GET | `/api/settings/build` | 获取构建配置 |
| PUT | `/api/settings/build` | 保存构建配置 |
| GET | `/api/novels/:id/export` | 导出图谱数据（支持 `format` 参数：json/graphml/gexf/csv） |
| GET | `/api/novels/:id/progress` | 构建进度 |
| GET | `/api/novels/:id/task` | 任务状态 |

## 项目结构

```
ai-novel-character-graph/
├── services/                           # 微服务架构 V2
│   ├── api-gateway/                    # Go API 网关（Gin，端口 8080）
│   │   ├── cmd/                        # 程序入口
│   │   │   └── main.go
│   │   ├── internal/
│   │   │   ├── config/                 # 配置加载
│   │   │   ├── handler/                # HTTP 处理器
│   │   │   │   ├── novel_handler.go
│   │   │   │   ├── character_handler.go
│   │   │   │   ├── graph_handler.go
│   │   │   │   ├── chat_handler.go
│   │   │   │   ├── graphrag_handler.go
│   │   │   │   ├── knowledge_handler.go
│   │   │   │   └── settings_handler.go
│   │   │   ├── model/                  # 数据模型
│   │   │   ├── repository/             # 数据访问层
│   │   │   │   ├── neo4j/              # Neo4j + 文件系统后备
│   │   │   │   │   ├── connection.go   # 连接管理 + IsAvailable()
│   │   │   │   │   ├── fs_store.go     # 文件系统后备存储
│   │   │   │   │   ├── novel_repo.go
│   │   │   │   │   ├── chapter_repo.go
│   │   │   │   │   ├── character_repo.go
│   │   │   │   │   ├── relation_repo.go
│   │   │   │   │   └── event_repo.go
│   │   │   │   └── redis/              # Redis 任务队列
│   │   │   ├── router/                 # 路由配置
│   │   │   └── service/                # 业务逻辑层
│   │   │       ├── novel_service.go    # 小说服务（含快照）
│   │   │       ├── task_service.go     # 构建任务服务
│   │   │       ├── graph_service.go    # 图谱服务
│   │   │       ├── character_service.go
│   │   │       ├── ai_proxy.go         # AI 服务代理
│   │   │       └── export_service.go
│   │   ├── go.mod
│   │   └── Dockerfile
│   └── ai-service/                     # Python AI 服务（FastAPI，端口 8000）
│       ├── app/
│       │   ├── api/                    # API 端点
│       │   │   ├── extract.py          # 角色提取
│       │   │   ├── embedding.py        # 向量嵌入
│       │   │   ├── chat.py             # 角色对话
│       │   │   ├── graphrag.py         # GraphRAG 问答
│       │   │   └── health.py           # 健康检查
│       │   ├── core/                   # 核心服务
│       │   │   ├── extractor.py        # 提取服务
│       │   │   ├── embedding.py        # 嵌入服务
│       │   │   ├── chat.py             # 对话服务
│       │   │   ├── graphrag.py         # GraphRAG 服务
│       │   │   ├── ai_client.py        # LLM 客户端
│       │   │   └── prompts.py          # 提示词模板
│       │   ├── models/                 # 数据模型
│       │   └── main.py                 # FastAPI 入口
│       ├── pyproject.toml
│       └── Dockerfile
├── infrastructure/                     # 基础设施配置
│   └── postgres/
│       └── init.sql                    # PostgreSQL 初始化脚本
├── web/                                # 前端（React + AntD + G6）
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home/                   # 首页：上传 + 小说列表
│   │   │   ├── NovelDetail/            # 小说详情页
│   │   │   │   ├── CharacterTab.tsx
│   │   │   │   ├── GraphTab.tsx
│   │   │   │   ├── OriginalTextTab.tsx
│   │   │   │   └── QATab.tsx
│   │   │   ├── Knowledge/              # 知识库页
│   │   │   ├── Settings/               # 设置页
│   │   │   ├── Task/                   # 任务页
│   │   │   ├── Continue/               # 续建页
│   │   │   ├── Character/              # 角色页
│   │   │   └── Graph/                  # 图谱页
│   │   ├── services/
│   │   │   └── api.ts
│   │   ├── hooks/                      # React Query hooks
│   │   ├── stores/                     # Zustand 状态管理
│   │   └── providers/                  # Context Providers
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── server/                             # 旧版单体框架 V1（保留，详见 main 分支）
├── docs/
│   └── ARCHITECTURE_V2.md              # 微服务架构文档
├── docker-compose.yml                  # V1 部署（旧框架）
├── docker-compose.v2.yml               # V2 部署（微服务）
├── .gitignore
└── README.md
```

## 部署

### 方式一：Docker 部署（推荐）

```bash
# 克隆项目
git clone https://github.com/yumeng001yu/ai-novel-character-graph.git
cd ai-novel-character-graph
git checkout feat/microservice-v2

# 启动所有微服务（Neo4j + Redis + PostgreSQL + API 网关 + AI 服务 + 前端）
docker-compose -f docker-compose.v2.yml up -d

# 访问
# 前端：http://localhost:8080/novelgraph/
# API 网关：http://localhost:8080/novelgraph/api/
# AI 服务：http://localhost:8000/api/ai/health
# Neo4j 管理：http://localhost:7474
```

### 方式二：本地开发部署

```bash
# 克隆项目
git clone https://github.com/yumeng001yu/ai-novel-character-graph.git
cd ai-novel-character-graph
git checkout feat/microservice-v2

# 1. 启动基础设施（Redis + PostgreSQL）
apt-get install -y redis-server postgresql
systemctl start redis-server postgresql

# 创建 PostgreSQL 数据库
sudo -u postgres createdb novelgraph
sudo -u postgres createuser -P novelgraph

# 2. 启动 Python AI 服务
cd services/ai-service
pip install -e .
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# 3. 构建并启动 Go API 网关
cd ../api-gateway
go build -o api-gateway ./cmd/
./api-gateway  # 监听 8080

# 4. 构建前端
cd ../../web
npm install && npm run build
cp -r dist/* ../services/api-gateway/static/

# 5. 访问
# http://localhost:8080/novelgraph/
```

### 无 Neo4j 运行

系统支持在无 Neo4j 环境下完整运行，数据自动存储到文件系统：

- 启动时检测 Neo4j 连接（3 秒超时）
- 连接失败时自动降级到文件系统存储
- 所有功能（构建、快照、回退、图谱查询）均可在文件系统模式下工作
- 数据保存在 `server/output/novels/{novelId}/` 目录

### 旧版框架（V1）部署

如需使用旧版单体框架（TypeScript），切换到 `main` 分支：

```bash
git checkout main
docker-compose up -d
# 前端：http://localhost
# 后端 API：http://localhost:3001
```

## 分支说明

| 分支 | 说明 |
|------|------|
| `main` | 旧版单体框架（TypeScript + Fastify），位于 `server/` |
| `feat/microservice-v2` | 微服务架构（Go + Python），位于 `services/` |

两套架构并存，互不覆盖。详见 [docs/ARCHITECTURE_V2.md](docs/ARCHITECTURE_V2.md)。

## License

MIT
