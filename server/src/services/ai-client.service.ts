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

  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  const clientOptions: any = {
    apiKey,
    baseURL: config.apiUrl,
  };
  if (proxyUrl) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { HttpsProxyAgent } = require('https-proxy-agent');
    clientOptions.httpAgent = new HttpsProxyAgent(proxyUrl);
  }
  openaiClient = new OpenAI(clientOptions);
  currentConfigHash = hash;
  return openaiClient;
}

/** 截断文本，避免日志过大 */
function truncate(text: string, maxLen: number = 2000): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + `...（共${text.length}字，已截断）`;
}

/**
 * 剥离 AI 模型的思维链（thinking）输出
 * 部分模型（如 MiniMax-M2.7、DeepSeek-R1）会在 content 中输出 <think/> 标签包裹的思维过程
 * 需要在解析 JSON 之前将其移除，否则会导致 JSON 解析失败
 */
function stripThinkingContent(content: string): string {
  // 移除 <think...</think > 标签及其内容（支持多行）
  let cleaned = content.replace(/<think[\s\S]*?<\/think\s*>/g, '');
  // 移除未闭合的 <think...> 标签到内容开头（某些模型只输出 <think > 开头）
  cleaned = cleaned.replace(/<think[^>]*>[\s\S]*/, (match) => {
    // 如果匹配内容中包含 JSON 结构，保留 JSON 部分
    const jsonStart = match.search(/[\[{]/);
    if (jsonStart > 0) {
      return match.substring(jsonStart);
    }
    return '';
  });
  return cleaned.trim();
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

      // 剥离思维链内容
      const cleanContent = stripThinkingContent(content);
      if (!cleanContent) throw new Error('AI 返回内容为空（剥离思维链后）');

      // 检测 AI 内容审核拒绝
      const finishReason = response.choices[0]?.finish_reason;
      if (finishReason === 'content_filter') {
        throw new AIContentRefusedError('AI 模型内容审核过滤，该段文本可能包含被屏蔽的内容');
      }

      const refusalField = (response.choices[0]?.message as any)?.refusal;
      if (refusalField) {
        throw new AIContentRefusedError(`AI 模型拒绝处理：${refusalField}`);
      }

      const contentRefused = detectContentRefusal(cleanContent);
      if (contentRefused) {
        throw new AIContentRefusedError(contentRefused);
      }

      // 记录成功日志
      logEntry.response = truncate(cleanContent);
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

      return cleanContent;
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
 *
 * 支持两种调用方式：
 * 1. prompt 为字符串：传统方式，systemPrompt 作为 system 消息
 * 2. prompt 为消息数组：直接传入消息列表，忽略 systemPrompt
 */
export async function callAIStream(
  prompt: string | Array<{ role: string; content: string; name?: string }>,
  systemPrompt?: string,
  options?: {
    retries?: number;
    onStream?: AIStreamCallback;
    phase?: string;
    maxTokens?: number;
  },
): Promise<string> {
  const config = await aiSettingsRepo.load();
  if (!config) throw new Error('AI 配置未设置');

  const maxRetries = options?.retries ?? getConfig().build.default_max_retries;
  const effectiveMaxTokens = options?.maxTokens ?? config.maxTokens;
  const client = await getOpenAIClient();
  const onStream = options?.onStream;
  const phase = options?.phase || 'unknown';
  let lastError: Error | null = null;

  // 构建消息列表
  const buildMessageList = (): any[] => {
    if (typeof prompt === 'string') {
      const messages: any[] = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });
      return messages;
    } else {
      // prompt 是消息数组，直接使用
      return prompt.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
      }));
    }
  };

  const promptDesc = typeof prompt === 'string'
    ? truncate(prompt)
    : truncate(prompt.map(m => `${m.role}: ${m.content}`).join('\n'));

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const logId = uuid();
    const startTime = Date.now();

    // 推送 start 事件
    if (onStream) {
      onStream({
        logId,
        type: 'start',
        phase,
        prompt: promptDesc,
        systemPrompt: systemPrompt ? truncate(systemPrompt, 500) : undefined,
      });
    }

    try {
      const messages = buildMessageList();

      // 流式调用（stream_options 仅部分 API 支持，失败时回退到不带该参数）
      let stream: any;
      try {
        stream = await client.chat.completions.create({
          model: config.model,
          messages,
          temperature: config.temperature,
          max_tokens: effectiveMaxTokens,
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
            max_tokens: effectiveMaxTokens,
            stream: true,
          });
        } else {
          throw streamErr;
        }
      }

      let fullContent = '';
      let inThinkingBlock = false;
      let thinkingBuffer = '';

      // 起始缓冲区：积累初始内容以检测和清除格式问题
      // （如思维链后的单字前缀、前导空白/空行）
      let startBuffer = '';
      let startBufferFlushed = false;
      const START_BUFFER_MIN = 8; // 最少非空白字符数才开始刷新

      /** 刷新起始缓冲区，清除格式问题后推送 */
      const flushStartBuffer = () => {
        if (startBufferFlushed || !onStream) return;
        let cleaned = startBuffer.replace(/^\s+/, '');
        // 如果第一行只有1个字符就换行，说明是前缀/语气词，跳过
        const firstNewline = cleaned.search(/\n/);
        if (firstNewline === 1) {
          cleaned = cleaned.substring(2).replace(/^\s+/, '');
        }
        if (cleaned) {
          onStream({ logId, type: 'delta', phase, delta: cleaned });
        }
        startBuffer = '';
        startBufferFlushed = true;
      };

      /** 发送内容或缓冲（起始缓冲区未刷新时） */
      const sendOrBuffer = (content: string) => {
        if (!content || !onStream) return;
        if (!startBufferFlushed) {
          startBuffer += content;
          if (startBuffer.replace(/\s/g, '').length >= START_BUFFER_MIN) {
            flushStartBuffer();
          }
        } else {
          onStream({ logId, type: 'delta', phase, delta: content });
        }
      };

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullContent += delta;

          // 流式过滤思维链：<think...> 到 </think > 之间的内容不推送给前端
          if (!inThinkingBlock) {
            thinkingBuffer += delta;
            const thinkStart = thinkingBuffer.indexOf('<think');
            if (thinkStart !== -1) {
              inThinkingBlock = true;
              const beforeThink = thinkingBuffer.substring(0, thinkStart);
              if (beforeThink.trim()) {
                sendOrBuffer(beforeThink);
              }
              thinkingBuffer = thinkingBuffer.substring(thinkStart);
            } else {
              const safeLen = Math.max(0, thinkingBuffer.length - 6);
              if (safeLen > 0) {
                const toSend = thinkingBuffer.substring(0, safeLen);
                sendOrBuffer(toSend);
                thinkingBuffer = thinkingBuffer.substring(safeLen);
              }
            }
          } else {
            thinkingBuffer += delta;
            const thinkEnd = thinkingBuffer.indexOf('</think');
            if (thinkEnd !== -1) {
              inThinkingBlock = false;
              const afterThink = thinkingBuffer.substring(thinkEnd);
              const closeTagEnd = afterThink.indexOf('>');
              if (closeTagEnd !== -1) {
                const remainder = afterThink.substring(closeTagEnd + 1);
                thinkingBuffer = '';
                if (remainder) {
                  sendOrBuffer(remainder);
                }
              } else {
                thinkingBuffer = '';
              }
            }
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

      // 刷新剩余的思维缓冲区
      if (thinkingBuffer && !inThinkingBlock) {
        sendOrBuffer(thinkingBuffer);
        thinkingBuffer = '';
      }

      // 刷新起始缓冲区（如果尚未刷新）
      if (!startBufferFlushed && startBuffer) {
        flushStartBuffer();
      }

      if (!fullContent) throw new Error('AI 返回内容为空');

      // 剥离思维链内容（确保 fullContent 不含 <think/> 标签）
      const cleanContent = stripThinkingContent(fullContent);
      if (!cleanContent) throw new Error('AI 返回内容为空（剥离思维链后）');

      // 检测内容审核拒绝
      const contentRefused = detectContentRefusal(cleanContent);
      if (contentRefused) {
        throw new AIContentRefusedError(contentRefused);
      }

      // 推送 done 事件
      if (onStream) {
        onStream({
          logId,
          type: 'done',
          phase,
          fullResponse: truncate(cleanContent),
          duration: Date.now() - startTime,
          retryCount: attempt - 1,
        });
      }

      return cleanContent;
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

  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  const clientOpts: any = { apiKey, baseURL: url.replace(/\/models$/, '') };
  if (proxyUrl) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { HttpsProxyAgent } = require('https-proxy-agent');
    clientOpts.httpAgent = new HttpsProxyAgent(proxyUrl);
  }
  const client = new OpenAI(clientOpts);
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
