import { Character } from '../types';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { getSession } from '../repositories/neo4j/connection';
import { callAI } from './ai-client.service';
import { getLogger } from '../utils/logger';
import { v4 as uuid } from 'uuid';

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
   * 合并角色：将 mergeIds 的角色合并到 primaryId
   * 被合并角色的所有关系转移到主角色，被合并角色被删除
   */
  async mergeCharacters(primaryId: string, mergeIds: string[]): Promise<void> {
    const session = getSession();
    try {
      const tx = session.beginTransaction();

      for (const mergeId of mergeIds) {
        // 将被合并角色的出边转移到主角色
        await tx.run(
          `MATCH (c1:Character {id: $mergeId})-[r:RELATES_TO]->(c2)
           CREATE (c3:Character {id: $primaryId})-[:RELATES_TO]->(c2)
           SET c3 += properties(r)`,
          { mergeId, primaryId }
        );
        // 将被合并角色的入边转移到主角色
        await tx.run(
          `MATCH (c2)-[r:RELATES_TO]->(c1:Character {id: $mergeId})
           CREATE (c2)-[:RELATES_TO]->(c3:Character {id: $primaryId})
           SET c3 += properties(r)`,
          { mergeId, primaryId }
        );
        // 将被合并角色的别名添加到主角色
        await tx.run(
          `MATCH (primary:Character {id: $primaryId}), (merge:Character {id: $mergeId})
           SET primary.aliases = primary.aliases + merge.name`,
          { primaryId, mergeId }
        );
        // 删除被合并角色
        await tx.run(`MATCH (c:Character {id: $mergeId}) DETACH DELETE c`, { mergeId });
      }

      await tx.commit();
    } finally {
      await session.close();
    }

    logger.info(`角色合并完成：${mergeIds.join(',')} → ${primaryId}`);
  }

  /**
   * 拆分角色：将一个角色拆分为多个独立角色
   * 创建新角色节点，并将原角色的部分关系分配给新角色
   */
  async splitCharacter(
    characterId: string,
    splitInfo: Array<{ name: string; aliases: string[] }>
  ): Promise<Character[]> {
    const original = await characterRepo.findById(characterId);
    if (!original) throw new Error(`角色未找到: ${characterId}`);

    const newCharacters: Character[] = [];
    const session = getSession();

    try {
      const tx = session.beginTransaction();

      for (const info of splitInfo) {
        const newId = uuid();
        // 创建新角色节点
        await tx.run(
          `CREATE (c:Character {
            id: $id,
            name: $name,
            aliases: $aliases,
            gender: $gender,
            faction: $faction,
            identity: $identity,
            firstAppearChapter: $firstAppearChapter,
            isProtagonist: false,
            disambiguationStatus: 'confirmed',
            novelId: $novelId
          })`,
          {
            id: newId,
            name: info.name,
            aliases: info.aliases,
            gender: original.gender,
            faction: original.faction,
            identity: original.identity,
            firstAppearChapter: original.firstAppearChapter,
            novelId: original.novelId,
          }
        );

        // 关联到小说
        await tx.run(
          `MATCH (n:Novel {id: $novelId}), (c:Character {id: $charId})
           CREATE (n)-[:HAS_CHARACTER]->(c)`,
          { novelId: original.novelId, charId: newId }
        );

        newCharacters.push({
          id: newId,
          name: info.name,
          aliases: info.aliases,
          gender: original.gender,
          faction: original.faction,
          identity: original.identity,
          firstAppearChapter: original.firstAppearChapter,
          isProtagonist: false,
          disambiguationStatus: 'confirmed',
          novelId: original.novelId,
        });
      }

      await tx.commit();
    } finally {
      await session.close();
    }

    // 更新原角色状态为已拆分
    await characterRepo.update(characterId, {
      disambiguationStatus: 'pending_split',
    });

    logger.info(`角色拆分完成：${original.name} → ${splitInfo.map(s => s.name).join('、')}`);
    return newCharacters;
  }
}

export const characterDisambiguatorService = new CharacterDisambiguatorService();
