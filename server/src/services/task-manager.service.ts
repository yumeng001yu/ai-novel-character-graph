import { BuildTask, TaskStatus, StepProgress } from '../types';
import { taskQueueRepo } from '../repositories/redis/task-queue.repo';
import { progressRepo } from '../repositories/redis/progress.repo';
import { novelRepo } from '../repositories/neo4j/novel.repo';
import { chapterRepo } from '../repositories/neo4j/chapter.repo';
import { chapterParserService } from './chapter-parser.service';
import { semanticSegmenterService } from './semantic-segmenter.service';
import { stepPlannerService } from './step-planner.service';
import { extractorService } from './extractor.service';
import { mergerService } from './merger.service';
import { characterDisambiguatorService } from './character-disambiguator.service';
import { conflictDetectorService } from './conflict-detector.service';
import { profileBuilderService } from './profile-builder.service';
import { protagonistDetectorService } from './protagonist-detector.service';
import { snapshotService } from './snapshot.service';
import { searchIndexerService } from './search-indexer.service';
import { rollbackService } from './rollback.service';
import { settingsService } from './settings.service';
import { getLogger } from '../utils/logger';
import { readFileWithEncoding } from '../utils/encoding-detector';
import { estimateTokens } from '../utils/token-counter';

const logger = getLogger();

export class TaskManagerService {
  /**
   * 启动构建任务
   */
  async startBuild(novelId: string): Promise<void> {
    // 检查是否已有运行中的任务
    const existing = await taskQueueRepo.getTask(novelId);
    if (existing && existing.status === 'running') {
      throw new Error('已有构建任务运行中');
    }

    // 检查 AI 配置
    const isConfigured = await settingsService.isAiConfigured();
    if (!isConfigured) {
      throw new Error('请先配置 AI 模型');
    }

    const novel = await novelRepo.findById(novelId);
    if (!novel) throw new Error('小说未找到');

    // 创建任务
    const task: BuildTask = {
      novelId,
      status: 'running',
      currentStep: 0,
      totalSteps: 0,
      startedAt: new Date().toISOString(),
    };
    await taskQueueRepo.setTask(novelId, task);

    // 异步执行构建
    this.executeBuild(novelId).catch(err => {
      logger.error(err, '构建任务失败');
      taskQueueRepo.updateStatus(novelId, 'failed');
    });
  }

  private async executeBuild(novelId: string): Promise<void> {
    const novel = await novelRepo.findById(novelId);
    if (!novel) return;

    const buildConfig = settingsService.getBuildConfig();

    // 阶段1：章节识别（如果是有章节模式）
    let chapters = await chapterRepo.findByNovelId(novelId);

    // 阶段2：步划分
    const steps = stepPlannerService.planSteps(chapters, novel.contextSize);
    const totalSteps = steps.length;

    await novelRepo.updateStep(novelId, 0, totalSteps);
    await taskQueueRepo.updateProgress(novelId, 0);

    // 阶段3：逐步构建
    for (let i = 0; i < steps.length; i++) {
      // 检查是否取消
      const task = await taskQueueRepo.getTask(novelId);
      if (task?.status === 'canceling') {
        await rollbackService.rollback(novelId, i, i + 1);
        await taskQueueRepo.updateStatus(novelId, 'canceled');
        return;
      }

      const step = steps[i];
      const stepChapters = chapters.filter(c => {
        const range = step.chaptersRange;
        const match = range.match(/第(\d+)[~—]*(\d*)章/);
        if (match) {
          const start = parseInt(match[1]);
          const end = match[2] ? parseInt(match[2]) : start;
          return c.index >= start && c.index <= end;
        }
        return false;
      });

      // 拼接本步原文
      // 注意：实际需要从文件读取，这里简化处理
      const stepText = `[步骤${i + 1}文本内容]`;

      // 更新进度
      await progressRepo.setProgress(novelId, {
        stepNumber: i + 1,
        phase: 'extracting',
        message: `正在提取第${i + 1}步的人物关系...`,
      });

      // AI 提取
      const existingChars = (await characterRepo.findByNovelId(novelId)).map(c => c.name);
      const extraction = await extractorService.extractFromText(stepText, step.chaptersRange, existingChars);

      // 角色消歧
      await progressRepo.setProgress(novelId, {
        stepNumber: i + 1,
        phase: 'disambiguating',
        message: '正在检测角色消歧...',
      });
      const disambiguations = await characterDisambiguatorService.detectDisambiguations(novelId);

      // 增量合并
      await progressRepo.setProgress(novelId, {
        stepNumber: i + 1,
        phase: 'merging',
        message: '正在合并图谱数据...',
      });
      const mergeResult = await mergerService.merge(novelId, i + 1, extraction, stepChapters[0]?.index || 1);

      // 冲突检测
      await progressRepo.setProgress(novelId, {
        stepNumber: i + 1,
        phase: 'conflict_detecting',
        message: '正在检测冲突...',
      });
      const conflicts = await conflictDetectorService.detectAttributeConflicts(novelId);

      // 更新角色档案
      await progressRepo.setProgress(novelId, {
        stepNumber: i + 1,
        phase: 'profile_updating',
        message: '正在更新角色档案...',
      });
      for (const char of mergeResult.newCharacters) {
        await profileBuilderService.updateProfile(char.id, novelId, stepText, step.chaptersRange);
      }

      // 保存快照
      await progressRepo.setProgress(novelId, {
        stepNumber: i + 1,
        phase: 'snapshot_saving',
        message: '正在保存快照...',
      });
      await snapshotService.saveSnapshot(novelId, i + 1, stepChapters.map(c => c.index));

      // 更新步数
      await novelRepo.updateStep(novelId, i + 1, totalSteps);
      await taskQueueRepo.updateProgress(novelId, i + 1);
    }

    // 阶段4：主角识别
    await protagonistDetectorService.detectProtagonists(novelId);

    // 阶段5：搜索索引
    await searchIndexerService.buildIndex(novelId);

    // 完成
    await taskQueueRepo.updateStatus(novelId, 'completed');
    logger.info(`构建任务完成：${novelId}`);
  }

  async cancelBuild(novelId: string): Promise<void> {
    const task = await taskQueueRepo.getTask(novelId);
    if (!task || task.status !== 'running') {
      throw new Error('没有运行中的构建任务');
    }
    await taskQueueRepo.updateStatus(novelId, 'canceling');
  }

  async getTaskStatus(novelId: string): Promise<BuildTask | null> {
    return taskQueueRepo.getTask(novelId);
  }

  async getProgress(novelId: string): Promise<StepProgress | null> {
    return progressRepo.getProgress(novelId);
  }
}

export const taskManagerService = new TaskManagerService();
