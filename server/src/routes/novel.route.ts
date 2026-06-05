import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { novelRepo } from '../repositories/neo4j/novel.repo';
import { chapterRepo } from '../repositories/neo4j/chapter.repo';
import { chapterParserService } from '../services/chapter-parser.service';
import { semanticSegmenterService } from '../services/semantic-segmenter.service';
import { stepPlannerService } from '../services/step-planner.service';
import { settingsService } from '../services/settings.service';
import { decodeBuffer } from '../utils/encoding-detector';
import { estimateTokens, getEncodingForModel } from '../utils/token-counter';
import { getConfig } from '../config';
import path from 'path';
import fs from 'fs';

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

    const novel = await novelRepo.create({
      name: data.filename.replace('.txt', ''),
      totalChars: text.replace(/\s/g, '').length,
      totalTokens: estimateTokens(text),
      inputMode: hasChapter ? 'file_chapter' : 'file_no_chapter',
      contextSize,
    });

    // 保存原文到文件（供后续构建时读取）
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

    // 为每个章节计算 Token 数
    const encoding = aiConfig?.model ? getEncodingForModel(aiConfig.model) : 'cl100k_base';
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

    // 保存原文
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

  // 小说详情（动态路由放最后）
  app.get('/:id', async (req, reply) => {
    const { id } = req.params as any;
    const novel = await novelRepo.findById(id);
    if (!novel) return reply.status(404).send({ error: '小说未找到' });
    const chapters = await chapterRepo.findByNovelId(id);
    reply.send({ ...novel, chapters });
  });
}
