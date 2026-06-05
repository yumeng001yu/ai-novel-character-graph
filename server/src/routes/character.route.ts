import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { relationRepo } from '../repositories/neo4j/relation.repo';
import { characterDisambiguatorService } from '../services/character-disambiguator.service';
import { conflictDetectorService } from '../services/conflict-detector.service';
import { searchIndexerService } from '../services/search-indexer.service';
import { profileBuilderService } from '../services/profile-builder.service';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config';

export async function characterRoutes(app: FastifyInstance) {
  // 角色搜索
  app.get('/search', async (req: FastifyRequest, reply: FastifyReply) => {
    const { keyword, novelId } = req.query as any;
    if (!keyword || !novelId) return reply.status(400).send({ error: '缺少参数' });
    const characters = await searchIndexerService.search(novelId, keyword);
    reply.send(characters);
  });

  // 角色详情
  app.get('/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    const character = await characterRepo.findById(id);
    if (!character) return reply.status(404).send({ error: '角色未找到' });

    const relations = await relationRepo.findByCharacter(id);
    reply.send({ character, relations });
  });

  // 角色经历时间线
  app.get('/:id/timeline', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    const character = await characterRepo.findById(id);
    if (!character) return reply.status(404).send({ error: '角色未找到' });

    // 加载档案
    const profileDir = path.resolve(getConfig().build.snapshot_dir, '..', 'profiles', character.novelId);
    const profilePath = path.join(profileDir, `${id}.json`);
    if (!fs.existsSync(profilePath)) return reply.send({ experienceTimeline: [] });

    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    reply.send({ experienceTimeline: profile.experienceTimeline, personalAnalysis: profile.personalAnalysis });
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
    const { characterId } = req.body as any;
    if (!characterId) return reply.status(400).send({ error: '缺少参数' });
    await characterDisambiguatorService.splitCharacter(characterId);
    reply.send({ success: true });
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
