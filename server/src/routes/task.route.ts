import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { taskManagerService } from '../services/task-manager.service';
import { rollbackService } from '../services/rollback.service';
import { costEstimatorService } from '../services/cost-estimator.service';
import { novelRepo } from '../repositories/neo4j/novel.repo';

export async function taskRoutes(app: FastifyInstance) {
  // 启动构建
  app.post('/:id/build', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    try {
      await taskManagerService.startBuild(id);
      reply.send({ success: true, message: '构建任务已启动' });
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  // 中途取消
  app.post('/:id/cancel', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    try {
      await taskManagerService.cancelBuild(id);
      reply.send({ success: true, message: '取消请求已发送' });
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  // 回退
  app.post('/:id/rollback', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    const { targetStep } = req.body as any;
    const novel = await novelRepo.findById(id);
    if (!novel) return reply.status(404).send({ error: '小说未找到' });
    await rollbackService.rollback(id, targetStep, novel.currentStep);
    await novelRepo.updateStep(id, targetStep, novel.totalSteps);
    reply.send({ success: true, currentStep: targetStep });
  });

  // 撤销回退
  app.post('/:id/rollback/:step/undo', async (req: FastifyRequest, reply: FastifyReply) => {
    // 简化：重新加载快照
    reply.send({ success: true, message: '撤销回退功能需要配合快照恢复' });
  });

  // 构建进度（SSE）
  app.get('/:id/progress', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // 轮询进度
    const interval = setInterval(async () => {
      const progress = await taskManagerService.getProgress(id);
      const task = await taskManagerService.getTaskStatus(id);

      reply.raw.write(`data: ${JSON.stringify({ progress, task })}\n\n`);

      if (task && (task.status === 'completed' || task.status === 'failed' || task.status === 'canceled')) {
        clearInterval(interval);
        reply.raw.end();
      }
    }, 2000);

    req.raw.on('close', () => clearInterval(interval));
  });

  // 成本预估
  app.get('/:id/cost-estimate', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    try {
      const estimate = await costEstimatorService.estimate(id);
      reply.send(estimate);
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });
}
