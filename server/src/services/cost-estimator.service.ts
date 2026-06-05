import { CostEstimate } from '../types';
import { chapterRepo } from '../repositories/neo4j/chapter.repo';
import { novelRepo } from '../repositories/neo4j/novel.repo';
import { estimateTokens } from '../utils/token-counter';
import { calculateAvailableInputTokens } from '../utils/token-counter';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config';

export class CostEstimatorService {
  async estimate(novelId: string): Promise<CostEstimate> {
    const novel = await novelRepo.findById(novelId);
    if (!novel) throw new Error('小说未找到');

    const chapters = await chapterRepo.findByNovelId(novelId);

    // 使用已存储的 tokenCount（如果有的话），否则用总 token 数按步均分
    const totalTokens = chapters.reduce(
      (sum, c) => sum + (c.tokenCount > 0 ? c.tokenCount : Math.ceil(c.charCount * 2.5)),
      0
    );

    // 每步约5次AI调用（提取人物、关系、事件、推断、档案更新）
    const callsPerStep = 5;
    const availableTokens = calculateAvailableInputTokens(novel.contextSize);
    const totalSteps = Math.max(1, Math.ceil(totalTokens / availableTokens));
    const estimatedCalls = totalSteps * callsPerStep;

    // 每步输入约可用Token的80%，输出约4000
    const avgInputPerStep = availableTokens * 0.8;
    const avgOutputPerStep = 4000;

    return {
      estimatedCalls,
      estimatedInputTokens: Math.round(avgInputPerStep * totalSteps),
      estimatedOutputTokens: avgOutputPerStep * totalSteps,
      estimatedTotalTokens: Math.round((avgInputPerStep + avgOutputPerStep) * totalSteps),
    };
  }

  estimateForStep(stepTokens: number): CostEstimate {
    const callsPerStep = 5;
    return {
      estimatedCalls: callsPerStep,
      estimatedInputTokens: Math.round(stepTokens * 0.8),
      estimatedOutputTokens: callsPerStep * 4000,
      estimatedTotalTokens: Math.round(stepTokens * 0.8 + callsPerStep * 4000),
    };
  }
}

export const costEstimatorService = new CostEstimatorService();
