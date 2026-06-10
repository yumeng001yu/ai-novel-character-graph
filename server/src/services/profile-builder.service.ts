import { CharacterProfile, ExperienceEvent, PersonalAnalysis, KeyRelationship, Inference, AIContentRefusedError } from '../types';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { eventRepo } from '../repositories/neo4j/event.repo';
import { callAIStream, AIStreamCallback } from './ai-client.service';
import { getLogger } from '../utils/logger';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config';

const logger = getLogger();

// 关键经历评分阈值（1-10，低于此分数的经历不添加）
const IMPORTANCE_THRESHOLD = 6;
// 每次AI调用最大字符数（约4000 tokens）
const MAX_CHUNK_CHARS = 8000;

export class ProfileBuilderService {
  /**
   * 全文按章节分段提取关键经历并重建档案（构建完成后调用）
   */
  async enrichProfilesFromFullText(
    novelId: string,
    fullText: string,
    chapters: any[],
    onStream?: AIStreamCallback,
  ): Promise<void> {
    const characters = await characterRepo.findByNovelId(novelId);
    if (characters.length === 0) return;

    logger.info(`开始全文关键经历提取，共 ${characters.length} 个角色，${chapters.length} 个章节`);

    // 按角色出场顺序处理，主角优先
    const sorted = [...characters].sort((a, b) => {
      if (a.isProtagonist && !b.isProtagonist) return -1;
      if (!a.isProtagonist && b.isProtagonist) return 1;
      return a.firstAppearChapter - b.firstAppearChapter;
    });

    // 预处理：提取每个章节的文本
    const chapterTexts = this.splitFullTextByChapters(fullText, chapters);

    for (const character of sorted) {
      try {
        await this.enrichSingleProfile(character, novelId, chapterTexts, onStream);
      } catch (err) {
        if (err instanceof AIContentRefusedError) continue;
        logger.error({ err, characterId: character.id, characterName: character.name }, '角色档案丰富化失败');
      }
    }

    logger.info('全文关键经历提取完成');
  }

  /**
   * 将全文按章节拆分为 { chapterIndex, chapterTitle, text } 数组
   */
  private splitFullTextByChapters(fullText: string, chapters: any[]): Array<{ index: number; title: string; text: string }> {
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
   * 对单个角色进行全文经历提取（按章节分段）
   */
  private async enrichSingleProfile(
    character: any,
    novelId: string,
    chapterTexts: Array<{ index: number; title: string; text: string }>,
    onStream?: AIStreamCallback,
  ): Promise<void> {
    const existingProfile = this.loadProfile(novelId, character.id);

    // 查询该角色参与的所有事件
    const allEvents = await eventRepo.findByNovelId(novelId);
    const characterEvents = allEvents.filter(e =>
      e.participantIds && e.participantIds.includes(character.id)
    );
    const eventsSummary = characterEvents.length > 0
      ? characterEvents.sort((a, b) => a.chapter - b.chapter)
          .map(e => `第${e.chapter}章 [${e.eventType}] ${e.name}: ${e.summary}`)
          .join('\n')
      : '暂无';

    // 查询该角色的所有关系
    const { relationRepo } = require('../repositories/neo4j/relation.repo');
    const relations = await relationRepo.findByCharacter(character.id);
    const relationsSummary = relations.length > 0
      ? relations.map((r: any) => {
          const otherName = r.sourceId === character.id ? r.targetName : r.sourceName;
          return `${otherName || '未知'}: ${r.relationType}（${r.description}）`;
        }).join('\n')
      : '暂无';

    // 按章节提取关键经历
    const allExperiences: ExperienceEvent[] = [];
    const charNames = [character.name, ...(character.aliases || [])];

    // 合并短章节：将连续的短章节合并为一个AI调用，减少API次数
    const mergedChunks = this.mergeShortChapters(chapterTexts, charNames);

    for (const chunk of mergedChunks) {
      // 检查该段文本中是否提到该角色
      const mentioned = charNames.some(name => chunk.text.includes(name));
      if (!mentioned) continue;

      try {
        const experiences = await this.extractExperiencesFromChunk(
          character, chunk.text, chunk.chapterRange, onStream,
        );
        allExperiences.push(...experiences);
      } catch (err) {
        if (err instanceof AIContentRefusedError) continue;
        logger.warn({ err, characterId: character.id, chapterRange: chunk.chapterRange }, '分段经历提取失败（非致命）');
      }
    }

    // 去重：相同章节+相似事件描述只保留评分最高的
    const dedupedExperiences = this.deduplicateExperiences(allExperiences);

    // 过滤：只保留评分 >= 阈值的关键经历
    const keyExperiences = dedupedExperiences.filter(e => e.importance >= IMPORTANCE_THRESHOLD);

    // 按章节排序
    keyExperiences.sort((a, b) => a.chapter - b.chapter);

    logger.info({
      characterName: character.name,
      totalExtracted: allExperiences.length,
      afterDedup: dedupedExperiences.length,
      keyExperiences: keyExperiences.length,
    }, '关键经历提取完成');

    // 生成个人分析
    const personalAnalysis = await this.generatePersonalAnalysis(
      character, keyExperiences, eventsSummary, relationsSummary, onStream,
    );

    // 构建最终档案
    const profile: CharacterProfile = existingProfile || {
      id: uuid(),
      characterId: character.id,
      basicInfo: {
        aliases: character.aliases,
        gender: character.gender,
        faction: character.faction,
        identity: character.identity,
        firstAppear: `${character.firstAppearChapter}`,
      },
      experienceTimeline: [],
      personalAnalysis: {
        characterArc: '',
        personality: '',
        motivation: '',
        keyRelationships: [],
        inferences: [],
      },
      chaptersInvolved: [],
    };

    // 用全文提取的关键经历替换原有经历
    profile.experienceTimeline = keyExperiences;
    profile.personalAnalysis = personalAnalysis;
    profile.chaptersInvolved = [...new Set(keyExperiences.map(e => e.chapter).filter(Boolean))];

    this.saveProfile(novelId, character.id, profile);
  }

  /**
   * 合并短章节：将连续的短章节合并为一个chunk，直到超过 MAX_CHUNK_CHARS
   * 只合并包含目标角色的章节
   */
  private mergeShortChapters(
    chapterTexts: Array<{ index: number; title: string; text: string }>,
    charNames: string[],
  ): Array<{ chapterRange: string; text: string }> {
    const result: Array<{ chapterRange: string; text: string }> = [];
    let currentText = '';
    let currentStartIdx: number | null = null;
    let currentEndIdx: number | null = null;

    const flush = () => {
      if (currentText.length > 0 && currentStartIdx !== null) {
        const range = currentStartIdx === currentEndIdx
          ? `第${currentStartIdx}章`
          : `第${currentStartIdx}~${currentEndIdx}章`;
        result.push({ chapterRange: range, text: currentText });
      }
      currentText = '';
      currentStartIdx = null;
      currentEndIdx = null;
    };

    for (const ch of chapterTexts) {
      const mentioned = charNames.some(name => ch.text.includes(name));

      if (!mentioned) {
        // 该章节未提及角色，如果当前有累积文本则先输出
        flush();
        continue;
      }

      // 如果加入此章节会超过限制，先输出当前累积
      if (currentText.length + ch.text.length > MAX_CHUNK_CHARS && currentText.length > 0) {
        flush();
      }

      // 累积章节文本
      if (currentStartIdx === null) {
        currentStartIdx = ch.index;
      }
      currentEndIdx = ch.index;
      currentText += (currentText ? '\n' : '') + ch.text;
    }

    flush();
    return result;
  }

  /**
   * 从文本段中提取带评分的关键经历
   */
  private async extractExperiencesFromChunk(
    character: any,
    chunkText: string,
    chapterRange: string,
    onStream?: AIStreamCallback,
  ): Promise<ExperienceEvent[]> {
    const prompt = `从以下小说文本片段中，提取角色"${character.name}"的关键经历。

角色信息：${character.name}（${character.identity || '身份未知'}）

文本（${chapterRange}）：
${chunkText.substring(0, MAX_CHUNK_CHARS)}

请返回JSON格式的经历列表：
{
  "experiences": [
    {
      "chapter": 0,
      "event": "事件描述（简洁，20字以内）",
      "type": "转折点/成长/危机/日常",
      "importance": 8
    }
  ]
}

评分标准（importance 1-10）：
- 9-10：改变角色命运的重大转折（生死、结义、背叛、称王等）
- 7-8：显著影响角色发展的事件（重要战斗、获得/失去权力、关键决策）
- 5-6：有一定影响但非决定性（普通战斗、日常互动、小挫折）
- 3-4：轻微事件（普通对话、日常行为）
- 1-2：几乎无影响的提及

注意：
- 只提取该角色直接参与或被直接提及的事件
- 如果该段文本中该角色没有重要经历，返回空数组
- chapter 必须是事件发生的章节号（文本标注为${chapterRange}）
- 事件描述要简洁，不要超过20字`;

    try {
      const response = await callAIStream(
        prompt,
        '你是小说角色分析专家。请只返回JSON。',
        { onStream, phase: 'profile_enrichment' },
      );
      const parsed = this.parseAIResponse(response);

      return (parsed.experiences || []).map((e: any) => ({
        chapter: e.chapter || 0,
        event: e.event || '',
        type: e.type || '日常',
        importance: Math.min(10, Math.max(1, parseInt(e.importance) || 5)),
      }));
    } catch (err) {
      return [];
    }
  }

  /**
   * 基于关键经历生成个人分析
   */
  private async generatePersonalAnalysis(
    character: any,
    keyExperiences: ExperienceEvent[],
    eventsSummary: string,
    relationsSummary: string,
    onStream?: AIStreamCallback,
  ): Promise<PersonalAnalysis> {
    const timelineText = keyExperiences.length > 0
      ? keyExperiences.map(e => `第${e.chapter}章 [${e.type}|评分${e.importance}] ${e.event}`).join('\n')
      : '暂无关键经历';

    const prompt = `根据以下信息，为角色"${character.name}"生成个人分析。

角色基本信息：
- 名字：${character.name}
- 别名：${character.aliases.join('、') || '无'}
- 性别：${character.gender || '未知'}
- 阵营：${character.faction || '未知'}
- 身份：${character.identity || '未知'}

关键经历时间线：
${timelineText}

参与的事件：
${eventsSummary}

角色关系：
${relationsSummary}

请返回JSON格式：
{
  "characterArc": "角色弧线（从出场到当前的发展轨迹，100字以内）",
  "personality": "性格特征（用分号分隔，50字以内）",
  "motivation": "核心动机（30字以内）",
  "keyRelationships": [
    {"target": "角色名", "type": "关系类型", "impact": "对角色的影响（15字以内）"}
  ],
  "inferences": [
    {"content": "推断内容（20字以内）", "basis": "推断依据（必须引用原文，30字以内）"}
  ]
}

注意：
- characterArc 要概括角色完整的发展变化
- inferences 最多3条，必须有原文依据
- keyRelationships 最多5条，只列最重要的`;

    try {
      const response = await callAIStream(
        prompt,
        '你是小说角色分析专家。请只返回JSON。',
        { onStream, phase: 'profile_enrichment' },
      );
      const parsed = this.parseAIResponse(response);

      return {
        characterArc: parsed.characterArc || '',
        personality: parsed.personality || '',
        motivation: parsed.motivation || '',
        keyRelationships: parsed.keyRelationships || [],
        inferences: (parsed.inferences || []).map((i: any) => ({
          content: i.content,
          basis: i.basis,
          is_inference: true as const,
        })),
      };
    } catch (err) {
      return {
        characterArc: '',
        personality: '',
        motivation: '',
        keyRelationships: [],
        inferences: [],
      };
    }
  }

  /**
   * 去重经历：相同章节+相似描述只保留评分最高的
   */
  private deduplicateExperiences(experiences: ExperienceEvent[]): ExperienceEvent[] {
    const grouped = new Map<string, ExperienceEvent>();

    for (const exp of experiences) {
      const key = `${exp.chapter}:${exp.event.substring(0, 10)}`;
      const existing = grouped.get(key);
      if (!existing || exp.importance > existing.importance) {
        grouped.set(key, exp);
      }
    }

    return Array.from(grouped.values());
  }

  /**
   * 更新角色档案（构建过程中调用，简单版本）
   * 构建过程中只创建基础档案，详细经历由 enrichProfilesFromFullText 在构建完成后补充
   */
  async updateProfile(
    characterId: string,
    novelId: string,
    stepText: string,
    chapterRange: string,
    onStream?: AIStreamCallback,
    isNewCharacter: boolean = false,
  ): Promise<CharacterProfile> {
    const character = await characterRepo.findById(characterId);
    if (!character) throw new Error(`角色未找到: ${characterId}`);

    const existingProfile = this.loadProfile(novelId, characterId);

    // 构建过程中只做简单记录，详细经历由 enrichProfilesFromFullText 在构建完成后补充
    if (existingProfile) {
      return existingProfile;
    }

    // 新角色：创建基础档案（经历留空，等最终丰富化填充）
    const profile: CharacterProfile = {
      id: uuid(),
      characterId: character.id,
      basicInfo: {
        aliases: character.aliases,
        gender: character.gender,
        faction: character.faction,
        identity: character.identity,
        firstAppear: `${character.firstAppearChapter}`,
      },
      experienceTimeline: [],
      personalAnalysis: {
        characterArc: '',
        personality: '',
        motivation: '',
        keyRelationships: [],
        inferences: [],
      },
      chaptersInvolved: [],
    };

    this.saveProfile(novelId, character.id, profile);
    return profile;
  }

  /**
   * 解析 AI 返回的 JSON
   */
  private parseAIResponse(response: string): any {
    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI 返回格式错误：未找到 JSON');
    return JSON.parse(jsonMatch[0]);
  }

  private getProfileDir(novelId: string): string {
    if (novelId.includes('/') || novelId.includes('\\') || novelId.includes('..')) {
      throw new Error('无效的小说ID');
    }
    const config = getConfig();
    return path.resolve(config.build.snapshot_dir, '..', 'profiles', novelId);
  }

  loadProfile(novelId: string, characterId: string): CharacterProfile | null {
    const filePath = path.join(this.getProfileDir(novelId), `${characterId}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  private saveProfile(novelId: string, characterId: string, profile: CharacterProfile): void {
    const dir = this.getProfileDir(novelId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${characterId}.json`), JSON.stringify(profile, null, 2));
  }
}

export const profileBuilderService = new ProfileBuilderService();
