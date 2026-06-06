import { Chapter, Step } from '../types';
import { calculateAvailableInputTokens } from '../utils/token-counter';
import { getLogger } from '../utils/logger';
import { v4 as uuid } from 'uuid';

const logger = getLogger();

export class StepPlannerService {
  /**
   * 根据章节和上下文大小，贪心划分步
   */
  planSteps(chapters: Chapter[], contextSize: number): Step[] {
    const availableTokens = calculateAvailableInputTokens(contextSize);
    const steps: Step[] = [];
    let currentStepChapters: Chapter[] = [];
    let currentStepTokens = 0;

    for (const chapter of chapters) {
      const chapterTokens = chapter.tokenCount;

      if (currentStepTokens + chapterTokens > availableTokens && currentStepChapters.length > 0) {
        // 加入此章会超限，当前步截止
        steps.push(this.createStep(steps.length + 1, currentStepChapters));
        currentStepChapters = [chapter];
        currentStepTokens = chapterTokens;
      } else {
        currentStepChapters.push(chapter);
        currentStepTokens += chapterTokens;
      }
    }

    // 最后一步
    if (currentStepChapters.length > 0) {
      steps.push(this.createStep(steps.length + 1, currentStepChapters));
    }

    logger.info(`步划分完成：${chapters.length} 章 → ${steps.length} 步`);
    return steps;
  }

  private createStep(stepNumber: number, chapters: Chapter[]): Step {
    const firstChapter = chapters[0].index;
    const lastChapter = chapters[chapters.length - 1].index;
    const totalTokens = chapters.reduce((sum, c) => sum + (c.tokenCount || 0), 0);
    const totalChars = chapters.reduce((sum, c) => sum + c.charCount, 0);

    return {
      stepNumber,
      chaptersRange: firstChapter === lastChapter
        ? `第${firstChapter}章`
        : `第${firstChapter}~${lastChapter}章`,
      totalTokens,
      totalChars,
      status: 'pending',
      novelId: chapters[0].novelId,
    };
  }

  /**
   * 计算文本粘贴模式的步信息
   */
  planTextPasteStep(tokenCount: number, charCount: number, novelId: string): Step {
    return {
      stepNumber: 1,
      chaptersRange: '文本粘贴',
      totalTokens: tokenCount,
      totalChars: charCount,
      status: 'pending',
      novelId,
    };
  }
}

export const stepPlannerService = new StepPlannerService();
