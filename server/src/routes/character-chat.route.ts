import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { characterChatService } from '../services/character-chat.service';
import { characterRepo } from '../repositories/neo4j/character.repo';

interface ChatBody {
  characterIds: string[];
  novelId: string;
  mode: 'chat' | 'group' | 'dialogue';
  message?: string;
  topic?: string;
  history?: Array<{ role: string; content: string; name?: string }>;
}

export async function characterChatRoutes(app: FastifyInstance) {
  // 与角色对话，支持 SSE 流式输出
  app.post('/chat', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as ChatBody;
    const { characterIds, novelId, mode, message, topic, history } = body;

    if (!characterIds || !Array.isArray(characterIds) || characterIds.length === 0) {
      return reply.status(400).send({ error: '缺少 characterIds' });
    }
    if (!novelId) {
      return reply.status(400).send({ error: '缺少 novelId' });
    }
    if (!mode || !['chat', 'group', 'dialogue'].includes(mode)) {
      return reply.status(400).send({ error: 'mode 必须为 chat、group 或 dialogue' });
    }
    if ((mode === 'chat' || mode === 'group') && !message) {
      return reply.status(400).send({ error: 'chat/group 模式需要 message' });
    }
    if (mode === 'dialogue' && !topic) {
      return reply.status(400).send({ error: 'dialogue 模式需要 topic' });
    }

    // SSE 流式响应
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    try {
      const result = await characterChatService.chat({
        characterIds,
        novelId,
        mode,
        message,
        topic,
        history: history ?? [],
      }, (event: any) => {
        if (event.type === 'delta' || event.type === 'done' || event.type === 'error') {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      });

      // 如果有最终结果但没通过流式发送，发送完成事件
      if (result) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      }
    } catch (err: any) {
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: err.message || '对话服务异常' })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });

  // 获取小说下已构建图谱的角色列表
  app.get('/characters/:novelId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { novelId } = req.params as { novelId: string };
    if (!novelId) {
      return reply.status(400).send({ error: '缺少 novelId' });
    }

    const characters = await characterRepo.findByNovelId(novelId);
    const result = characters.map(c => ({
      id: c.id,
      name: c.name,
      aliases: c.aliases,
      identity: (c as any).identity,
      faction: (c as any).faction,
    }));

    reply.send(result);
  });
}
