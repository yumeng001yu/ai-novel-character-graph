import { Chapter } from '../types';
import { callAI } from './ai-client.service';
import { getLogger } from '../utils/logger';
import { v4 as uuid } from 'uuid';

const logger = getLogger();

const CHAPTER_PATTERNS = [
  /^第[零一二三四五六七八九十百千万\d]+回\s*.+/m,
  /^第\d+回\s*.+/m,
  /^第[零一二三四五六七八九十百千万\d]+章\s*.+/m,
  /^第\d+章\s*.+/m,
  /^Chapter\s+\d+.*/im,
  /^卷[零一二三四五六七八九十百千万\d]+\s*.+/m,
  /^CHAPTER\s+[IVXLCDM]+.*/im,
];

export class ChapterParserService {
  /**
   * 识别章节边界，返回章节列表
   */
  async parseChapters(text: string, novelId: string): Promise<Chapter[]> {
    // 先尝试正则匹配
    const regexChapters = this.tryRegexParse(text, novelId);
    if (regexChapters.length > 0) {
      logger.info(`正则匹配到 ${regexChapters.length} 个章节`);
      return regexChapters;
    }

    // 正则匹配失败，使用 AI 识别
    logger.info('正则未匹配到章节，使用 AI 识别');
    return this.aiParseChapters(text, novelId);
  }

  private tryRegexParse(text: string, novelId: string): Chapter[] {
    const lines = text.split('\n');
    const chapterPositions: { index: number; title: string; lineOffset: number }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      for (const pattern of CHAPTER_PATTERNS) {
        if (pattern.test(line)) {
          chapterPositions.push({
            index: chapterPositions.length + 1,
            title: line,
            lineOffset: i,
          });
          break;
        }
      }
    }

    if (chapterPositions.length === 0) return [];

    // 计算每章的字符偏移和字数
    const charOffsets: number[] = [];
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      if (chapterPositions.some(cp => cp.lineOffset === i)) {
        charOffsets.push(offset);
      }
      offset += lines[i].length + 1; // +1 for newline
    }

    const chapters: Chapter[] = [];
    for (let i = 0; i < chapterPositions.length; i++) {
      const cp = chapterPositions[i];
      const startOffset = charOffsets[i];
      const endOffset = i < chapterPositions.length - 1
        ? charOffsets[i + 1]
        : text.length;
      const charCount = text.substring(startOffset, endOffset).replace(/\s/g, '').length;

      chapters.push({
        id: uuid(),
        index: cp.index,
        title: cp.title,
        startOffset,
        charCount,
        tokenCount: 0, // 后续由 step-planner 填充
        novelId,
      });
    }

    return chapters;
  }

  private async aiParseChapters(text: string, novelId: string): Promise<Chapter[]> {
    const preview = text.substring(0, 10000); // 取前1万字让AI判断
    const prompt = `分析以下小说文本，识别章节边界。如果无法识别章节，请将文本按语义段落分段。

请返回JSON格式的章节列表：
[{"title": "章节标题", "startText": "章节开头的几个字"}]

文本预览：
${preview}`;

    const response = await callAI(prompt, '你是一个小说文本分析专家，擅长识别小说章节结构。');

    try {
      // 去除可能的 markdown 代码块标记
      let cleaned = response.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      const matches = cleaned.match(/\[[\s\S]*\]/);
      if (!matches) throw new Error('AI 返回格式错误');
      const parsed = JSON.parse(matches[0]);

      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('AI 返回空数组');
      }

      const chapters: Chapter[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const startText = parsed[i].startText || '';
        let startOffset = startText ? text.indexOf(startText) : -1;
        // 如果找不到精确匹配，使用上一章末尾作为开始位置
        if (startOffset === -1) {
          startOffset = i > 0 && chapters[i-1] ? chapters[i-1].startOffset + chapters[i-1].charCount : 0;
        }

        chapters.push({
          id: uuid(),
          index: i + 1,
          title: parsed[i].title || `第${i + 1}段`,
          startOffset: Math.max(0, startOffset),
          charCount: 0,
          tokenCount: 0,
          novelId,
        });
      }

      // 计算每章字数
      for (let i = 0; i < chapters.length; i++) {
        const endOffset = i < chapters.length - 1 ? chapters[i + 1].startOffset : text.length;
        chapters[i].charCount = text.substring(chapters[i].startOffset, endOffset).replace(/\s/g, '').length;
      }

      return chapters;
    } catch (err) {
      logger.error(err, 'AI 章节解析失败');
      // 回退：整部小说作为一章
      return [{
        id: uuid(),
        index: 1,
        title: '全文',
        startOffset: 0,
        charCount: text.replace(/\s/g, '').length,
        tokenCount: 0,
        novelId,
      }];
    }
  }
}

export const chapterParserService = new ChapterParserService();
