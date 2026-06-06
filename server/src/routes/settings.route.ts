import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { settingsService } from '../services/settings.service';
import { getModelList, testConnection } from '../services/ai-client.service';

export async function settingsRoutes(app: FastifyInstance) {
  // 获取 AI 配置
  app.get('/ai', async (req, reply) => {
    const config = await settingsService.getAiConfig();
    reply.send(config || { configured: false });
  });

  // 保存 AI 配置
  app.put('/ai', async (req: FastifyRequest, reply: FastifyReply) => {
    const data = req.body as any;
    if (!data.apiUrl || !data.model) {
      return reply.status(400).send({ error: '缺少必要参数' });
    }
    await settingsService.saveAiConfig(data);
    reply.send({ success: true });
  });

  // 测试连接
  app.post('/ai/test', async (req: FastifyRequest, reply: FastifyReply) => {
    const { apiUrl, apiKey } = req.body as any;
    if (!apiUrl || !apiKey) return reply.status(400).send({ error: '缺少参数' });
    const result = await testConnection(apiUrl, apiKey);
    reply.send(result);
  });

  // 获取模型列表
  app.post('/ai/models', async (req: FastifyRequest, reply: FastifyReply) => {
    const { apiUrl, apiKey } = req.body as any;
    if (!apiUrl || !apiKey) return reply.status(400).send({ error: '缺少参数' });
    try {
      const models = await getModelList(apiUrl, apiKey);
      reply.send({ models });
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  // 获取构建配置
  app.get('/build', async (req, reply) => {
    const config = settingsService.getBuildConfig();
    reply.send(config);
  });

  // 保存构建配置
  app.put('/build', async (req: FastifyRequest, reply: FastifyReply) => {
    const config = settingsService.saveBuildConfig(req.body as any);
    reply.send(config);
  });
}
