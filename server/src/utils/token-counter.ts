import { getLogger } from './logger';

// 简单的Token估算，中文约2~3 token/字
// 后续可集成 tiktoken 做精确计数
const CHINESE_TOKEN_RATIO = 2.5;
const ENGLISH_TOKEN_RATIO = 1.3;

export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code > 0x4e00 && code < 0x9fff) {
      // 中文字符
      tokens += CHINESE_TOKEN_RATIO;
    } else if (code >= 33 && code <= 126) {
      // ASCII 可见字符
      tokens += 1 / ENGLISH_TOKEN_RATIO;
    } else {
      tokens += 1;
    }
  }
  return Math.ceil(tokens);
}

export function calculateAvailableInputTokens(
  contextSize: number,
  promptTokens: number = 2000,
  reservedOutputTokens: number = 8000
): number {
  return contextSize - promptTokens - reservedOutputTokens;
}
