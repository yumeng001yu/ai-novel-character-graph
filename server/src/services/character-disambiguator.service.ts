import { Character } from '../types';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { callAI } from './ai-client.service';
import { getLogger } from '../utils/logger';

const logger = getLogger();

export interface DisambiguationCandidate {
  character1: Character;
  character2: Character;
  similarity: number;
  reason: string;
}

export class CharacterDisambiguatorService {
  /**
   * 检测可能的同名异人/同人异名
   */
  async detectDisambiguations(novelId: string): Promise<DisambiguationCandidate[]> {
    const characters = await characterRepo.findByNovelId(novelId);
    const candidates: DisambiguationCandidate[] = [];

    // 检测同名角色
    const nameMap = new Map<string, Character[]>();
    for (const char of characters) {
      const list = nameMap.get(char.name) || [];
      list.push(char);
      nameMap.set(char.name, list);
    }

    for (const [name, chars] of nameMap) {
      if (chars.length > 1) {
        for (let i = 0; i < chars.length; i++) {
          for (let j = i + 1; j < chars.length; j++) {
            candidates.push({
              character1: chars[i],
              character2: chars[j],
              similarity: 0.8,
              reason: `同名角色"${name}"，可能为不同人物`,
            });
          }
        }
      }
    }

    // AI 检测同人异名
    if (characters.length > 1) {
      const charList = characters.map(c => `${c.name}(别名:${c.aliases.join('/')},身份:${c.identity || '未知'})`).join('\n');
      const prompt = `分析以下角色列表，找出可能是同一人的不同角色（同人异名）。

角色列表：
${charList}

请返回JSON数组，每个元素包含可能为同一人的两个角色名和理由：
[{"name1": "角色A", "name2": "角色B", "reason": "理由"}]

如果没有，返回空数组 []`;

      try {
        const response = await callAI(prompt, '你是小说分析专家，擅长识别同人异名。');
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          for (const item of parsed) {
            const c1 = characters.find(c => c.name === item.name1);
            const c2 = characters.find(c => c.name === item.name2);
            if (c1 && c2 && c1.id !== c2.id) {
              candidates.push({
                character1: c1,
                character2: c2,
                similarity: 0.6,
                reason: item.reason,
              });
            }
          }
        }
      } catch (err) {
        logger.warn(err, 'AI 同人异名检测失败');
      }
    }

    return candidates;
  }

  /**
   * 合并角色
   */
  async mergeCharacters(primaryId: string, mergeIds: string[]): Promise<void> {
    await characterRepo.mergeCharacters(primaryId, mergeIds);
    logger.info(`角色合并完成：${mergeIds.join(',')} → ${primaryId}`);
  }

  /**
   * 拆分角色（标记为待拆分）
   */
  async splitCharacter(characterId: string): Promise<void> {
    await characterRepo.update(characterId, {
      disambiguationStatus: 'pending_split',
    });
  }
}

export const characterDisambiguatorService = new CharacterDisambiguatorService();
