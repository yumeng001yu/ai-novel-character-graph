import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { promptPresetRepo, MACRO_DEFINITIONS } from '../repositories/file/prompt-preset.repo';

export async function promptPresetRoutes(app: FastifyInstance) {
  // 获取所有预设列表
  app.get('/', async (req, reply) => {
    const presets = promptPresetRepo.list();
    reply.send(presets);
  });

  // 获取单个预设
  app.get('/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const preset = promptPresetRepo.findById(id);
    if (!preset) return reply.status(404).send({ error: '预设未找到' });
    reply.send(preset);
  });

  // 创建新预设
  app.post('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, basedOn } = req.body as { name: string; basedOn?: string };
    if (!name) return reply.status(400).send({ error: '缺少预设名称' });
    const preset = promptPresetRepo.create(name, basedOn);
    reply.send(preset);
  });

  // 更新预设
  app.put('/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const preset = promptPresetRepo.findById(id);
    if (!preset) return reply.status(404).send({ error: '预设未找到' });

    const data = req.body as any;
    // 不允许通过 API 修改 id 和 isDefault
    const updatableFields = [
      'name', 'systemPrompt', 'characterTemplate', 'behaviorGuidelines',
      'groupSystemPrompt', 'dialogueSystemPrompt', 'firstMessageSuffix', 'maxTokens',
    ];
    for (const field of updatableFields) {
      if (data[field] !== undefined) {
        (preset as any)[field] = data[field];
      }
    }

    promptPresetRepo.save(preset);
    reply.send(preset);
  });

  // 删除预设
  app.delete('/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const ok = promptPresetRepo.delete(id);
    if (!ok) return reply.status(400).send({ error: '无法删除（默认预设不可删除）' });
    reply.send({ success: true });
  });

  // 设为默认预设
  app.post('/:id/set-default', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const ok = promptPresetRepo.setDefault(id);
    if (!ok) return reply.status(404).send({ error: '预设未找到' });
    reply.send({ success: true });
  });

  // 获取宏变量列表
  app.get('/macros/list', async (req, reply) => {
    reply.send(MACRO_DEFINITIONS);
  });
}
