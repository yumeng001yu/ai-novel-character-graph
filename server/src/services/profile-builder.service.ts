import { CharacterProfile, ExperienceEvent, PersonalAnalysis, KeyRelationship, Inference } from '../types';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { relationRepo } from '../repositories/neo4j/relation.repo';
import { callAI } from './ai-client.service';
import { getLogger } from '../utils/logger';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config';

const logger = getLogger();

export class ProfileBuilderService {
  /**
   * 更新角色档案
   */
  async updateProfile(
    characterId: string,
    novelId: string,
    stepText: string,
    chapterRange: string
  ): Promise<CharacterProfile> {
    const character = await characterRepo.findById(characterId);
    if (!character) throw new Error(`角色未找到: ${characterId}`);

    // 加载已有档案
    const existingProfile = this.loadProfile(novelId, characterId);

    // AI 生成档案更新
    const prompt = `根据以下小说文本，更新角色"${character.name}"的个人档案。

角色当前信息：
- 名字：${character.name}
- 别名：${character.aliases.join('、')}
- 身份：${character.identity || '未知'}

${existingProfile ? `已有档案摘要：\n角色弧线：${existingProfile.personalAnalysis.characterArc}\n性格：${existingProfile.personalAnalysis.personality}\n动机：${existingProfile.personalAnalysis.motivation}` : ''}

当前文本（${chapterRange}）：
${stepText.substring(0, 5000)}

请返回JSON格式：
{
  "newExperiences": [
    {"chapter": 0, "event": "事件描述", "type": "转折点/成长/危机/日常"}
  ],
  "characterArc": "角色弧线描述",
  "personality": "性格特征",
  "motivation": "核心动机",
  "keyRelationships": [
    {"target": "角色名", "type": "关系类型", "impact": "对角色的影响"}
  ],
  "inferences": [
    {"content": "推断内容", "basis": "推断依据"}
  ]
}`;

    try {
      const response = await callAI(prompt, '你是小说角色分析专家。请只返回JSON。');
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('AI 返回格式错误');
      const parsed = JSON.parse(jsonMatch[0]);

      const profile: CharacterProfile = existingProfile || {
        id: uuid(),
        characterId,
        basicInfo: {
          aliases: character.aliases,
          gender: character.gender,
          faction: character.faction,
          identity: character.identity,
          firstAppear: `第${character.firstAppearChapter}章`,
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

      // 追加新经历
      if (parsed.newExperiences) {
        profile.experienceTimeline.push(...parsed.newExperiences.map((e: any) => ({
          chapter: e.chapter,
          event: e.event,
          type: e.type,
        })));
      }

      // 更新个人分析
      if (parsed.characterArc) profile.personalAnalysis.characterArc = parsed.characterArc;
      if (parsed.personality) profile.personalAnalysis.personality = parsed.personality;
      if (parsed.motivation) profile.personalAnalysis.motivation = parsed.motivation;
      if (parsed.keyRelationships) profile.personalAnalysis.keyRelationships = parsed.keyRelationships;
      if (parsed.inferences) {
        profile.personalAnalysis.inferences.push(...parsed.inferences.map((i: any) => ({
          content: i.content,
          basis: i.basis,
          is_inference: true as const,
        })));
      }

      // 保存档案
      this.saveProfile(novelId, characterId, profile);
      return profile;
    } catch (err) {
      logger.error({ err, characterId }, '角色档案更新失败');
      return existingProfile || this.createEmptyProfile(characterId, character);
    }
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
        firstAppear: `第${character.firstAppearChapter}章`,
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
