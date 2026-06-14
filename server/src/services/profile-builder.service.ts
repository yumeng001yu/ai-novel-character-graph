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
// 并行提取经历的最大并发数
const ENRICH_CONCURRENCY = 5;
// 角色提及次数阈值：提及次数低于此值的角色跳过经历提取
const MIN_MENTIONS_FOR_ENRICH = 2;

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

    // 预处理：提取每个章节的文本
    const chapterTexts = this.splitFullTextByChapters(fullText, chapters);

    // 按角色出场顺序处理，主角优先
    const sorted = [...characters].sort((a, b) => {
      if (a.isProtagonist && !b.isProtagonist) return -1;
      if (!a.isProtagonist && b.isProtagonist) return 1;
      return a.firstAppearChapter - b.firstAppearChapter;
    });

    // 过滤次要角色：计算每个角色在全文中的提及次数
    const enrichCandidates: any[] = [];
    const minorCharacters: any[] = [];

    for (const character of sorted) {
      const charNames = [character.name, ...(character.aliases || [])];
      let mentionCount = 0;
      for (const name of charNames) {
        const regex = new RegExp(name, 'g');
        const matches = fullText.match(regex);
        mentionCount += (matches?.length || 0);
      }
      if (character.isProtagonist || mentionCount >= MIN_MENTIONS_FOR_ENRICH) {
        enrichCandidates.push(character);
      } else {
        minorCharacters.push({ character, mentionCount });
        logger.info({ characterName: character.name, mentionCount }, '角色提及次数不足，标记为次要角色');
      }
    }

    logger.info(`经历提取候选：${enrichCandidates.length}/${sorted.length} 个角色（已过滤次要角色）`);

    // 并行处理角色，控制并发数
    let index = 0;
    const results: Promise<void>[] = [];

    const processNext = async (): Promise<void> => {
      while (index < enrichCandidates.length) {
        const character = enrichCandidates[index++];
        try {
          await this.enrichSingleProfile(character, novelId, chapterTexts, onStream);
        } catch (err) {
          if (err instanceof AIContentRefusedError) continue;
          logger.error({ err, characterId: character.id, characterName: character.name }, '角色档案丰富化失败');
        }
      }
    };

    // 启动 ENRICH_CONCURRENCY 个并行 worker
    const workers = Array.from({ length: Math.min(ENRICH_CONCURRENCY, enrichCandidates.length) }, () => processNext());
    await Promise.all(workers);

    // 为次要角色生成轻量级档案（一次性批量处理，减少 AI 调用次数）
    if (minorCharacters.length > 0) {
      await this.generateMinorProfiles(minorCharacters, novelId, fullText, onStream);
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

    // 生成个人分析（含重试机制）
    let personalAnalysis = await this.generatePersonalAnalysis(
      character, keyExperiences, eventsSummary, relationsSummary, onStream,
    );

    // 重试：如果个人分析为空，换简化 prompt 重试一次
    if (!personalAnalysis.characterArc && !personalAnalysis.personality && !personalAnalysis.motivation) {
      logger.info({ characterName: character.name }, '个人分析为空，使用简化 prompt 重试');
      personalAnalysis = await this.generatePersonalAnalysisSimple(
        character, keyExperiences, onStream,
      );
    }

    // 兜底：如果重试后仍为空，用经历摘要生成基本分析
    if (!personalAnalysis.characterArc && !personalAnalysis.personality && !personalAnalysis.motivation && keyExperiences.length > 0) {
      logger.info({ characterName: character.name }, '个人分析仍为空，使用经历摘要兜底');
      personalAnalysis = this.buildFallbackAnalysis(character, keyExperiences);
    }

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
   * 简化版个人分析生成（重试用）
   * 使用更简洁的 prompt，减少 AI 返回空的概率
   */
  private async generatePersonalAnalysisSimple(
    character: any,
    keyExperiences: ExperienceEvent[],
    onStream?: AIStreamCallback,
  ): Promise<PersonalAnalysis> {
    const timelineText = keyExperiences.length > 0
      ? keyExperiences.map(e => `第${e.chapter}章 ${e.event}`).join('；')
      : '暂无';

    const prompt = `请简要分析小说角色"${character.name}"（${character.identity || '身份未知'}）。

其关键经历如下：${timelineText}

请返回JSON：
{
  "characterArc": "发展轨迹（50字以内）",
  "personality": "性格（用分号分隔，30字以内）",
  "motivation": "核心动机（20字以内）"
}`;

    try {
      const response = await callAIStream(
        prompt,
        '请只返回JSON，不要返回其他内容。',
        { onStream, phase: 'profile_enrichment_retry' },
      );
      const parsed = this.parseAIResponse(response);

      return {
        characterArc: parsed.characterArc || '',
        personality: parsed.personality || '',
        motivation: parsed.motivation || '',
        keyRelationships: [],
        inferences: [],
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
   * 兜底：基于经历摘要生成基本分析（不调用 AI）
   */
  private buildFallbackAnalysis(character: any, keyExperiences: ExperienceEvent[]): PersonalAnalysis {
    const expSummary = keyExperiences
      .sort((a, b) => a.chapter - b.chapter)
      .map(e => e.event)
      .join('；');

    // 从经历类型推断性格倾向
    const types = keyExperiences.map(e => e.type);
    const hasCrisis = types.includes('危机');
    const hasTurningPoint = types.includes('转折点');
    const hasGrowth = types.includes('成长');

    const personalityParts: string[] = [];
    if (hasTurningPoint) personalityParts.push('经历重大转折');
    if (hasCrisis) personalityParts.push('面对危机');
    if (hasGrowth) personalityParts.push('有所成长');
    if (personalityParts.length === 0) personalityParts.push('经历平淡');

    return {
      characterArc: expSummary,
      personality: personalityParts.join('；'),
      motivation: '',
      keyRelationships: [],
      inferences: [],
    };
  }

  /**
   * 为次要角色生成轻量级档案
   * 将所有次要角色信息合并为一个 AI 调用，一次性生成简要档案
   */
  private async generateMinorProfiles(
    minorCharacters: Array<{ character: any; mentionCount: number }>,
    novelId: string,
    fullText: string,
    onStream?: AIStreamCallback,
  ): Promise<void> {
    if (minorCharacters.length === 0) return;

    logger.info(`开始为 ${minorCharacters.length} 个次要角色生成轻量级档案`);

    // 构建次要角色列表文本
    const minorList = minorCharacters.map(({ character, mentionCount }) => {
      const charNames = [character.name, ...(character.aliases || [])];
      // 提取角色在原文中出现的上下文片段（前后各50字）
      const contexts: string[] = [];
      for (const name of charNames) {
        const idx = fullText.indexOf(name);
        if (idx >= 0) {
          const start = Math.max(0, idx - 50);
          const end = Math.min(fullText.length, idx + name.length + 50);
          contexts.push(fullText.substring(start, end).replace(/\n/g, ' '));
          if (contexts.length >= 2) break; // 最多取2个上下文片段
        }
      }
      return `- ${character.name}${character.aliases?.length ? `（别名:${character.aliases.join('/')}）` : ''}，${character.identity || '身份未知'}，提及${mentionCount}次。上下文：${contexts.join('；') || '无'}`;
    }).join('\n');

    const prompt = `以下是小说中的次要角色列表，请为每个角色生成简要的性格分析。

${minorList}

请返回JSON格式：
{
  "profiles": [
    {"name": "角色名", "personality": "性格特征（用分号分隔，20字以内）", "characterArc": "简要发展轨迹（30字以内）"}
  ]
}

注意：
- 只需为列表中的角色生成分析
- 性格特征要基于上下文片段推断，不要凭空猜测
- 如果信息不足以推断，personality 可填"信息不足"`;

    try {
      const response = await callAIStream(
        prompt,
        '你是小说角色分析专家。请只返回JSON。',
        { onStream, phase: 'minor_profile' },
      );
      const parsed = this.parseAIResponse(response);
      const profiles = parsed.profiles || [];

      for (const p of profiles) {
        const minorEntry = minorCharacters.find(mc => mc.character.name === p.name);
        if (!minorEntry) continue;

        const character = minorEntry.character;
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
            characterArc: p.characterArc || '',
            personality: p.personality || '',
            motivation: '',
            keyRelationships: [],
            inferences: [],
          },
          chaptersInvolved: [],
        };

        this.saveProfile(novelId, character.id, profile);
        logger.info({ characterName: character.name }, '次要角色轻量级档案已生成');
      }
    } catch (err) {
      logger.warn({ err }, '次要角色轻量级档案生成失败（非致命）');
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

    // 同步更新 Neo4j 中的 profile 和 keyTraits 字段
    const profileSummary = [
      profile.personalAnalysis?.characterArc || '',
      profile.personalAnalysis?.personality || '',
      profile.personalAnalysis?.motivation || '',
    ].filter(Boolean).join('；');

    const keyTraits = profile.personalAnalysis?.personality
      ? profile.personalAnalysis.personality.split(/[；;、,，]/).map((s: string) => s.trim()).filter(Boolean)
      : [];

    characterRepo.update(characterId, {
      profile: profileSummary || undefined,
      keyTraits: keyTraits.length > 0 ? keyTraits : undefined,
    }).catch(err => {
      logger.warn({ err, characterId }, '同步角色档案到 Neo4j 失败（非致命）');
    });
  }
}

export const profileBuilderService = new ProfileBuilderService();
