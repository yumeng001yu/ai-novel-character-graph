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

      // 如果指定了中心角色，过滤快照数据
      if (center) {
        const centerNode = snapshot.nodes.find((n: any) =>
          n.id === center || n.name === center || n.aliases?.includes(center)
        );
        if (centerNode) {
          const relatedIds = new Set<string>([centerNode.id]);
          snapshot.edges.forEach((e: any) => {
            if (e.source === centerNode.id) relatedIds.add(e.target);
            if (e.target === centerNode.id) relatedIds.add(e.source);
          });
          const filteredNodes = snapshot.nodes.filter((n: any) => relatedIds.has(n.id));
          const filteredEdges = snapshot.edges.filter((e: any) =>
            relatedIds.has(e.source) && relatedIds.has(e.target)
          );
          return reply.send({ nodes: filteredNodes, edges: filteredEdges, centerId: centerNode.id });
        }
      }

      return reply.send(snapshot);
    }

    // 获取最新图谱
    const characters = await characterRepo.findByNovelId(id);
    const relations = await relationRepo.findByNovelId(id);

    // 如果指定中心角色，支持按 ID 或名字搜索
    if (center) {
      const centerChar = characters.find(c =>
        c.id === center || c.name === center || c.aliases?.includes(center)
      );
      if (centerChar) {
        const relatedIds = new Set<string>([centerChar.id]);
        relations.forEach(r => {
          if (r.sourceId === centerChar.id) relatedIds.add(r.targetId);
          if (r.targetId === centerChar.id) relatedIds.add(r.sourceId);
        });
        const filteredChars = characters.filter(c => relatedIds.has(c.id));
        const filteredRels = relations.filter(r =>
          relatedIds.has(r.sourceId) && relatedIds.has(r.targetId)
        );
        return reply.send({ nodes: filteredChars, edges: filteredRels, centerId: centerChar.id });
      }
    }

    reply.send({ nodes: characters, edges: relations });
  });
}
