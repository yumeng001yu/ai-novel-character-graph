import { BuildTask, TaskStatus, StepProgress, AIContentRefusedError, AIStreamEvent } from '../types';
import { taskQueueRepo } from '../repositories/redis/task-queue.repo';
import { progressRepo } from '../repositories/redis/progress.repo';
import { novelRepo } from '../repositories/neo4j/novel.repo';
import { chapterRepo } from '../repositories/neo4j/chapter.repo';
import { characterRepo } from '../repositories/neo4j/character.repo';
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
import { AIStreamCallback } from './ai-client.service';
import { getLogger } from '../utils/logger';
import { estimateTokens, getEncodingForModel } from '../utils/token-counter';
import { getConfig } from '../config';
import fs from 'fs';
import path from 'path';

const logger = getLogger();

/**
 * 获取小说原文文件路径
 */
function getNovelTextPath(novelId: string): string {
  // 安全校验：防止路径遍历
  if (novelId.includes('/') || novelId.includes('\\') || novelId.includes('..')) {
    throw new Error('无效的小说ID');
  }
  return path.resolve(getConfig().build.snapshot_dir, '..', 'novels', novelId, 'original.txt');
}

/**
 * 读取小说原文
 */
function readNovelText(novelId: string): string {
  const filePath = getNovelTextPath(novelId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`小说原文文件不存在: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}

export class TaskManagerService {
  /**
   * 创建 AI 流式回调函数，将 AI 交互详情实时推送到 SSE
   */
  private createAIStreamCallback(novelId: string): AIStreamCallback {
    return (event: AIStreamEvent) => {
      // 实时推送 AI 流式事件到 SSE
      progressRepo.publishAIStream(novelId, event).catch(err => {
        logger.warn({ err }, '推送 AI 流式事件失败');
      });
    };
  }

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

    // 检查原文文件是否存在
    const textPath = getNovelTextPath(novelId);
    if (!fs.existsSync(textPath)) {
      throw new Error('小说原文文件不存在，请重新上传');
    }

    // 如果之前失败的任务，支持断点续建
    if (existing && existing.status === 'failed' && existing.lastCompletedStep !== undefined) {
      // 重置状态为 running，从断点继续
      await taskQueueRepo.updateStatus(novelId, 'running');
      this.executeBuild(novelId, existing.lastCompletedStep, existing.lastCompletedPhase).catch(err => {
        logger.error(err, '续建任务失败');
        taskQueueRepo.updateStatus(novelId, 'failed');
      });
      return;
    }

    // 创建新任务
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

  private async executeBuild(novelId: string, resumeFromStep?: number, resumeFromPhase?: string): Promise<void> {
    const novel = await novelRepo.findById(novelId);
    if (!novel) return;

    const buildConfig = settingsService.getBuildConfig();
    const aiConfig = await settingsService.getAiConfig();
    const encoding = aiConfig?.model ? getEncodingForModel(aiConfig.model) : 'cl100k_base';

    // 创建 AI 流式回调
    const onStream = this.createAIStreamCallback(novelId);

    // 读取原文
    const fullText = readNovelText(novelId);

    // 获取章节
    let chapters = await chapterRepo.findByNovelId(novelId);

    // 如果没有章节（文本粘贴模式），创建虚拟章节
    if (chapters.length === 0) {
      chapters = [{
        id: 'virtual',
        index: 1,
        title: '全文',
        startOffset: 0,
        charCount: fullText.replace(/\s/g, '').length,
        tokenCount: estimateTokens(fullText, encoding),
        novelId,
      }];
    }

    // 步划分
    const steps = stepPlannerService.planSteps(chapters, novel.contextSize);
    const totalSteps = steps.length;

    await novelRepo.updateStep(novelId, 0, totalSteps);
    await taskQueueRepo.updateProgress(novelId, 0);
    await taskQueueRepo.updateTotalSteps(novelId, totalSteps);

    // 确定从哪一步开始（断点续建）
    let startStep = 0;
    let skipPostProcessing = false;
    if (resumeFromStep !== undefined && resumeFromStep !== null) {
      if (resumeFromPhase === 'protagonist_detecting') {
        startStep = steps.length;
        skipPostProcessing = true;
        logger.info('断点续建：跳过所有步骤，从搜索索引开始');
      } else if (resumeFromPhase === 'indexing') {
        startStep = steps.length;
        skipPostProcessing = true;
        logger.info('断点续建：所有步骤已完成，直接标记完成');
      } else if (resumeFromPhase === 'step_completed' || resumeFromPhase === 'step_skipped') {
        startStep = resumeFromStep + 1;
        logger.info(`断点续建：从第 ${startStep + 1} 步开始`);
      } else {
        startStep = resumeFromStep;
        logger.info(`断点续建：从第 ${startStep + 1} 步重新开始（上次完成阶段：${resumeFromPhase}）`);
      }
    }

    // 逐步构建
    for (let i = startStep; i < steps.length; i++) {
      // 检查是否取消
      const task = await taskQueueRepo.getTask(novelId);
      if (task?.status === 'canceling') {
        await rollbackService.rollback(novelId, i, i + 1);
        await taskQueueRepo.updateStatus(novelId, 'canceled');
        return;
      }

      const step = steps[i];

      // 根据步的章节范围，从原文中提取对应文本
      const stepChapters = this.getStepChapters(step.chaptersRange, chapters);
      const stepText = this.extractStepText(fullText, stepChapters, chapters);

      if (!stepText || stepText.trim().length === 0) {
        logger.warn(`步骤 ${i + 1} 无文本内容，跳过`);
        await taskQueueRepo.updateLastCompletedStep(novelId, i, 'step_skipped');
        continue;
      }

      try {
        // 更新进度：提取
        await progressRepo.setProgress(novelId, {
          stepNumber: i + 1,
          phase: 'extracting',
          message: `正在提取第${i + 1}/${totalSteps}步的人物关系（${step.chaptersRange}）...`,
        });

        // AI 提取
        const existingChars = (await characterRepo.findByNovelId(novelId)).map(c => c.name);
        const extraction = await extractorService.extractFromText(stepText, step.chaptersRange, existingChars, onStream);
        await taskQueueRepo.updateLastCompletedStep(novelId, i, 'extracting');

        // 角色消歧
        await progressRepo.setProgress(novelId, {
          stepNumber: i + 1,
          phase: 'disambiguating',
          message: '正在检测角色消歧...',
        });
        await characterDisambiguatorService.detectDisambiguations(novelId, onStream);
        await taskQueueRepo.updateLastCompletedStep(novelId, i, 'disambiguating');

        // 增量合并
        await progressRepo.setProgress(novelId, {
          stepNumber: i + 1,
          phase: 'merging',
          message: '正在合并图谱数据...',
        });
        const mergeResult = await mergerService.merge(novelId, i + 1, extraction, stepChapters[0]?.index || 1);
        await taskQueueRepo.updateLastCompletedStep(novelId, i, 'merging');

        // 冲突检测
        await progressRepo.setProgress(novelId, {
          stepNumber: i + 1,
          phase: 'conflict_detecting',
          message: '正在检测冲突...',
        });
        await conflictDetectorService.detectAttributeConflicts(novelId);
        await taskQueueRepo.updateLastCompletedStep(novelId, i, 'conflict_detecting');

        // 更新角色档案
        await progressRepo.setProgress(novelId, {
          stepNumber: i + 1,
          phase: 'profile_updating',
          message: `正在更新角色档案（共${mergeResult.newCharacters.length + mergeResult.updatedCharacters.length}个角色）...`,
        });
        for (const char of mergeResult.newCharacters) {
          await profileBuilderService.updateProfile(char.id, novelId, stepText, step.chaptersRange, onStream);
        }
        for (const char of mergeResult.updatedCharacters) {
          await profileBuilderService.updateProfile(char.id, novelId, stepText, step.chaptersRange, onStream);
        }
        await taskQueueRepo.updateLastCompletedStep(novelId, i, 'profile_updating');

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
        await taskQueueRepo.updateLastCompletedStep(novelId, i, 'step_completed');

        logger.info(`步骤 ${i + 1}/${totalSteps} 完成：新增 ${mergeResult.newCharacters.length} 角色，${mergeResult.newRelations.length} 关系`);
      } catch (err: any) {
        if (err instanceof AIContentRefusedError) {
          logger.warn(`步骤 ${i + 1}（${step.chaptersRange}）AI 内容审核拒绝，跳过该步骤：${err.reason}`);
          await progressRepo.setProgress(novelId, {
            stepNumber: i + 1,
            phase: 'extracting',
            message: `步骤 ${i + 1}（${step.chaptersRange}）因 AI 内容审核被跳过：${err.reason}`,
          });
          await taskQueueRepo.updateLastCompletedStep(novelId, i, 'content_refused');
          await novelRepo.updateStep(novelId, i + 1, totalSteps);
          await taskQueueRepo.updateProgress(novelId, i + 1);
          continue;
        }
        throw err;
      }
    }

    // 主角识别
    if (resumeFromPhase === 'indexing') {
      // 搜索索引已完成，直接标记完成
    } else {
      await progressRepo.setProgress(novelId, {
        stepNumber: totalSteps,
        phase: 'snapshot_saving',
        message: '正在识别主角...',
      });
      await protagonistDetectorService.detectProtagonists(novelId, onStream);
      await taskQueueRepo.updateLastCompletedStep(novelId, totalSteps - 1, 'protagonist_detecting');
    }

    // 搜索索引
    await searchIndexerService.buildIndex(novelId);
    await taskQueueRepo.updateLastCompletedStep(novelId, totalSteps - 1, 'indexing');

    // 完成
    await taskQueueRepo.updateStatus(novelId, 'completed');
    logger.info(`构建任务完成：${novelId}`);
  }

  /**
   * 根据章节范围字符串获取对应章节
   */
  private getStepChapters(chaptersRange: string, allChapters: any[]): any[] {
    const match = chaptersRange.match(/第(\d+)[~—]*(\d*)章/);
    if (!match) return allChapters; // 文本粘贴模式，返回全部

    const start = parseInt(match[1]);
    const end = match[2] ? parseInt(match[2]) : start;
    return allChapters.filter(c => c.index >= start && c.index <= end);
  }

  /**
   * 从原文中提取指定章节的文本
   */
  private extractStepText(fullText: string, stepChapters: any[], allChapters?: any[]): string {
    if (stepChapters.length === 0) return fullText;

    const firstChapter = stepChapters[0];
    const lastChapter = stepChapters[stepChapters.length - 1];
    const startOffset = firstChapter.startOffset;

    // 结束位置：找到最后一章的下一章的 startOffset，否则用全文末尾
    let endOffset = fullText.length;
    if (allChapters) {
      const nextChapter = allChapters.find(c => c.index === lastChapter.index + 1);
      if (nextChapter) {
        endOffset = nextChapter.startOffset;
      }
    }

    return fullText.substring(startOffset, Math.min(endOffset, fullText.length));
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
