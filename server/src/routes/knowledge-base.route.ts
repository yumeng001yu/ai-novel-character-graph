import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { novelRepo } from '../repositories/neo4j/novel.repo';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { relationRepo } from '../repositories/neo4j/relation.repo';
import { taskQueueRepo } from '../repositories/redis/task-queue.repo';
import { vectorSearchService } from '../services/vector-search.service';
import { embeddingService } from '../services/embedding.service';
import { getLogger } from '../utils/logger';

const logger = getLogger();

export async function knowledgeBaseRoutes(app: FastifyInstance) {
  // 搜索知识库
  app.get('/search', async (req: FastifyRequest, reply: FastifyReply) => {
    const { q } = req.query as any;
    if (!q) {
      return reply.status(400).send({ error: '搜索关键词不能为空' });
    }

    const novels = await novelRepo.findAll();
    const results: Array<{
      id: string;
      name: string;
      graphBuilt: boolean;
      characterCount: number;
      buildStatus: string;
    }> = [];

    for (const novel of novels) {
      // 搜索小说名匹配
      const nameMatch = novel.name.includes(q);

      // 搜索角色名/别名匹配
      let characterMatch = false;
      const characters = await characterRepo.findByNovelId(novel.id);
      for (const char of characters as any[]) {
        if (char.name?.includes(q) || char.aliases?.some((a: string) => a.includes(q))) {
          characterMatch = true;
          break;
        }
      }

      if (!nameMatch && !characterMatch) continue;

      const task = await taskQueueRepo.getTask(novel.id);
      results.push({
        id: novel.id,
        name: novel.name,
        graphBuilt: characters.length > 0,
        characterCount: characters.length,
        buildStatus: task?.status || 'pending',
      });
    }

    // 如果配置了 Embedding，还做语义搜索
    if (await embeddingService.isConfigured()) {
      try {
        for (const novel of novels) {
          // 跳过已匹配的
          if (results.some(r => r.id === novel.id)) continue;

          const semanticResults = await vectorSearchService.semanticSearch(novel.id, q, 3);
          if (semanticResults.length > 0 && semanticResults[0].score > 0.7) {
            const characters = await characterRepo.findByNovelId(novel.id);
            const task = await taskQueueRepo.getTask(novel.id);
            results.push({
              id: novel.id,
              name: novel.name,
              graphBuilt: characters.length > 0,
              characterCount: characters.length,
              buildStatus: task?.status || 'pending',
            });
          }
        }
      } catch (err) {
        logger.warn(err, '语义搜索失败（非致命）');
      }
    }

    reply.send({ novels: results });
  });

  // 获取所有小说列表（带统计信息）
  app.get('/', async (req, reply) => {
    const novels = await novelRepo.findAll();
    const result = [];

    for (const novel of novels) {
      const characters = await characterRepo.findByNovelId(novel.id);
      const relations = await relationRepo.findByNovelId(novel.id);
      const task = await taskQueueRepo.getTask(novel.id);

      result.push({
        id: novel.id,
        name: novel.name,
        totalChars: novel.totalChars,
        graphBuilt: characters.length > 0,
        characterCount: characters.length,
        relationCount: relations.length,
        buildStatus: task?.status || 'pending',
        totalTokens: novel.totalTokens,
        createdAt: novel.createdAt,
      });
    }

    reply.send({ novels: result });
  });
}
