import { computeTextFingerprint, findDuplicateBoundary } from '../utils/fingerprint';
import { textSegmentRepo } from '../repositories/neo4j/text-segment.repo';
import { callAI } from './ai-client.service';
import { getLogger } from '../utils/logger';

const logger = getLogger();

export class DuplicateDetectorService {
  /**
   * 检测新文本与已有文本的重复部分
   * 返回重复结束位置（字符偏移），0表示无重复
   */
  async detectDuplicate(novelId: string, newText: string): Promise<{ duplicateEndOffset: number; matchRatio: number }> {
    // 获取已有文本指纹
    const existingFingerprints = await textSegmentRepo.getFingerprints(novelId);

    if (existingFingerprints.length === 0) {
      return { duplicateEndOffset: 0, matchRatio: 0 };
    }

    // 计算新文本指纹
    const newFingerprints = computeTextFingerprint(newText);

    // 第一层：指纹粗筛
    const { duplicateEndIndex, matchLength } = findDuplicateBoundary(existingFingerprints, newFingerprints);

    if (matchLength === 0) {
      return { duplicateEndOffset: 0, matchRatio: 0 };
    }

    // 第二层：AI 语义确认
    const boundary = await this.aiConfirmBoundary(newText, duplicateEndIndex);

    const matchRatio = matchLength / newFingerprints.length;
    logger.info(`重复检测：指纹匹配 ${matchLength} 段，比例 ${(matchRatio * 100).toFixed(1)}%，精确边界 ${boundary}`);

    return { duplicateEndOffset: boundary, matchRatio };
  }

  private async aiConfirmBoundary(text: string, approximateOffset: number): Promise<number> {
    const searchStart = Math.max(0, approximateOffset - 1000);
    const searchEnd = Math.min(text.length, approximateOffset + 1000);
    const searchRange = text.substring(searchStart, searchEnd);

    const prompt = `以下文本是新旧文本的交界区域。请判断重复内容在哪里结束，返回重复结束位置相对于这段文本开头的字符偏移量。

文本：
${searchRange}`;

    try {
      const response = await callAI(prompt, '你是文本比对专家。只返回数字。');
      const match = response.match(/\d+/);
      if (match) {
        const offset = parseInt(match[0]);
        if (offset > 0 && offset < searchRange.length) {
          return searchStart + offset;
        }
      }
    } catch (err) {
      logger.warn(err, 'AI 重复边界确认失败');
    }

    return approximateOffset;
  }
}

export const duplicateDetectorService = new DuplicateDetectorService();
