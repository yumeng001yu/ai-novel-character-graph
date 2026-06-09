import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { novelRepo } from '../repositories/neo4j/novel.repo';
import { chapterRepo } from '../repositories/neo4j/chapter.repo';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { relationRepo } from '../repositories/neo4j/relation.repo';
import { chapterParserService } from '../services/chapter-parser.service';
import { semanticSegmenterService } from '../services/semantic-segmenter.service';
import { stepPlannerService } from '../services/step-planner.service';
import { settingsService } from '../services/settings.service';
import { taskQueueRepo } from '../repositories/redis/task-queue.repo';
import { progressRepo } from '../repositories/redis/progress.repo';
import { writeLogRepo } from '../repositories/redis/write-log.repo';
import { decodeBuffer } from '../utils/encoding-detector';
import { estimateTokens, getEncodingForModel } from '../utils/token-counter';
import { getConfig } from '../config';
import { getLogger } from '../utils/logger';
import path from 'path';
import fs from 'fs';

const logger = getLogger();

export async function novelRoutes(app: FastifyInstance) {
  // 上传 TXT（静态路径，避免与动态路由冲突）
  app.post('/upload', async (req: FastifyRequest, reply: FastifyReply) => {
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: '未上传文件' });

    // 从 form-data fields 中获取 has_chapter 参数
    const hasChapterField = data.fields['has_chapter'];
    const hasChapter = hasChapterField
      ? (hasChapterField as any).value !== 'false'
      : true; // 默认有章节

    const buffer = await data.toBuffer();
    const text = decodeBuffer(buffer);

    const aiConfig = await settingsService.getAiConfig();
    const contextSize = aiConfig?.contextSize || getConfig().build.default_context_size;
    const encoding = aiConfig?.model ? getEncodingForModel(aiConfig.model) : 'cl100k_base';

    const novel = await novelRepo.create({
      name: data.filename.replace('.txt', ''),
      totalChars: text.replace(/\s/g, '').length,
      totalTokens: estimateTokens(text, encoding),
      inputMode: hasChapter ? 'file_chapter' : 'file_no_chapter',
      contextSize,
    });

    // 保存原文到文件（供后续构建时读取）
    // 安全校验：novel.id 由 uuid 生成，但仍然验证
    if (!/^[a-f0-9-]+$/.test(novel.id)) {
      return reply.status(400).send({ error: '无效的小说ID' });
    }
    const novelDir = path.resolve(getConfig().build.snapshot_dir, '..', 'novels', novel.id);
    if (!fs.existsSync(novelDir)) fs.mkdirSync(novelDir, { recursive: true });
    fs.writeFileSync(path.join(novelDir, 'original.txt'), text, 'utf-8');

    // 章节识别
    let chapters;
    if (hasChapter) {
      chapters = await chapterParserService.parseChapters(text, novel.id);
    } else {
      chapters = await semanticSegmenterService.segment(text, novel.id, contextSize);
    }

    // 为每个章节计算 Token 数（使用与 totalTokens 相同的编码）
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      // 使用当前章节到下一章节的文本（而非 startOffset + charCount，因为 charCount 是去空格后的）
      const endOffset = i < chapters.length - 1 ? chapters[i + 1].startOffset : text.length;
      const chapterText = text.substring(ch.startOffset, endOffset);
      ch.tokenCount = estimateTokens(chapterText, encoding);
    }
    await chapterRepo.createBatch(chapters);

    // 步划分
    const steps = stepPlannerService.planSteps(chapters, contextSize);
    await novelRepo.updateStep(novel.id, 0, steps.length);

    reply.send({ novel, chapters: chapters.length, steps: steps.length });
  });

  // 文本粘贴（静态路径）
  app.post('/text-paste', async (req: FastifyRequest, reply: FastifyReply) => {
    const { content, novelName } = req.body as any;
    if (!content) return reply.status(400).send({ error: '内容不能为空' });

    const tokenCount = estimateTokens(content);
    const charCount = content.replace(/\s/g, '').length;
    const aiConfig = await settingsService.getAiConfig();
    const contextSize = aiConfig?.contextSize || getConfig().build.default_context_size;

    if (tokenCount > contextSize - 10000) {
      return reply.status(400).send({ error: `文本超出上下文限制（约${tokenCount} Token，上限${contextSize - 10000}）` });
    }

    const novel = await novelRepo.create({
      name: novelName || '文本粘贴',
      totalChars: charCount,
      totalTokens: tokenCount,
      inputMode: 'text_paste',
      contextSize,
    });

    // 安全校验：novel.id 由 uuid 生成，但仍然验证
    if (!/^[a-f0-9-]+$/.test(novel.id)) {
      return reply.status(400).send({ error: '无效的小说ID' });
    }
    const novelDir = path.resolve(getConfig().build.snapshot_dir, '..', 'novels', novel.id);
    if (!fs.existsSync(novelDir)) fs.mkdirSync(novelDir, { recursive: true });
    fs.writeFileSync(path.join(novelDir, 'original.txt'), content, 'utf-8');

    await novelRepo.updateStep(novel.id, 0, 1);
    reply.send({ novel, steps: 1 });
  });

  // 小说列表
  app.get('/', async (req, reply) => {
    const novels = await novelRepo.findAll();
    reply.send(novels);
  });

  // 删除小说（清理所有关联数据）
  app.delete('/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;

    // 安全校验
    if (!/^[a-f0-9-]+$/.test(id)) {
      return reply.status(400).send({ error: '无效的小说ID' });
    }

    const novel = await novelRepo.findById(id);
    if (!novel) return reply.status(404).send({ error: '小说未找到' });

    // 检查是否有运行中的构建任务
    const task = await taskQueueRepo.getTask(id);
    if (task && task.status === 'running') {
      return reply.status(400).send({ error: '该小说有正在运行的构建任务，请先取消' });
    }

    try {
      // 1. 删除 Neo4j 数据（DETACH DELETE 会级联删除所有关联节点和关系）
      await novelRepo.deleteById(id);

      // 2. 删除 Redis 数据
      await taskQueueRepo.deleteTask(id);
      await progressRepo.deleteProgress(id);
      // 删除写操作日志（扫描所有步的 key）
      const redis = (await import('../repositories/redis/connection')).getRedis();
      const writeLogKeys = await redis.keys(`writelog:${id}:*`);
      if (writeLogKeys.length > 0) {
        await redis.del(...writeLogKeys);
      }

      // 3. 删除文件系统数据
      const snapshotDir = path.resolve(getConfig().build.snapshot_dir, '..', 'novels', id);
      if (fs.existsSync(snapshotDir)) {
        fs.rmSync(snapshotDir, { recursive: true, force: true });
      }
      const profilesDir = path.resolve(getConfig().build.snapshot_dir, '..', 'profiles', id);
      if (fs.existsSync(profilesDir)) {
        fs.rmSync(profilesDir, { recursive: true, force: true });
      }
      const snapshotsDataDir = path.resolve(getConfig().build.snapshot_dir, id);
      if (fs.existsSync(snapshotsDataDir)) {
        fs.rmSync(snapshotsDataDir, { recursive: true, force: true });
      }

      logger.info(`小说已删除：${id} (${novel.name})`);
      reply.send({ success: true, message: `已删除小说「${novel.name}」` });
    } catch (err) {
      logger.error(err, '删除小说失败');
      reply.status(500).send({ error: '删除失败' });
    }
  });

  // 小说章节列表（静态路径，在动态路由之前）
  app.get('/:id/chapters', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    const novel = await novelRepo.findById(id);
    if (!novel) return reply.status(404).send({ error: '小说未找到' });

    const chapters = await chapterRepo.findByNovelId(id);
    reply.send(chapters);
  });

  // 小说原文（静态路径，在动态路由之前）
  // 支持 ?chapter=N 按章节索引返回对应文本，不传则返回全文
  app.get('/:id/text', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    const { chapter } = req.query as any;

    const novel = await novelRepo.findById(id);
    if (!novel) return reply.status(404).send({ error: '小说未找到' });

    // 安全校验
    if (!/^[a-f0-9-]+$/.test(id)) {
      return reply.status(400).send({ error: '无效的小说ID' });
    }

    const filePath = path.resolve(getConfig().build.snapshot_dir, '..', 'novels', id, 'original.txt');
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: '原文文件不存在' });
    }

    const fullText = fs.readFileSync(filePath, 'utf-8');

    // 如果指定了章节索引，只返回该章节的文本
    if (chapter !== undefined && chapter !== null) {
      const chapterIndex = parseInt(chapter as string);
      if (isNaN(chapterIndex)) {
        return reply.status(400).send({ error: '无效的章节索引' });
      }

      const chapters = await chapterRepo.findByNovelId(id);
      const targetChapter = chapters.find(c => c.index === chapterIndex);
      if (!targetChapter) {
        return reply.status(404).send({ error: '章节未找到' });
      }

      // 计算章节文本范围：从当前章节 startOffset 到下一章节 startOffset
      const startOffset = targetChapter.startOffset;
      const nextChapter = chapters.find(c => c.index === chapterIndex + 1);
      const endOffset = nextChapter ? nextChapter.startOffset : fullText.length;
      const chapterText = fullText.substring(startOffset, endOffset);

      reply.send({ text: chapterText, chapter: chapterIndex, title: targetChapter.title });
    } else {
      reply.send({ text: fullText });
    }
  });

  // 小说统计信息（静态路径，在动态路由之前）
  app.get('/:id/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    const novel = await novelRepo.findById(id);
    if (!novel) return reply.status(404).send({ error: '小说未找到' });

    const characters = await characterRepo.findByNovelId(id);
    const relations = await relationRepo.findByNovelId(id);
    const task = await taskQueueRepo.getTask(id);

    reply.send({
      graphBuilt: characters.length > 0,
      totalTokens: novel.totalTokens,
      characterCount: characters.length,
      relationCount: relations.length,
      buildStatus: task?.status || 'pending',
    });
  });

  // 小说详情（动态路由放最后）
  app.get('/:id', async (req, reply) => {
    const { id } = req.params as any;
    const novel = await novelRepo.findById(id);
    if (!novel) return reply.status(404).send({ error: '小说未找到' });
    const chapters = await chapterRepo.findByNovelId(id);
    reply.send({ ...novel, chapters });
  });
}
