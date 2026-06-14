import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { relationRepo } from '../repositories/neo4j/relation.repo';
import { characterDisambiguatorService } from '../services/character-disambiguator.service';
import { conflictDetectorService } from '../services/conflict-detector.service';
import { searchIndexerService } from '../services/search-indexer.service';
import { profileBuilderService } from '../services/profile-builder.service';
import { embeddingService } from '../services/embedding.service';
import { vectorSearchService } from '../services/vector-search.service';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config';

export async function characterRoutes(app: FastifyInstance) {
  // 角色搜索（支持语义搜索，同时支持 GET 和 POST）
  const handleSearch = async (keyword: string, novelId: string, reply: FastifyReply) => {
    if (!keyword || !novelId) return reply.status(400).send({ error: '缺少参数' });

    // 先尝试语义搜索
    if (await embeddingService.isConfigured()) {
      const semanticResults = await vectorSearchService.semanticSearch(novelId, keyword);
      if (semanticResults.length > 0) {
        // 补充完整角色信息（排除 embedding 等大字段）
        const characters = [];
        for (const r of semanticResults) {
          const char = await characterRepo.findById(r.id);
          if (char) {
            const { embedding, ...rest } = char as any;
            characters.push({ ...rest, searchScore: r.score });
          }
        }
        if (characters.length > 0) {
          reply.send(characters);
          return;
        }
      }
    }

    // 回退到关键词搜索
    const characters = await searchIndexerService.search(novelId, keyword);
    // 排除 embedding 等大字段
    reply.send(characters.map((c: any) => {
      const { embedding, ...rest } = c;
      return rest;
    }));
  };

  app.get('/search', async (req: FastifyRequest, reply: FastifyReply) => {
    const { keyword, novelId } = req.query as any;
    await handleSearch(keyword, novelId, reply);
  });

  app.post('/search', async (req: FastifyRequest, reply: FastifyReply) => {
    const { keyword, novelId } = req.body as any;
    await handleSearch(keyword, novelId, reply);
  });

  // 角色详情
  app.get('/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    const character = await characterRepo.findById(id);
    if (!character) return reply.status(404).send({ error: '角色未找到' });

    const { embedding, ...charRest } = character as any;
    const relations = await relationRepo.findByCharacter(id);
    reply.send({ character: charRest, relations });
  });

  // 角色经历时间线（含关系变化）
  app.get('/:id/timeline', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    const character = await characterRepo.findById(id);
    if (!character) return reply.status(404).send({ error: '角色未找到' });

    // 安全校验：验证 novelId 格式（uuid）
    if (!/^[a-f0-9-]+$/.test(character.novelId)) {
      return reply.status(400).send({ error: '无效的小说ID' });
    }
    const profileDir = path.resolve(getConfig().build.snapshot_dir, '..', 'profiles', character.novelId);
    const profilePath = path.join(profileDir, `${id}.json`);

    let experienceTimeline: any[] = [];
    let personalAnalysis: any = null;

    if (fs.existsSync(profilePath)) {
      const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
      experienceTimeline = profile.experienceTimeline || [];
      personalAnalysis = profile.personalAnalysis || null;
    }

    // 获取关系变化时间线（按 sinceChapter 排序）
    const relations = await relationRepo.findByCharacter(id);
    const relationTimeline = relations
      .sort((a, b) => a.sinceChapter - b.sinceChapter)
      .map(r => {
        const otherName = r.sourceId === id ? r.targetName : r.sourceName;
        return {
          chapter: r.sinceChapter,
          type: '关系变化' as const,
          event: `与${otherName || '未知'}建立${r.relationType}关系`,
          detail: r.description,
          relationType: r.relationType,
          withCharacter: otherName,
          confidence: r.confidence,
          importance: r.importance,
          isInference: r.isInference,
        };
      });

    // 合并经历和关系时间线，按章节排序
    const mergedTimeline = [
      ...experienceTimeline.map((e: any) => ({ ...e, type: e.type || '经历' })),
      ...relationTimeline,
    ].sort((a, b) => (a.chapter || 0) - (b.chapter || 0));

    reply.send({
      character: {
        id: character.id,
        name: character.name,
        aliases: character.aliases,
        gender: character.gender,
        faction: character.faction,
        identity: character.identity,
        isProtagonist: character.isProtagonist,
        profile: (character as any).profile,
        keyTraits: (character as any).keyTraits,
      },
      experienceTimeline: mergedTimeline,
      personalAnalysis,
      totalEvents: experienceTimeline.length,
      totalRelations: relations.length,
    });
  });

  // 角色合并
  app.post('/merge', async (req: FastifyRequest, reply: FastifyReply) => {
    const { characterIds, primaryId } = req.body as any;
    if (!characterIds || !primaryId) return reply.status(400).send({ error: '缺少参数' });
    await characterDisambiguatorService.mergeCharacters(primaryId, characterIds.filter((id: string) => id !== primaryId));
    reply.send({ success: true });
  });

  // 角色拆分
  app.post('/split', async (req: FastifyRequest, reply: FastifyReply) => {
    const { characterId, splitInfo } = req.body as any;
    if (!characterId) return reply.status(400).send({ error: '缺少 characterId' });
    if (!splitInfo || !Array.isArray(splitInfo) || splitInfo.length === 0) {
      return reply.status(400).send({ error: '缺少 splitInfo（拆分信息数组，每项包含 name 和 aliases）' });
    }
    const newCharacters = await characterDisambiguatorService.splitCharacter(characterId, splitInfo);
    reply.send({ success: true, newCharacters });
  });

  // 冲突列表
  app.get('/conflicts', async (req: FastifyRequest, reply: FastifyReply) => {
    const { novelId } = req.query as any;
    if (!novelId) return reply.status(400).send({ error: '缺少 novelId' });
    const attributeConflicts = await conflictDetectorService.detectAttributeConflicts(novelId);
    const relationConflicts = await conflictDetectorService.detectRelationConflicts(novelId);
    reply.send([...attributeConflicts, ...relationConflicts]);
  });

  // 解决冲突
  app.post('/conflicts/:id/resolve', async (req: FastifyRequest, reply: FastifyReply) => {
    const { resolvedValue } = req.body as any;
    // 简化处理：记录解决结果
    reply.send({ success: true, resolvedValue });
  });
}
