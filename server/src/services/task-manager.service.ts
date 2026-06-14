import { BuildTask, TaskStatus, StepProgress, AIContentRefusedError, AIStreamEvent } from '../types';
import { taskQueueRepo } from '../repositories/redis/task-queue.repo';
import { progressRepo } from '../repositories/redis/progress.repo';
import { novelRepo } from '../repositories/neo4j/novel.repo';
import { chapterRepo } from '../repositories/neo4j/chapter.repo';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { textChunkRepo } from '../repositories/neo4j/text-chunk.repo';
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
import { embeddingService } from './embedding.service';
import { vectorSearchService } from './vector-search.service';
import { chapterParserService } from './chapter-parser.service';
import { AIStreamCallback } from './ai-client.service';
import { getLogger } from '../utils/logger';
import { estimateTokens, getEncodingForModel } from '../utils/token-counter';
import { getConfig } from '../config';
import { getSession } from '../repositories/neo4j/connection';
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

    // 如果之前失败或中断的任务，支持断点续建
    if (existing && (existing.status === 'failed' || existing.status === 'interrupted') && existing.lastCompletedStep !== undefined) {
      // 重置状态为 running，从断点继续
      await taskQueueRepo.updateStatus(novelId, 'running');
      this.executeBuild(novelId, existing.lastCompletedStep, existing.lastCompletedPhase).catch(async err => {
        logger.error(err, '续建任务失败');
        await taskQueueRepo.updateStatus(novelId, 'failed');
        await progressRepo.setProgress(novelId, { stepNumber: 0, phase: 'snapshot_saving', message: `构建失败: ${err.message}` });
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

    // 清除旧构建数据（角色、关系、事件、快照、档案），防止重复构建时数据混乱
    await this.cleanBuildData(novelId);

    // 异步执行构建
    this.executeBuild(novelId).catch(async err => {
      logger.error(err, '构建任务失败');
      await taskQueueRepo.updateStatus(novelId, 'failed');
      await progressRepo.setProgress(novelId, { stepNumber: 0, phase: 'snapshot_saving', message: `构建失败: ${err.message}` });
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

    // 如果没有章节（文本粘贴模式），尝试解析章节
    if (chapters.length === 0) {
      const parsed = await chapterParserService.parseChapters(fullText, novelId);
      if (parsed.length > 1) {
        // 解析成功，批量创建 Chapter 节点
        const chaptersToCreate = parsed.map(ch => ({
          ...ch,
          novelId,
          tokenCount: estimateTokens(
            fullText.substring(ch.startOffset, ch.startOffset + ch.charCount),
            encoding,
          ),
        }));
        await chapterRepo.createBatch(chaptersToCreate);
        chapters = await chapterRepo.findByNovelId(novelId);
        logger.info(`文本粘贴模式解析出 ${chapters.length} 个章节`);
      }

      // 如果仍然没有章节，创建虚拟章节
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
    }

    // 步划分
    const steps = stepPlannerService.planSteps(chapters, novel.contextSize);
    const totalSteps = steps.length;

    await novelRepo.updateStep(novelId, 0, totalSteps);
    await taskQueueRepo.updateProgress(novelId, 0);
    await taskQueueRepo.updateTotalSteps(novelId, totalSteps);

    // 初始化向量索引（如果配置了 Embedding）
    await vectorSearchService.ensureVectorIndex();

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

        // AI 提取（传入前步图谱摘要作为上下文）
        const existingChars = (await characterRepo.findByNovelId(novelId)).map(c => c.name);
        const graphSummary = i > 0 ? await extractorService.generateGraphSummary(novelId) : undefined;
        const extraction = await extractorService.extractFromText(stepText, step.chaptersRange, existingChars, onStream, graphSummary);
        await taskQueueRepo.updateLastCompletedStep(novelId, i, 'extracting');

        // 角色消歧
        await progressRepo.setProgress(novelId, {
          stepNumber: i + 1,
          phase: 'disambiguating',
          message: '正在检测角色消歧...',
        });
        await characterDisambiguatorService.detectDisambiguations(novelId, onStream);
        await taskQueueRepo.updateLastCompletedStep(novelId, i, 'disambiguating');

        // 向量消歧增强（可选）
        if (await embeddingService.isConfigured()) {
          await progressRepo.setProgress(novelId, {
            stepNumber: i + 1,
            phase: 'vector_disambiguating',
            message: '正在通过向量相似度增强角色消歧...',
          });
          const allChars = await characterRepo.findByNovelId(novelId);
          // 并行执行向量消歧，限制并发数
          const batchSize = 5;
          for (let j = 0; j < allChars.length; j += batchSize) {
            const batch = allChars.slice(j, j + batchSize);
            const results = await Promise.all(
              batch.map(char => vectorSearchService.findSimilarCharacters(novelId, char, 0.85))
            );
            for (let k = 0; k < results.length; k++) {
              if (results[k].length > 0) {
                logger.info(`向量消歧发现：${batch[k].name} 与 ${results[k].map(s => s.name).join(', ')} 相似度较高`);
              }
            }
          }
        }

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

        // 隐含关系发现（可选）
        if (await embeddingService.isConfigured()) {
          await progressRepo.setProgress(novelId, {
            stepNumber: i + 1,
            phase: 'implicit_relations',
            message: '正在通过向量相似度发现隐含关系...',
          });
          const allChars = await characterRepo.findByNovelId(novelId);
          const newCharIds = mergeResult.newCharacters.map(c => c.id);
          const implicitRelations = await vectorSearchService.discoverImplicitRelations(novelId, newCharIds, allChars);
          if (implicitRelations.length > 0) {
            logger.info(`发现 ${implicitRelations.length} 条隐含关系候选`);
          }
        }

        // 更新角色档案（构建过程中只创建基础档案，跳过 AI 调用）
        // 详细经历由 enrichProfilesFromFullText 在构建完成后统一提取
        await taskQueueRepo.updateLastCompletedStep(novelId, i, 'profile_updating');

        // 保存快照
        await progressRepo.setProgress(novelId, {
          stepNumber: i + 1,
          phase: 'snapshot_saving',
          message: '正在保存快照...',
        });
        await snapshotService.saveSnapshot(novelId, i + 1, stepChapters.map(c => c.index));

        // 向量索引写入（可选）
        if (await embeddingService.isConfigured()) {
          await progressRepo.setProgress(novelId, {
            stepNumber: i + 1,
            phase: 'vector_indexing',
            message: '正在更新向量索引...',
          });
          // 批量索引新角色
          if (mergeResult.newCharacters.length > 0) {
            await vectorSearchService.indexCharacters(mergeResult.newCharacters);
          }
          // 批量索引更新角色
          if (mergeResult.updatedCharacters.length > 0) {
            await Promise.all(
              mergeResult.updatedCharacters.map(char => vectorSearchService.indexCharacter(char.id, char))
            );
          }

          // 创建 TextChunk 节点并生成 embedding（按章节分段存储，提高向量召回精度）
          try {
            const stepChaptersList = this.getStepChapters(step.chaptersRange, chapters);
            const chapterTexts = this.splitFullTextByChaptersInternal(fullText, chapters);

            // 先批量创建 TextChunk 节点
            const createdChunks: Array<{ id: string; text: string; novelId: string; stepNumber: number; chapterRange: string }> = [];
            for (const ch of stepChaptersList) {
              const ct = chapterTexts.find(c => c.index === ch.index);
              if (!ct || !ct.text) continue;
              try {
                const chunk = await textChunkRepo.create(novelId, i + 1, ct.title, ct.text);
                createdChunks.push({ id: chunk.id, text: ct.text, novelId, stepNumber: i + 1, chapterRange: ct.title });
              } catch (err) {
                logger.warn({ err, chapter: ct.title }, '创建 TextChunk 失败（非致命）');
              }
            }

            // 批量生成 embedding 并索引（一次 API 调用替代 N 次）
            if (createdChunks.length > 0) {
              await vectorSearchService.indexTextChunks(createdChunks);
            }
          } catch (err) {
            logger.warn({ err, novelId, step: i + 1 }, '原文段落向量化失败（非致命）');
          }
        }

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

    // 保存 turbovec 索引到磁盘
    await vectorSearchService.saveIndex();

    // 全文分段关键经历提取（Profile Enrichment）
    if (resumeFromPhase !== 'indexing') {
      await progressRepo.setProgress(novelId, {
        stepNumber: totalSteps,
        phase: 'profile_enrichment',
        message: '正在提取角色关键经历...',
      });
      await profileBuilderService.enrichProfilesFromFullText(novelId, fullText, chapters, onStream);
    }

    // 完成
    await taskQueueRepo.updateStatus(novelId, 'completed');
    await progressRepo.setProgress(novelId, {
      stepNumber: totalSteps,
      phase: 'snapshot_saving',
      message: '构建完成',
    });
    logger.info(`构建任务完成：${novelId}`);
  }

  /**
   * 清除旧构建数据，防止重复构建时数据混乱
   */
  private async cleanBuildData(novelId: string): Promise<void> {
    logger.info(`清除旧构建数据：${novelId}`);

    // 1. 删除所有角色和关系（通过 Novel 节点级联）
    const session = getSession();
    try {
      // 先删除关系（RELATES_TO）
      await session.run(
        `MATCH (n:Novel {id: $novelId})-[:HAS_CHARACTER]->(c:Character)
         MATCH (c)-[r:RELATES_TO]-()
         DELETE r`,
        { novelId }
      );
      // 删除事件（通过 HAS_EVENT 关系）
      await session.run(
        `MATCH (n:Novel {id: $novelId})-[:HAS_EVENT]->(e:Event)
         DETACH DELETE e`,
        { novelId }
      );
      // 删除孤立事件（没有 HAS_EVENT 关系但有 novelId 属性的）
      await session.run(
        `MATCH (e:Event) WHERE e.novelId = $novelId AND NOT (e)<-[:HAS_EVENT]-()
         DETACH DELETE e`,
        { novelId }
      );
      // 删除角色
      await session.run(
        `MATCH (n:Novel {id: $novelId})-[:HAS_CHARACTER]->(c:Character)
         DETACH DELETE c`,
        { novelId }
      );
      // 删除 TextChunk
      await session.run(
        `MATCH (n:Novel {id: $novelId})-[:HAS_CHUNK]->(tc:TextChunk)
         DETACH DELETE tc`,
        { novelId }
      );
    } finally {
      await session.close();
    }

    // 2. 删除文件系统数据（快照和档案）
    const config = getConfig();
    const snapshotDir = path.resolve(config.build.snapshot_dir, novelId);
    if (fs.existsSync(snapshotDir)) {
      fs.rmSync(snapshotDir, { recursive: true, force: true });
    }
    const profilesDir = path.resolve(config.build.snapshot_dir, '..', 'profiles', novelId);
    if (fs.existsSync(profilesDir)) {
      fs.rmSync(profilesDir, { recursive: true, force: true });
    }

    // 3. 清除 Redis 缓存
    const redis = (await import('../repositories/redis/connection')).getRedis();
    const writeLogKeys = await redis.keys(`writelog:${novelId}:*`);
    if (writeLogKeys.length > 0) {
      await redis.del(...writeLogKeys);
    }
    const snapshotKeys = await redis.keys(`snapshot:${novelId}:*`);
    if (snapshotKeys.length > 0) {
      await redis.del(...snapshotKeys);
    }

    // 4. 清除 turbovec 向量数据
    await vectorSearchService.deleteByNovel(novelId);

    logger.info(`旧构建数据已清除：${novelId}`);
  }

  /**
   * 根据章节范围字符串获取对应章节
   */
  private getStepChapters(chaptersRange: string, allChapters: any[]): any[] {
    const match = chaptersRange.match(/第(\d+)[~—]*(\d*)[章回]/);
    if (!match) return allChapters; // 文本粘贴模式，返回全部

    const start = parseInt(match[1]);
    const end = match[2] ? parseInt(match[2]) : start;
    return allChapters.filter(c => c.index >= start && c.index <= end);
  }

  /**
   * 将全文按章节分段（用于 TextChunk 分段存储）
   */
  private splitFullTextByChaptersInternal(fullText: string, chapters: any[]): Array<{ index: number; title: string; text: string }> {
    const result: Array<{ index: number; title: string; text: string }> = [];
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      const startOffset = ch.startOffset || 0;
      let endOffset: number;
      if (i + 1 < chapters.length) {
        endOffset = chapters[i + 1].startOffset;
      } else {
        endOffset = fullText.length;
      }
      const text = fullText.substring(startOffset, endOffset).trim();
      if (text.length > 0) {
        result.push({
          index: ch.index,
          title: ch.title || `第${ch.index}章`,
          text,
        });
      }
    }
    return result;
  }

  /**
   * 获取角色首次出场章节到当前步的文本（用于构建初始档案）
   * 取首次出场章节到当前步末尾的所有文本，让 AI 有完整上下文
   */
  private getCharacterStepText(character: any, fullText: string, allChapters: any[]): string | null {
    const chapterIndex = character.firstAppearChapter;
    if (!chapterIndex || !allChapters.length) return null;

    // 从首次出场章节开始（前1章提供上下文）
    const startIdx = Math.max(1, chapterIndex - 1);

    const startChapter = allChapters.find(c => c.index === startIdx);
    if (!startChapter) return null;

    const startOffset = startChapter.startOffset;
    const text = fullText.substring(startOffset);

    // 限制长度，避免 token 过多（允许更多上下文）
    return text.length > 16000 ? text.substring(0, 16000) : text;
  }

  /**
   * 获取角色首次出场章节的范围描述
   */
  private getCharacterChapterRange(character: any, allChapters: any[]): string | null {
    const chapterIndex = character.firstAppearChapter;
    if (!chapterIndex) return null;

    const startIdx = Math.max(1, chapterIndex - 1);
    const endIdx = Math.min(allChapters.length, chapterIndex + 1);

    // 从章节标题中检测格式（章/回）
    const chapterUnit = this.detectChapterUnit(allChapters);

    if (startIdx === endIdx) return `第${startIdx}${chapterUnit}`;
    return `第${startIdx}~${endIdx}${chapterUnit}`;
  }

  /**
   * 从章节标题中检测章节单位（章/回）
   */
  private detectChapterUnit(allChapters: any[]): string {
    if (allChapters.length === 0) return '章';
    const title = allChapters[0].title || '';
    if (title.match(/第[零一二三四五六七八九十百千万\d]+回/)) return '回';
    return '章';
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
