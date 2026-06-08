import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { graphragService } from '../services/graphrag.service';
import { getLogger } from '../utils/logger';

const logger = getLogger();

export async function graphragRoutes(app: FastifyInstance) {
  // GraphRAG 查询（支持 SSE 流式响应）
  app.post('/:novelId/query', async (req: FastifyRequest, reply: FastifyReply) => {
    const { novelId } = req.params as any;
    const { question, stream } = req.body as any;

    if (!question) {
      return reply.status(400).send({ error: '问题不能为空' });
    }

    if (stream) {
      // SSE 流式响应
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      try {
        const onStream = (event: any) => {
          if (event.type === 'delta' && event.delta) {
            reply.raw.write(`data: ${JSON.stringify({ type: 'delta', delta: event.delta })}\n\n`);
          }
        };

        const result = await graphragService.query(novelId, question, onStream);

        // 发送完成事件，包含来源信息
        reply.raw.write(`data: ${JSON.stringify({ type: 'done', sources: result.sources })}\n\n`);
        reply.raw.end();
      } catch (err: any) {
        logger.error(err, 'GraphRAG 查询失败');
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        reply.raw.end();
      }
    } else {
      // 非流式响应
      try {
        const result = await graphragService.query(novelId, question);
        reply.send(result);
      } catch (err: any) {
        logger.error(err, 'GraphRAG 查询失败');
        reply.status(500).send({ error: err.message });
      }
    }
  });
}
