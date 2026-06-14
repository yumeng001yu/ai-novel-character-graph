import { FastifyInstance } from 'fastify';
import { novelRoutes } from './novel.route';
import { graphRoutes } from './graph.route';
import { characterRoutes } from './character.route';
import { snapshotRoutes } from './snapshot.route';
import { taskRoutes } from './task.route';
import { continueRoutes } from './continue.route';
import { settingsRoutes } from './settings.route';
import { exportRoutes } from './export.route';
import { graphragRoutes } from './graphrag.route';
import { knowledgeBaseRoutes } from './knowledge-base.route';
import { characterChatRoutes } from './character-chat.route';
import { promptPresetRoutes } from './prompt-preset.route';

export function registerRoutes(app: FastifyInstance): void {
  // 健康检查（轻量，不查数据库）
  app.get('/api/health', async () => ({ status: 'ok' }));

  // 设置路由（独立前缀，无动态参数冲突）
  app.register(settingsRoutes, { prefix: '/api/settings' });

  // 角色路由（独立前缀）
  app.register(characterRoutes, { prefix: '/api/characters' });

  // 小说相关路由（注意：静态路径必须在动态路由之前注册）
  // 每个 route 文件内部需确保静态路径（如 /upload, /text-paste）在动态路径（如 /:id）之前
  app.register(novelRoutes, { prefix: '/api/novels' });
  app.register(graphRoutes, { prefix: '/api/novels' });
  app.register(snapshotRoutes, { prefix: '/api/novels' });
  app.register(taskRoutes, { prefix: '/api/novels' });
  app.register(continueRoutes, { prefix: '/api/novels' });
  app.register(exportRoutes, { prefix: '/api/novels' });

  // GraphRAG 查询路由
  app.register(graphragRoutes, { prefix: '/api/graphrag' });

  // 知识库路由
  app.register(knowledgeBaseRoutes, { prefix: '/api/knowledge-base' });

  // 角色对话路由
  app.register(characterChatRoutes, { prefix: '/api/character-chat' });

  // 提示词预设路由
  app.register(promptPresetRoutes, { prefix: '/api/prompt-presets' });
}
