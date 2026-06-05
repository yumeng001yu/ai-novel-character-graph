# AI 小说角色图谱

AI 驱动的小说角色关系图谱构建工具 —— 自动解析小说文本，逐步构建人物关系图谱，支持角色搜索、经历回溯、推断标注与图谱演变回放。

## 功能概览

- **三种输入模式**：上传有章节 TXT / 上传无章节 TXT / 手动粘贴文本
- **智能章节识别**：AI 自动识别章节边界，无章节小说按语义自动分段
- **增量图谱构建**：每步 ≤ 5 万字，多章节聚合为一步，保证 AI 理解准确性
- **角色档案**：每个角色维护独立档案（基本信息、经历时间线、个人解析、推断标注）
- **推断标注**：对作者未明说之处进行小幅度推断，统一标注 `[推断]` 并记录依据
- **继承续建**：支持分批上传，自动检测重复内容，去重后继续构建
- **快照回放**：每步生成独立快照，支持时间轴步进查看图谱演变
- **中途取消 & 事后回退**：构建过程中可取消，完成后可回退到任意步
- **角色搜索**：搜索任意角色，以该角色为中心展示关系图，查看角色详情
- **AI 模型前端配置**：用户在界面配置 OpenAI 兼容 API 地址、Key、选择模型

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
│  └─ 文本粘贴  → 字数校验(≤5万) → 直接作为一步    │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│  逐步构建图谱（核心循环）                        │
│                                               │
│  for each step:                               │
│    1. 拼接该步所有章节原文                       │
│    2. AI 提取人物/关系/事件/推断                 │
│    3. 与上一步图谱增量合并到 Neo4j               │
│    4. 更新涉及角色的个人档案                     │
│    5. 保存本步快照                              │
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
│  └─ 角色详情：经历时间线 + 个人解析 + 推断        │
└─────────────────────────────────────────────┘
```

### 步划分规则

多个章节聚合为一步，总字数 ≤ 5 万字。当加入下一章节会超过 5 万字时，当前步在该章节之前截止。

```
示例：小说共30章，每章约4000字

第1步：第1章~第12章（48000字，加入第13章=52000 > 50000，截止）
第2步：第13章~第24章（48000字，加入第25章=52000 > 50000，截止）
第3步：第25章~第30章（24000字，剩余章节不足5万，结束）
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
5. 保存配置

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

## 数据模型（Neo4j）

### 节点类型

| 标签 | 属性 | 说明 |
|------|------|------|
| `Novel` | id, name, total_chars, input_mode, current_step | 小说 |
| `Chapter` | index, title, start_offset, char_count | 章节（含虚拟章节） |
| `Step` | step_number, chapters_range, total_chars, status | 步 |
| `Character` | id, name, aliases[], gender, faction, identity, first_appear_chapter, is_protagonist | 角色 |
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
| `RELATES_TO` | Character → Character | relation_type, since_chapter, strength, is_inference, inference_basis | 角色间关系 |
| `HAPPENS_IN` | Event → Chapter | — | 事件发生章节 |

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
| GET | `/api/characters/:id` | 角色详情（含档案） |
| GET | `/api/characters/:id/timeline` | 角色经历时间线 |
| GET | `/api/characters/search` | 角色搜索（支持别名模糊匹配） |
| GET | `/api/settings/ai` | 获取当前 AI 配置（Key 脱敏） |
| PUT | `/api/settings/ai` | 保存 AI 配置 |
| POST | `/api/settings/ai/test` | 测试 AI 连接 |
| POST | `/api/settings/ai/models` | 获取可用模型列表 |

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
│   │   │   └── settings.route.ts
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
│   │   │   └── settings.service.ts
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
│   │   │   └── duplicate-check.prompt.ts
│   │   ├── utils/
│   │   │   ├── text-splitter.ts
│   │   │   ├── fingerprint.ts
│   │   │   ├── crypto.ts
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
│   │   │   ├── Character/              # 角色页：搜索 + 详情
│   │   │   ├── Continue/               # 续建页
│   │   │   ├── Task/                   # 任务页：进度 + 日志
│   │   │   └── Settings/               # 设置页：AI 模型配置
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── utils/
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
