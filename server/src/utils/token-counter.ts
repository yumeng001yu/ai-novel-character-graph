import { encoding_for_model, TiktokenModel } from 'tiktoken';
import { getLogger } from './logger';

const logger = getLogger();

// 缓存编码器，避免重复初始化
let cachedEncoder: ReturnType<typeof encoding_for_model> | null = null;
let cachedModel: string = '';

/**
 * 获取或创建 tiktoken 编码器
 * 默认使用 cl100k_base（GPT-4/GPT-3.5-turbo 通用编码）
 */
function getEncoder(modelName: string = 'cl100k_base'): ReturnType<typeof encoding_for_model> {
  if (cachedEncoder && cachedModel === modelName) {
    return cachedEncoder;
  }
  try {
    cachedEncoder = encoding_for_model(modelName as TiktokenModel);
    cachedModel = modelName;
    logger.info(`tiktoken 编码器已加载：${modelName}`);
    return cachedEncoder!;
  } catch (err) {
    logger.warn(`tiktoken 加载模型 ${modelName} 失败，回退到 cl100k_base`);
    if (modelName !== 'cl100k_base') {
      return getEncoder('cl100k_base');
    }
    throw err;
  }
}

/**
 * 使用 tiktoken 精确计算文本的 Token 数量
 * @param text 要计算的文本
 * @param model 模型名称（决定使用的编码器），默认 cl100k_base（兼容 GPT-4/3.5-turbo）
 */
export function estimateTokens(text: string, model: string = 'cl100k_base'): number {
  try {
    const encoder = getEncoder(model);
    const tokens = encoder.encode(text);
    return tokens.length;
  } catch (err) {
    // tiktoken 完全不可用时，回退到粗略估算
    logger.warn('tiktoken 计算失败，使用粗略估算');
    return fallbackEstimateTokens(text);
  }
}

/**
 * 批量计算多个文本的 Token 数量（复用编码器，性能更好）
 */
export function estimateTokensBatch(texts: string[], model: string = 'cl100k_base'): number[] {
  try {
    const encoder = getEncoder(model);
    return texts.map(t => encoder.encode(t).length);
  } catch (err) {
    logger.warn('tiktoken 批量计算失败，使用粗略估算');
    return texts.map(t => fallbackEstimateTokens(t));
  }
}

/**
 * 计算可用输入 Token 数
 * @param contextSize 模型上下文大小
 * @param promptTokens 提示词占用的 Token 数
 * @param reservedOutputTokens 预留给输出的 Token 数
 */
export function calculateAvailableInputTokens(
  contextSize: number,
  promptTokens: number = 2000,
  reservedOutputTokens: number = 8000
): number {
  return contextSize - promptTokens - reservedOutputTokens;
}

/**
 * 根据模型名称获取推荐的编码器名称
 */
export function getEncodingForModel(modelId: string): string {
  const lower = modelId.toLowerCase();
  
  // GPT-4o / GPT-4o-mini 使用 o200k_base
  if (lower.includes('gpt-4o') || lower.includes('o1-') || lower.includes('o3-') || lower.includes('o4-')) {
    return 'o200k_base';
  }
  
  // GPT-4 系列（非 4o）使用 cl100k_base
  if (lower.includes('gpt-4') || lower.includes('gpt-3.5')) {
    return 'cl100k_base';
  }
  
  // DeepSeek 系列使用 cl100k_base（兼容）
  if (lower.includes('deepseek')) {
    return 'cl100k_base';
  }
  
  // 默认使用 cl100k_base
  return 'cl100k_base';
}

// ===== 回退的粗略估算（仅当 tiktoken 不可用时）=====
function fallbackEstimateTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code > 0x4e00 && code < 0x9fff) {
      // 中文字符在 tiktoken 中通常为 2~3 token
      tokens += 2.5;
    } else if (code >= 33 && code <= 126) {
      // ASCII 可见字符
      tokens += 0.25; // 约 4 字符/token
    } else {
      tokens += 0.8;
    }
  }
  return Math.ceil(tokens);
}
