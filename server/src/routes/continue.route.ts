import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { duplicateDetectorService } from '../services/duplicate-detector.service';
import { decodeBuffer } from '../utils/encoding-detector';

export async function continueRoutes(app: FastifyInstance) {
  // 续建前检查
  app.get('/:id/continue/check', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    // 返回已有图谱信息，供前端展示
    reply.send({ novelId: id, message: '请上传续建文件或粘贴文本' });
  });

  // 续建 - 上传文件
  app.post('/:id/continue/upload', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: '未上传文件' });

    const buffer = await data.toBuffer();
    const text = decodeBuffer(buffer);

    // 检测重复
    const duplicateResult = await duplicateDetectorService.detectDuplicate(id, text);

    reply.send({
      novelId: id,
      totalChars: text.length,
      duplicateEndOffset: duplicateResult.duplicateEndOffset,
      matchRatio: duplicateResult.matchRatio,
      newTextStart: duplicateResult.duplicateEndOffset,
    });
  });

  // 续建 - 文本粘贴
  app.post('/:id/continue/paste', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    const { content } = req.body as any;
    if (!content) return reply.status(400).send({ error: '内容不能为空' });

    const duplicateResult = await duplicateDetectorService.detectDuplicate(id, content);

    reply.send({
      novelId: id,
      totalChars: content.length,
      duplicateEndOffset: duplicateResult.duplicateEndOffset,
      matchRatio: duplicateResult.matchRatio,
      newTextStart: duplicateResult.duplicateEndOffset,
    });
  });
}
