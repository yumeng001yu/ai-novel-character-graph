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

export class ProfileBuilderService {
  /**
   * 更新角色档案
   * @param characterId 角色ID
   * @param novelId 小说ID
   * @param stepText 当前步文本
   * @param chapterRange 当前步章节范围
   * @param onStream AI流式回调
   * @param isNewCharacter 是否为新角色（首次构建档案）
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

    // 加载已有档案
    const existingProfile = this.loadProfile(novelId, characterId);

    // 查询该角色参与的所有事件（从 Neo4j Event 节点获取）
    const allEvents = await eventRepo.findByNovelId(novelId);
    const characterEvents = allEvents.filter(e =>
      e.participantIds && e.participantIds.includes(characterId)
    );
    const eventsSummary = characterEvents.length > 0
      ? characterEvents
          .sort((a, b) => a.chapter - b.chapter)
          .map(e => `第${e.chapter}章 [${e.eventType}] ${e.name}: ${e.summary}`)
          .join('\n')
      : '暂无已提取的事件';

    // 查询该角色的所有关系
    const { relationRepo } = require('../repositories/neo4j/relation.repo');
    const relations = await relationRepo.findByCharacter(characterId);
    const relationsSummary = relations.length > 0
      ? relations.map((r: any) => {
          const otherName = r.sourceId === characterId ? r.targetName : r.sourceName;
          return `${otherName || '未知'}: ${r.relationType}（${r.description}）`;
        }).join('\n')
      : '暂无关系数据';

    if (isNewCharacter || !existingProfile) {
      // ===== 初始构建档案 =====
      return this.buildInitialProfile(character, novelId, stepText, chapterRange, eventsSummary, relationsSummary, onStream);
    } else {
      // ===== 增量更新档案 =====
      return this.updateExistingProfile(character, existingProfile, novelId, stepText, chapterRange, eventsSummary, relationsSummary, onStream);
    }
  }

  /**
   * 初始构建角色档案（新角色首次构建）
   */
  private async buildInitialProfile(
    character: any,
    novelId: string,
    stepText: string,
    chapterRange: string,
    eventsSummary: string,
    relationsSummary: string,
    onStream?: AIStreamCallback,
  ): Promise<CharacterProfile> {
    const prompt = `根据以下信息，为角色"${character.name}"构建完整的个人档案。

角色基本信息：
- 名字：${character.name}
- 别名：${character.aliases.join('、') || '无'}
- 性别：${character.gender || '未知'}
- 阵营：${character.faction || '未知'}
- 身份：${character.identity || '未知'}
- 首次出场：第${character.firstAppearChapter}章

该角色参与的事件（从文本中已提取）：
${eventsSummary}

该角色的关系：
${relationsSummary}

当前文本（${chapterRange}）：
${stepText.substring(0, 6000)}

请返回JSON格式：
{
  "experienceTimeline": [
    {"chapter": 0, "event": "事件描述", "type": "转折点/成长/危机/日常"}
  ],
  "characterArc": "角色弧线描述（从出场到当前的发展轨迹）",
  "personality": "性格特征（用分号分隔多个特征）",
  "motivation": "核心动机",
  "keyRelationships": [
    {"target": "角色名", "type": "关系类型", "impact": "对角色的影响"}
  ],
  "inferences": [
    {"content": "推断内容", "basis": "推断依据（必须引用原文）"}
  ]
}

特别注意：
- experienceTimeline 必须完整记录该角色从首次出场到当前的所有关键经历
- 每个经历必须标注正确的章节号
- 优先记录：首次出场、重要决策、战斗胜负、结盟背叛、关系变化、生死危机等转折性事件
- characterArc 要概括角色从出场到当前的发展变化
- inferences 中的 basis 必须有原文依据，不要凭空推断
- 只返回关键事件，不要记录日常琐事`;

    try {
      const response = await callAIStream(
        prompt,
        '你是小说角色分析专家。请只返回JSON。',
        { onStream, phase: 'profile_updating' },
      );
      const parsed = this.parseAIResponse(response);

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
        experienceTimeline: parsed.experienceTimeline || [],
        personalAnalysis: {
          characterArc: parsed.characterArc || '',
          personality: parsed.personality || '',
          motivation: parsed.motivation || '',
          keyRelationships: parsed.keyRelationships || [],
          inferences: (parsed.inferences || []).map((i: any) => ({
            content: i.content,
            basis: i.basis,
            is_inference: true as const,
          })),
        },
        chaptersInvolved: [...new Set((parsed.experienceTimeline || []).map((e: any) => e.chapter).filter(Boolean))] as number[],
      };

      this.saveProfile(novelId, character.id, profile);
      return profile;
    } catch (err) {
      if (err instanceof AIContentRefusedError) throw err;
      logger.error({ err, characterId: character.id }, '角色初始档案构建失败');
      return this.createEmptyProfile(character.id, character);
    }
  }

  /**
   * 增量更新已有角色档案
   */
  private async updateExistingProfile(
    character: any,
    existingProfile: CharacterProfile,
    novelId: string,
    stepText: string,
    chapterRange: string,
    eventsSummary: string,
    relationsSummary: string,
    onStream?: AIStreamCallback,
  ): Promise<CharacterProfile> {
    // 已有经历摘要
    const existingTimeline = existingProfile.experienceTimeline
      .map(e => `第${e.chapter}章 [${e.type}] ${e.event}`)
      .join('\n');

    const prompt = `根据新的小说文本，增量更新角色"${character.name}"的个人档案。

角色基本信息：
- 名字：${character.name}
- 身份：${character.identity || '未知'}

已有经历时间线：
${existingTimeline || '暂无'}

已有角色弧线：${existingProfile.personalAnalysis.characterArc || '暂无'}
已有性格特征：${existingProfile.personalAnalysis.personality || '暂无'}
已有核心动机：${existingProfile.personalAnalysis.motivation || '暂无'}

该角色参与的所有事件（从文本中已提取）：
${eventsSummary}

该角色的关系：
${relationsSummary}

当前新文本（${chapterRange}）：
${stepText.substring(0, 6000)}

请返回JSON格式：
{
  "newExperiences": [
    {"chapter": 0, "event": "新事件描述", "type": "转折点/成长/危机/日常"}
  ],
  "characterArc": "更新后的角色弧线（整合新旧信息）",
  "personality": "更新后的性格特征",
  "motivation": "更新后的核心动机",
  "newKeyRelationships": [
    {"target": "角色名", "type": "关系类型", "impact": "对角色的影响"}
  ],
  "newInferences": [
    {"content": "新推断内容", "basis": "推断依据（必须引用原文）"}
  ]
}

特别注意：
- newExperiences 只包含当前新文本中新出现的经历，不要重复已有时间线中的事件
- characterArc/personality/motivation 是对已有内容的更新和完善，不是替换
- 如果新文本中该角色没有新的关键经历，newExperiences 可以为空数组
- 参考事件列表中的信息来补充经历，确保不遗漏关键事件
- 只返回关键事件（转折点/成长/危机），不要记录日常琐事`;

    try {
      const response = await callAIStream(
        prompt,
        '你是小说角色分析专家。请只返回JSON。',
        { onStream, phase: 'profile_updating' },
      );
      const parsed = this.parseAIResponse(response);

      // 追加新经历
      if (parsed.newExperiences) {
        existingProfile.experienceTimeline.push(...parsed.newExperiences.map((e: any) => ({
          chapter: e.chapter,
          event: e.event,
          type: e.type,
        })));
      }

      // 更新个人分析（覆盖式更新，因为AI已整合新旧信息）
      if (parsed.characterArc) existingProfile.personalAnalysis.characterArc = parsed.characterArc;
      if (parsed.personality) existingProfile.personalAnalysis.personality = parsed.personality;
      if (parsed.motivation) existingProfile.personalAnalysis.motivation = parsed.motivation;

      // 追加新关系和推断
      if (parsed.newKeyRelationships) {
        existingProfile.personalAnalysis.keyRelationships.push(...parsed.newKeyRelationships);
      }
      if (parsed.newInferences) {
        existingProfile.personalAnalysis.inferences.push(...parsed.newInferences.map((i: any) => ({
          content: i.content,
          basis: i.basis,
          is_inference: true as const,
        })));
      }

      // 更新涉及章节
      existingProfile.chaptersInvolved = [...new Set([
        ...existingProfile.chaptersInvolved,
        ...existingProfile.experienceTimeline.map(e => e.chapter).filter(Boolean),
      ])];

      this.saveProfile(novelId, character.id, existingProfile);
      return existingProfile;
    } catch (err) {
      if (err instanceof AIContentRefusedError) throw err;
      logger.error({ err, characterId: character.id }, '角色档案增量更新失败');
      return existingProfile;
    }
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

  private createEmptyProfile(characterId: string, character: any): CharacterProfile {
    return {
      id: uuid(),
      characterId,
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
  }

  private getProfileDir(novelId: string): string {
    if (novelId.includes('/') || novelId.includes('\\') || novelId.includes('..')) {
      throw new Error('无效的小说ID');
    }
    const config = getConfig();
    return path.resolve(config.build.snapshot_dir, '..', 'profiles', novelId);
  }

  private loadProfile(novelId: string, characterId: string): CharacterProfile | null {
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
