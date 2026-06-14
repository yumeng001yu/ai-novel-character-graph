import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { relationRepo } from '../repositories/neo4j/relation.repo';
import { snapshotService } from '../services/snapshot.service';

/**
 * BFS 查找从起点出发的完整连通分量
 * 返回所有通过关系路径可达的节点 ID 集合
 * 兼容两种边格式：Relation 用 sourceId/targetId，SnapshotEdge 用 source/target
 */
function findConnectedComponent(
  startId: string,
  edges: Array<{ sourceId?: string; targetId?: string; source?: string; target?: string }>,
): Set<string> {
  const visited = new Set<string>([startId]);
  const queue = [startId];

  // 构建邻接表
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const s = e.sourceId || e.source;
    const t = e.targetId || e.target;
    if (!s || !t) continue;
    if (!adjacency.has(s)) adjacency.set(s, []);
    if (!adjacency.has(t)) adjacency.set(t, []);
    adjacency.get(s)!.push(t);
    adjacency.get(t)!.push(s);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adjacency.get(current) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return visited;
}

/**
 * 将角色数据精简为图谱节点所需的字段（排除 profile/keyTraits/embedding 等大字段）
 */
function toGraphNode(c: any) {
  return {
    id: c.id,
    name: c.name,
    aliases: c.aliases,
    gender: c.gender,
    faction: c.faction,
    identity: c.identity,
    isProtagonist: c.isProtagonist,
    firstAppearChapter: c.firstAppearChapter,
  };
}

/**
 * 将关系数据精简为图谱边所需的字段
 */
function toGraphEdge(r: any) {
  return {
    source: r.sourceId || r.source,
    target: r.targetId || r.target,
    sourceName: r.sourceName,
    targetName: r.targetName,
    relationType: r.relationType,
    sinceChapter: r.sinceChapter,
    untilChapter: r.untilChapter,
    strength: r.strength,
    confidence: r.confidence,
    importance: r.importance,
    isInference: r.isInference,
    description: r.description,
  };
}

export async function graphRoutes(app: FastifyInstance) {
  // 获取图谱（核心逻辑，同时支持 GET 和 POST）
  const handleGetGraph = async (id: string, center: string | undefined, step: string | undefined, reply: FastifyReply) => {
    if (step) {
      // 获取指定步的快照
      const snapshot = await snapshotService.loadSnapshot(id, parseInt(step));
      if (!snapshot) return reply.status(404).send({ error: '快照未找到' });

      // 确定中心节点：指定 center 或主角
      let centerNode = null;
      if (center) {
        centerNode = snapshot.nodes.find((n: any) =>
          n.id === center || n.name === center || n.aliases?.includes(center)
        );
        // 模糊匹配：名称包含搜索词
        if (!centerNode) {
          const lowerCenter = center.toLowerCase();
          centerNode = snapshot.nodes.find((n: any) =>
            n.name?.toLowerCase().includes(lowerCenter) ||
            n.aliases?.some((a: string) => a.toLowerCase().includes(lowerCenter))
          );
        }
      }
      if (!centerNode) {
        // 默认使用主角
        centerNode = snapshot.nodes.find((n: any) => n.isProtagonist);
      }

      if (centerNode) {
        // BFS 找到完整连通分量
        const connectedIds = findConnectedComponent(centerNode.id, snapshot.edges);
        const filteredNodes = snapshot.nodes.filter((n: any) => connectedIds.has(n.id));
        const filteredEdges = snapshot.edges.filter((e: any) =>
          connectedIds.has(e.source || e.sourceId) && connectedIds.has(e.target || e.targetId)
        );
        return reply.send({ nodes: filteredNodes, edges: filteredEdges, centerId: centerNode.id, centerFound: !!center });
      }

      return reply.send(snapshot);
    }

    // 获取最新图谱
    const characters = await characterRepo.findByNovelId(id);
    const relations = await relationRepo.findByNovelId(id);

    // 确定中心角色：指定 center 或主角
    let centerChar = null;
    if (center) {
      centerChar = characters.find(c =>
        c.id === center || c.name === center || c.aliases?.includes(center)
      );
      // 模糊匹配：名称包含搜索词
      if (!centerChar) {
        const lowerCenter = center.toLowerCase();
        centerChar = characters.find(c =>
          c.name?.toLowerCase().includes(lowerCenter) ||
          c.aliases?.some((a: string) => a.toLowerCase().includes(lowerCenter))
        );
      }
    }
    if (!centerChar) {
      // 默认使用第一个主角
      centerChar = characters.find(c => c.isProtagonist);
    }

    if (centerChar) {
      // BFS 找到完整连通分量：所有通过关系路径可达的角色
      const connectedIds = findConnectedComponent(centerChar.id, relations);
      const filteredChars = characters.filter(c => connectedIds.has(c.id));
      const filteredRels = relations.filter(r =>
        connectedIds.has(r.sourceId) && connectedIds.has(r.targetId)
      );
      return reply.send({
        nodes: filteredChars.map(toGraphNode),
        edges: filteredRels.map(toGraphEdge),
        centerId: centerChar.id,
        centerFound: !!center,
      });
    }

    // 没有主角也没有指定中心，返回全部（兜底）
    reply.send({
      nodes: characters.map(toGraphNode),
      edges: relations.map(toGraphEdge),
    });
  };

  app.get('/:id/graph', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    const { center, step } = req.query as any;
    await handleGetGraph(id, center, step, reply);
  });

  app.post('/:id/graph', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    const { center, step } = req.body as any;
    await handleGetGraph(id, center, step ? String(step) : undefined, reply);
  });
}
