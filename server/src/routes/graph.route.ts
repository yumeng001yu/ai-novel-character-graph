import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { relationRepo } from '../repositories/neo4j/relation.repo';
import { snapshotService } from '../services/snapshot.service';

export async function graphRoutes(app: FastifyInstance) {
  // 获取图谱
  app.get('/:id/graph', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    const { center, step } = req.query as any;

    if (step) {
      // 获取指定步的快照
      const snapshot = await snapshotService.loadSnapshot(id, parseInt(step));
      if (!snapshot) return reply.status(404).send({ error: '快照未找到' });
      return reply.send(snapshot);
    }

    // 获取最新图谱
    const characters = await characterRepo.findByNovelId(id);
    const relations = await relationRepo.findByNovelId(id);

    // 如果指定中心角色，过滤相关节点
    if (center) {
      const centerChar = characters.find(c => c.id === center || c.name === center);
      if (centerChar) {
        const relatedIds = new Set<string>([centerChar.id]);
        relations.forEach(r => {
          if (r.sourceId === centerChar.id) relatedIds.add(r.targetId);
          if (r.targetId === centerChar.id) relatedIds.add(r.sourceId);
        });
        const filteredChars = characters.filter(c => relatedIds.has(c.id));
        const filteredRels = relations.filter(r => relatedIds.has(r.sourceId) && relatedIds.has(r.targetId));
        return reply.send({ nodes: filteredChars, edges: filteredRels, centerId: centerChar.id });
      }
    }

    reply.send({ nodes: characters, edges: relations });
  });
}
