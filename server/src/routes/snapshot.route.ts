import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { snapshotService } from '../services/snapshot.service';

export async function snapshotRoutes(app: FastifyInstance) {
  // 快照列表
  app.get('/:id/snapshots', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    const snapshots = await snapshotService.listSnapshots(id);
    reply.send(snapshots);
  });

  // 某步快照
  app.get('/:id/snapshots/:step', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id, step } = req.params as any;
    const snapshot = await snapshotService.loadSnapshot(id, parseInt(step));
    if (!snapshot) return reply.status(404).send({ error: '快照未找到' });
    reply.send(snapshot);
  });

  // 快照差异
  app.get('/:id/snapshots/:step/diff', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id, step } = req.params as any;
    const diff = await snapshotService.getDiff(id, parseInt(step));
    if (!diff) return reply.status(404).send({ error: '快照未找到' });
    reply.send(diff);
  });
}
