import OpenAI from 'openai';
import { aiSettingsRepo } from '../repositories/file/ai-settings.repo';
import { decrypt } from '../utils/crypto';
import { getLogger } from '../utils/logger';
import { getConfig } from '../config';
import { AIContentRefusedError, AILogEntry, AIStreamEvent } from '../types';
import { v4 as uuid } from 'uuid';

const logger = getLogger();

/** AI 流式事件回调函数类型 */
export type AIStreamCallback = (event: AIStreamEvent) => void;

/** AI 调用回调函数类型，用于实时推送 AI 交互详情 */
export type AICallCallback = (log: AILogEntry) => void;

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

/** 截断文本，避免日志过大 */
function truncate(text: string, maxLen: number = 2000): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + `...（共${text.length}字，已截断）`;
}

export interface CallAIOptions {
  /** 重试次数 */
  retries?: number;
  /** AI 调用回调，用于实时推送 AI 交互详情 */
  onAICall?: AICallCallback;
  /** 当前阶段标识 */
  phase?: string;
}

export async function callAI(prompt: string, systemPrompt?: string, retries?: number): Promise<string>;
export async function callAI(prompt: string, systemPrompt?: string, options?: CallAIOptions): Promise<string>;
export async function callAI(
  prompt: string,
  systemPrompt?: string,
  retriesOrOptions?: number | CallAIOptions,
): Promise<string> {
  // 兼容旧调用方式
  let retries: number | undefined;
  let onAICall: AICallCallback | undefined;
  let phase: string | undefined;

  if (typeof retriesOrOptions === 'number') {
    retries = retriesOrOptions;
  } else if (retriesOrOptions) {
    retries = retriesOrOptions.retries;
    onAICall = retriesOrOptions.onAICall;
    phase = retriesOrOptions.phase;
  }

  const config = await aiSettingsRepo.load();
  if (!config) throw new Error('AI 配置未设置');

  const maxRetries = retries ?? getConfig().build.default_max_retries;
  const client = await getOpenAIClient();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const startTime = Date.now();
    const logEntry: AILogEntry = {
      id: uuid(),
      timestamp: new Date().toISOString(),
      phase: phase || 'unknown',
      prompt: truncate(prompt),
      systemPrompt: systemPrompt ? truncate(systemPrompt, 500) : undefined,
      response: '',
      retryCount: attempt - 1,
    };

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

      // 检测 AI 内容审核拒绝
      const finishReason = response.choices[0]?.finish_reason;
      if (finishReason === 'content_filter') {
        throw new AIContentRefusedError('AI 模型内容审核过滤，该段文本可能包含被屏蔽的内容');
      }

      const refusalField = (response.choices[0]?.message as any)?.refusal;
      if (refusalField) {
        throw new AIContentRefusedError(`AI 模型拒绝处理：${refusalField}`);
      }

      const contentRefused = detectContentRefusal(content);
      if (contentRefused) {
        throw new AIContentRefusedError(contentRefused);
      }

      // 记录成功日志
      logEntry.response = truncate(content);
      logEntry.duration = Date.now() - startTime;
      const usage = response.usage;
      if (usage) {
        logEntry.tokenUsage = {
          input: usage.prompt_tokens,
          output: usage.completion_tokens,
          total: usage.total_tokens,
        };
      }

      // 回调通知
      if (onAICall) {
        onAICall(logEntry);
      }

      return content;
    } catch (err: any) {
      lastError = err;

      // 记录错误日志
      logEntry.error = err.message || String(err);
      logEntry.duration = Date.now() - startTime;
      if (onAICall) {
        onAICall(logEntry);
      }

      // AI 内容审核拒绝不可重试，直接抛出
      if (err instanceof AIContentRefusedError) {
        throw err;
      }

      const isRetryable = err.status === 429 || err.status === 500 || err.status === 502 || err.code === 'ECONNRESET';

      if (!isRetryable || attempt === maxRetries) {
        logger.error({ err, attempt }, 'AI 调用失败');
        throw err;
      }

      const delay = Math.pow(2, attempt - 1) * 1000;
      logger.warn({ attempt, delay, err: err.message }, 'AI 调用失败，重试中');
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * 流式调用 AI，逐字推送输出到前端
 * 返回完整响应文本（与 callAI 接口一致），但过程中通过 onStream 回调实时推送增量
 */
export async function callAIStream(
  prompt: string,
  systemPrompt?: string,
  options?: {
    retries?: number;
    onStream?: AIStreamCallback;
    phase?: string;
  },
): Promise<string> {
  const config = await aiSettingsRepo.load();
  if (!config) throw new Error('AI 配置未设置');

  const maxRetries = options?.retries ?? getConfig().build.default_max_retries;
  const client = await getOpenAIClient();
  const onStream = options?.onStream;
  const phase = options?.phase || 'unknown';
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const logId = uuid();
    const startTime = Date.now();

    // 推送 start 事件
    if (onStream) {
      onStream({
        logId,
        type: 'start',
        phase,
        prompt: truncate(prompt),
        systemPrompt: systemPrompt ? truncate(systemPrompt, 500) : undefined,
      });
    }

    try {
      const messages: any[] = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      // 流式调用（stream_options 仅部分 API 支持，失败时回退到不带该参数）
      let stream;
      try {
        stream = await client.chat.completions.create({
          model: config.model,
          messages,
          temperature: config.temperature,
          max_tokens: config.maxTokens,
          stream: true,
          stream_options: { include_usage: true },
        });
      } catch (streamErr: any) {
        // 不支持 stream_options 的 API，回退到普通流式调用
        if (streamErr.status === 400 || streamErr.status === 422 || streamErr.code === 'invalid_request_error') {
          stream = await client.chat.completions.create({
            model: config.model,
            messages,
            temperature: config.temperature,
            max_tokens: config.maxTokens,
            stream: true,
          });
        } else {
          throw streamErr;
        }
      }

      let fullContent = '';

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          // 推送 delta 事件
          if (onStream) {
            onStream({
              logId,
              type: 'delta',
              phase,
              delta,
            });
          }
        }

        // 检测内容审核
        const finishReason = chunk.choices[0]?.finish_reason;
        if (finishReason === 'content_filter') {
          throw new AIContentRefusedError('AI 模型内容审核过滤，该段文本可能包含被屏蔽的内容');
        }
        // 检测 refusal 字段（OpenAI 格式）
        const refusalField = (chunk.choices[0]?.delta as any)?.refusal;
        if (refusalField) {
          throw new AIContentRefusedError(`AI 模型拒绝处理：${refusalField}`);
        }
      }

      if (!fullContent) throw new Error('AI 返回内容为空');

      // 检测内容审核拒绝
      const contentRefused = detectContentRefusal(fullContent);
      if (contentRefused) {
        throw new AIContentRefusedError(contentRefused);
      }

      // 推送 done 事件
      if (onStream) {
        onStream({
          logId,
          type: 'done',
          phase,
          fullResponse: truncate(fullContent),
          duration: Date.now() - startTime,
          retryCount: attempt - 1,
        });
      }

      return fullContent;
    } catch (err: any) {
      lastError = err;

      // 推送错误事件
      if (onStream) {
        onStream({
          logId,
          type: 'done',
          phase,
          error: err.message || String(err),
          duration: Date.now() - startTime,
          retryCount: attempt - 1,
        });
      }

      if (err instanceof AIContentRefusedError) {
        throw err;
      }

      const isRetryable = err.status === 429 || err.status === 500 || err.status === 502 || err.code === 'ECONNRESET';
      if (!isRetryable || attempt === maxRetries) {
        logger.error({ err, attempt }, 'AI 流式调用失败');
        throw err;
      }

      const delay = Math.pow(2, attempt - 1) * 1000;
      logger.warn({ attempt, delay, err: err.message }, 'AI 流式调用失败，重试中');
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * 检测 AI 返回文本中的内容审核拒绝模式
 * 不同模型/服务商的拒绝格式不同，需要覆盖多种情况
 */
function detectContentRefusal(content: string): string | null {
  const trimmed = content.trim();

  // 常见拒绝模式（中英文）
  const refusalPatterns = [
    // OpenAI 风格
    /I('m| am) (unable|sorry|not able) to (process|complete|fulfill|assist|help|provide|generate|create)/i,
    /I (cannot|can't|won't) (process|complete|fulfill|assist|help|provide|generate|create)/i,
    /I (must|have to) (decline|refuse|reject)/i,
    /this (request|content|text|material) (violates|goes against|is against|breaks)/i,
    /content (policy|guideline|standard|filter|flag)/i,
    /safety (policy|guideline|standard|concern|filter)/i,
    /inappropriate (content|material|text)/i,
    /I('ve| have) been (trained|programmed|designed) not to/i,
    /not (appropriate|suitable|allowed|permitted) (for|to)/i,
    /against my (guidelines|policy|rules|terms)/i,

    // 中文拒绝模式
    /我(无法|不能|不可以|没法|暂时无法|暂时不能)(处理|完成|提供|生成|创建|协助|帮助|回答)/,
    /该(内容|文本|材料|请求)(违反|不符合|超出|触发了)(内容|安全|审核|社区)(政策|准则|规范|标准|策略)/,
    /内容(审核|安全|合规)(不通过|未通过|被拦截|被过滤|被屏蔽)/,
    /涉及(不良|敏感|违规|不当|有害)(信息|内容|材料)/,
    /抱歉.*?(无法|不能|不可以)(处理|完成|提供|生成|协助)/,
    /根据.*?(政策|准则|规范|规定|要求).*?(无法|不能|拒绝)/,
    /已被(屏蔽|过滤|拦截|阻止)/,

    // 通用模式：返回的是准则/声明而非 JSON
    /^(?!.*[\[{]).*(?:policy|guideline|standard|准则|规范|政策|声明).*(?:cannot|unable|无法|不能)/is,
  ];

  for (const pattern of refusalPatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      return `AI 模型内容审核拒绝：${trimmed.substring(0, 200)}`;
    }
  }

  // 额外检测：如果返回内容很短且不包含任何 JSON 结构，可能是拒绝
  // （正常的提取结果应包含 JSON）
  if (trimmed.length < 50 && !trimmed.includes('{') && !trimmed.includes('[')) {
    const shortRefusalKeywords = [
      'refused', 'rejected', 'blocked', 'filtered', 'flagged',
      '拒绝', '屏蔽', '过滤', '拦截', '无法处理', '不能处理',
    ];
    for (const keyword of shortRefusalKeywords) {
      if (trimmed.toLowerCase().includes(keyword)) {
        return `AI 模型内容审核拒绝：${trimmed}`;
      }
    }
  }

  return null;
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
