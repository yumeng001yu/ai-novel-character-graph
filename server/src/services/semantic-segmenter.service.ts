import { Chapter } from '../types';
import { callAI } from './ai-client.service';
import { getLogger } from '../utils/logger';
import { estimateTokens } from '../utils/token-counter';
import { v4 as uuid } from 'uuid';

const logger = getLogger();

export class SemanticSegmenterService {
  /**
   * 对无章节的小说进行语义分段
   */
  async segment(text: string, novelId: string, contextSize: number): Promise<Chapter[]> {
    const totalTokens = estimateTokens(text);
    const availableTokens = contextSize - 10000; // 预留提示词和输出

    // 如果全文不超过上下文，直接作为一段
    if (totalTokens <= availableTokens) {
      return [{
        id: uuid(),
        index: 1,
        title: '全文',
        startOffset: 0,
        charCount: text.replace(/\s/g, '').length,
        tokenCount: totalTokens,
        novelId,
      }];
    }

    // 按字数粗切，每段约4万字
    const chunkSize = Math.floor(availableTokens / 2.5); // 中文约2.5 token/字
    const rawChunks = this.roughSplit(text, chunkSize);

    // AI 精确切分：在每个粗切点附近找语义断点
    const segments: Chapter[] = [];
    let currentOffset = 0;

    for (let i = 0; i < rawChunks.length; i++) {
      const chunk = rawChunks[i];
      const startOffset = currentOffset;

      if (i < rawChunks.length - 1) {
        // 在粗切点附近找语义断点
        const boundary = await this.findSemanticBoundary(text, startOffset + chunk.length);
        const endOffset = boundary;
        const segmentText = text.substring(startOffset, endOffset);

        segments.push({
          id: uuid(),
          index: i + 1,
          title: `第${i + 1}段`,
          startOffset,
          charCount: segmentText.replace(/\s/g, '').length,
          tokenCount: estimateTokens(segmentText),
          novelId,
        });
        currentOffset = endOffset;
      } else {
        // 最后一段
        const segmentText = text.substring(startOffset);
        segments.push({
          id: uuid(),
          index: i + 1,
          title: `第${i + 1}段`,
          startOffset,
          charCount: segmentText.replace(/\s/g, '').length,
          tokenCount: estimateTokens(segmentText),
          novelId,
        });
      }
    }

    logger.info(`语义分段完成，共 ${segments.length} 段`);
    return segments;
  }

  private roughSplit(text: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.substring(i, i + chunkSize));
    }
    return chunks;
  }

  private async findSemanticBoundary(text: string, approximatePosition: number): Promise<number> {
    // 在近似位置前后2000字范围内找语义断点
    const searchStart = Math.max(0, approximatePosition - 2000);
    const searchEnd = Math.min(text.length, approximatePosition + 2000);
    const searchRange = text.substring(searchStart, searchEnd);

    const prompt = `在以下文本中，找到最合适的分段断点。分段应在场景转换、时间跳跃或人物变化处。

请返回断点在原文中的位置（字符偏移量，相对于这段文本的开头），如果找不到好的断点，返回-1。

文本：
${searchRange}`;

    try {
      const response = await callAI(prompt, '你是一个小说文本分析专家。');
      const match = response.match(/\d+/);
      if (match) {
        const offset = parseInt(match[0]);
        if (offset > 0 && offset < searchRange.length) {
          return searchStart + offset;
        }
      }
    } catch (err) {
      logger.warn(err, 'AI 语义断点查找失败，使用粗切点');
    }

    // 回退：在近似位置附近找段落分隔
    for (let i = approximatePosition; i < Math.min(text.length, approximatePosition + 1000); i++) {
      if (text[i] === '\n' && text[i + 1] === '\n') {
        return i;
      }
    }

    return approximatePosition;
  }
}

export const semanticSegmenterService = new SemanticSegmenterService();
