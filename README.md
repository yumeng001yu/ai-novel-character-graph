# AI 小说角色图谱

AI 驱动的小说角色关系图谱构建工具 —— 自动解析小说文本，逐步构建人物关系图谱，支持角色搜索、经历回溯、推断标注与图谱演变回放。

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

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 后端 | TypeScript + Fastify | API 服务、任务调度 |
| 数据库 | Neo4j | 图谱存储、关系查询 |
| 缓存/队列 | Redis | 任务队列、进度状态、快照缓存 |
| 前端 | React 18 + TypeScript + Ant Design 5 | SPA 应用 |
| 图谱可视化 | AntV G6 | 力导向图渲染 |
| 构建 | Vite | 前端构建 |

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
│    5. 与上一步图谱增量合并到 Neo4j               │
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
| 事后回退 | 逆序执行写操作日志，删除对应步的 Neo4j 数据，恢复目标快照 |
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

中文 TXT 文件常见 GBK/GB2312/UTF-8 等多种编码，上传时自动检测编码（使用 chardet），统一转为 UTF-8 后处理，避免乱码。

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

## 数据模型（Neo4j）

### 节点类型

| 标签 | 属性 | 说明 |
|------|------|------|
| `Novel` | id, name, total_chars, total_tokens, input_mode, current_step, context_size | 小说 |
| `Chapter` | index, title, start_offset, char_count, token_count | 章节（含虚拟章节） |
| `Step` | step_number, chapters_range, total_tokens, status | 步 |
| `Character` | id, name, aliases[], gender, faction, identity, first_appear_chapter, is_protagonist, disambiguation_status | 角色 |
| `Event` | id, name, chapter, summary, event_type | 事件 |
| `TextSegment` | id, content_hash, start_offset, end_offset, step_created | 文本指纹段 |

### 关系类型

| 类型 | 起点 → 终点 | 属性 | 说明 |
|------|-------------|------|------|
| `HAS_CHAPTER` | Novel → Chapter | order | 小说包含章节 |
| `HAS_STEP` | Novel → Step | step_number | 小说包含步 |
| `INCLUDES` | Step → Chapter | — | 步包含章节 |
| `APPEARS_IN` | Character → Chapter | — | 角色出场 |
| `PARTICIPATES` | Character → Event | role | 角色参与事件 |
| `RELATES_TO` | Character → Character | relation_type, since_chapter, until_chapter, strength, is_inference, inference_basis | 角色间关系（含时间维度） |
| `HAPPENS_IN` | Event → Chapter | — | 事件发生章节 |
| `CONFLICTS_WITH` | Character → Character | conflict_type, chapters[], descriptions[] | 属性/关系冲突标记 |

## API 设计

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/novels/upload` | 上传 TXT（`has_chapter` 参数指定是否有章节） |
| POST | `/api/novels/text-paste` | 文本粘贴构建 |
| GET | `/api/novels` | 小说列表 |
| GET | `/api/novels/:id` | 小说详情 |
| POST | `/api/novels/:id/build` | 启动图谱构建 |
| POST | `/api/novels/:id/cancel` | 中途取消构建 |
| POST | `/api/novels/:id/rollback` | 回退到指定步 |
| POST | `/api/novels/:id/rollback/:step/undo` | 撤销回退 |
| POST | `/api/novels/:id/continue/upload` | 续建 - 上传文件 |
| POST | `/api/novels/:id/continue/paste` | 续建 - 文本粘贴 |
| GET | `/api/novels/:id/continue/check` | 续建前重复检测预览 |
| GET | `/api/novels/:id/graph` | 获取图谱（支持 `center`、`step` 参数） |
| GET | `/api/novels/:id/snapshots` | 快照列表 |
| GET | `/api/novels/:id/snapshots/:step` | 某步快照 |
| GET | `/api/novels/:id/snapshots/:step/diff` | 快照差异对比 |
| GET | `/api/novels/:id/cost-estimate` | 构建成本预估（调用次数 + Token 用量） |
| GET | `/api/characters/:id` | 角色详情（含档案） |
| GET | `/api/characters/:id/timeline` | 角色经历时间线 |
| GET | `/api/characters/search` | 角色搜索（支持别名模糊匹配） |
| POST | `/api/characters/merge` | 角色合并（消歧确认） |
| POST | `/api/characters/split` | 角色拆分（消歧确认） |
| GET | `/api/characters/conflicts` | 冲突列表 |
| POST | `/api/characters/conflicts/:id/resolve` | 解决冲突 |
| GET | `/api/settings/ai` | 获取当前 AI 配置（Key 脱敏） |
| PUT | `/api/settings/ai` | 保存 AI 配置 |
| POST | `/api/settings/ai/test` | 测试 AI 连接 |
| POST | `/api/settings/ai/models` | 获取可用模型列表 |
| GET | `/api/settings/build` | 获取构建配置（重试次数、成本预估开关等） |
| PUT | `/api/settings/build` | 保存构建配置 |
| GET | `/api/novels/:id/export` | 导出图谱数据（支持 `format` 参数：json/graphml/gexf/csv） |
| GET | `/api/novels/:id/progress` | 构建进度（SSE 推送） |

## 项目结构

```
ai-novel-character-graph/
├── server/                              # 后端（TypeScript + Fastify）
│   ├── src/
│   │   ├── routes/                      # 路由层
│   │   │   ├── novel.route.ts
│   │   │   ├── graph.route.ts
│   │   │   ├── character.route.ts
│   │   │   ├── snapshot.route.ts
│   │   │   ├── task.route.ts
│   │   │   ├── continue.route.ts
│   │   │   ├── settings.route.ts
│   │   │   └── export.route.ts
│   │   ├── services/                    # 业务逻辑层
│   │   │   ├── chapter-parser.service.ts
│   │   │   ├── semantic-segmenter.service.ts
│   │   │   ├── step-planner.service.ts
│   │   │   ├── graph-builder.service.ts
│   │   │   ├── extractor.service.ts
│   │   │   ├── merger.service.ts
│   │   │   ├── profile-builder.service.ts
│   │   │   ├── protagonist-detector.service.ts
│   │   │   ├── snapshot.service.ts
│   │   │   ├── search-indexer.service.ts
│   │   │   ├── duplicate-detector.service.ts
│   │   │   ├── rollback.service.ts
│   │   │   ├── task-manager.service.ts
│   │   │   ├── ai-client.service.ts
│   │   │   ├── settings.service.ts
│   │   │   ├── character-disambiguator.service.ts  # 角色消歧
│   │   │   ├── conflict-detector.service.ts        # 冲突检测
│   │   │   ├── token-counter.service.ts            # Token 计数
│   │   │   ├── cost-estimator.service.ts           # 成本预估
│   │   │   └── exporter.service.ts                 # 数据导出
│   │   ├── repositories/                # 数据访问层
│   │   │   ├── neo4j/
│   │   │   │   ├── novel.repo.ts
│   │   │   │   ├── chapter.repo.ts
│   │   │   │   ├── character.repo.ts
│   │   │   │   ├── event.repo.ts
│   │   │   │   ├── relation.repo.ts
│   │   │   │   └── text-segment.repo.ts
│   │   │   ├── redis/
│   │   │   │   ├── task-queue.repo.ts
│   │   │   │   ├── progress.repo.ts
│   │   │   │   ├── snapshot-cache.repo.ts
│   │   │   │   └── write-log.repo.ts
│   │   │   └── file/
│   │   │       └── ai-settings.repo.ts
│   │   ├── prompts/                    # AI 提示词模板
│   │   │   ├── chapter-split.prompt.ts
│   │   │   ├── semantic-segment.prompt.ts
│   │   │   ├── extract-characters.prompt.ts
│   │   │   ├── extract-relations.prompt.ts
│   │   │   ├── extract-events.prompt.ts
│   │   │   ├── infer.prompt.ts
│   │   │   ├── profile-update.prompt.ts
│   │   │   ├── detect-protagonist.prompt.ts
│   │   │   ├── duplicate-check.prompt.ts
│   │   │   └── character-disambiguate.prompt.ts   # 角色消歧提示词
│   │   ├── utils/
│   │   │   ├── text-splitter.ts
│   │   │   ├── fingerprint.ts
│   │   │   ├── crypto.ts
│   │   │   ├── token-counter.ts         # Token 计数工具
│   │   │   ├── encoding-detector.ts     # 文件编码检测
│   │   │   └── logger.ts
│   │   └── types/
│   ├── config.yaml
│   ├── tsconfig.json
│   └── package.json
├── web/                                # 前端（React + AntD + G6）
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home/                   # 首页：上传 + 小说列表
│   │   │   ├── Graph/                  # 图谱页：关系图 + 时间轴 + 回退
│   │   │   ├── Character/              # 角色页：搜索 + 详情 + 消歧
│   │   │   ├── Continue/               # 续建页
│   │   │   ├── Task/                   # 任务页：进度 + 日志 + 成本预估
│   │   │   └── Settings/               # 设置页：AI 模型配置 + 构建配置
│   │   ├── components/
│   │   │   ├── ConfigGuard.tsx         # 配置守卫
│   │   │   ├── InferenceBadge.tsx      # 推断标记
│   │   │   ├── RelationTag.tsx         # 关系类型标签
│   │   │   ├── CharacterAvatar.tsx     # 角色头像
│   │   │   ├── DisambiguationModal.tsx # 角色消歧确认弹窗
│   │   │   ├── ConflictResolver.tsx    # 冲突解决组件
│   │   │   └── CostEstimateCard.tsx    # 成本预估卡片
│   │   ├── hooks/
│   │   │   ├── useGraph.ts
│   │   │   ├── useCharacter.ts
│   │   │   ├── useSnapshot.ts
│   │   │   ├── useTask.ts
│   │   │   ├── useAiConfig.ts
│   │   │   ├── useModels.ts
│   │   │   └── useCostEstimate.ts      # 成本预估
│   │   ├── services/
│   │   │   └── api.ts
│   │   ├── utils/
│   │   │   ├── graph-layout.ts
│   │   │   └── color-mapper.ts
│   │   ├── types/
│   │   └── styles/
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── output/                             # 运行时输出
│   └── snapshots/
├── logs/
├── docker-compose.yml                   # Neo4j + Redis + 后端 + 前端
├── .gitignore
└── README.md
```

## 部署

```bash
# 克隆项目
git clone https://github.com/yumeng001yu/ai-novel-character-graph.git
cd ai-novel-character-graph

# 启动所有服务（Neo4j + Redis + 后端 + 前端）
docker-compose up -d

# 访问
# 前端：http://localhost
# 后端 API：http://localhost:3001
# Neo4j 管理：http://localhost:7474
```

## License

MIT
