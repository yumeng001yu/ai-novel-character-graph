import { CostEstimate } from '../types';
import { chapterRepo } from '../repositories/neo4j/chapter.repo';
import { novelRepo } from '../repositories/neo4j/novel.repo';
import { estimateTokens } from '../utils/token-counter';

export class CostEstimatorService {
  async estimate(novelId: string): Promise<CostEstimate> {
    const novel = await novelRepo.findById(novelId);
    if (!novel) throw new Error('小说未找到');

    const chapters = await chapterRepo.findByNovelId(novelId);
    const totalTokens = chapters.reduce((sum, c) => sum + (c.tokenCount || estimateTokens('x'.repeat(c.charCount))), 0);

    // 每步约5次AI调用（提取人物、关系、事件、推断、档案更新）
    const callsPerStep = 5;
    const availableTokens = novel.contextSize - 10000; // 减去提示词和输出预留
    const totalSteps = Math.ceil(totalTokens / availableTokens);
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
