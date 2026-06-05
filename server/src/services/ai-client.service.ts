import OpenAI from 'openai';
import { aiSettingsRepo } from '../repositories/file/ai-settings.repo';
import { decrypt } from '../utils/crypto';
import { getLogger } from '../utils/logger';
import { getConfig } from '../config';

const logger = getLogger();

let openaiClient: OpenAI | null = null;
let currentConfigHash: string = '';

function hashConfig(apiUrl: string, apiKey: string, model: string): string {
  return `${apiUrl}:${apiKey}:${model}`;
}

export async function getOpenAIClient(): Promise<OpenAI> {
  const config = await aiSettingsRepo.load();
  if (!config) throw new Error('AI 配置未设置，请先在设置页面配置');

  const apiKey = decrypt(config.apiKeyEncrypted);
  const hash = hashConfig(config.apiUrl, apiKey, config.model);

  if (openaiClient && hash === currentConfigHash) {
    return openaiClient;
  }

  openaiClient = new OpenAI({
    apiKey,
    baseURL: config.apiUrl,
  });
  currentConfigHash = hash;
  return openaiClient;
}

export async function callAI(prompt: string, systemPrompt?: string, retries?: number): Promise<string> {
  const config = await aiSettingsRepo.load();
  if (!config) throw new Error('AI 配置未设置');

  const maxRetries = retries ?? getConfig().build.default_max_retries;
  const client = await getOpenAIClient();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const messages: any[] = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      const response = await client.chat.completions.create({
        model: config.model,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('AI 返回内容为空');
      return content;
    } catch (err: any) {
      lastError = err;
      const isRetryable = err.status === 429 || err.status === 500 || err.status === 502 || err.code === 'ECONNRESET';

      if (!isRetryable || attempt === maxRetries) {
        logger.error({ err, attempt }, 'AI 调用失败');
        throw err;
      }

      const delay = Math.pow(2, attempt - 1) * 1000; // 指数退避
      logger.warn({ attempt, delay, err: err.message }, 'AI 调用失败，重试中');
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export async function getModelList(apiUrl: string, apiKey: string): Promise<{ id: string; name: string; contextLength?: number; tags: string[] }[]> {
  // 自动补全 URL
  let url = apiUrl.trim().replace(/\/+$/, '');
  if (!url.endsWith('/v1') && !url.endsWith('/v1/models')) {
    url += '/v1';
  }
  if (!url.endsWith('/models')) {
    url += '/models';
  }

  const client = new OpenAI({ apiKey, baseURL: url.replace(/\/models$/, '') });
  const models = await client.models.list();

  const modelList: { id: string; name: string; contextLength?: number; tags: string[] }[] = [];
  for await (const model of models) {
    const tags: string[] = [];
    const id = model.id.toLowerCase();
    if (id.includes('128k') || id.includes('long') || id.includes('200k')) {
      tags.push('长上下文');
    }
    if (id.includes('gpt-4')) {
      tags.push('推荐');
    }
    modelList.push({ id: model.id, name: model.id, tags });
  }

  // 排序：推荐的在前
  modelList.sort((a, b) => {
    if (a.tags.includes('推荐') && !b.tags.includes('推荐')) return -1;
    if (!a.tags.includes('推荐') && b.tags.includes('推荐')) return 1;
    return a.id.localeCompare(b.id);
  });

  return modelList;
}

export async function testConnection(apiUrl: string, apiKey: string): Promise<{ success: boolean; message: string }> {
  try {
    const models = await getModelList(apiUrl, apiKey);
    return { success: true, message: `连接成功，发现 ${models.length} 个模型` };
  } catch (err: any) {
    return { success: false, message: `连接失败: ${err.message}` };
  }
}
