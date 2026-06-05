import { Character, Relation, Conflict } from '../types';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { relationRepo } from '../repositories/neo4j/relation.repo';
import { getLogger } from '../utils/logger';
import { v4 as uuid } from 'uuid';

const logger = getLogger();

export class ConflictDetectorService {
  /**
   * 检测角色属性冲突
   */
  async detectAttributeConflicts(novelId: string): Promise<Conflict[]> {
    const characters = await characterRepo.findByNovelId(novelId);
    const conflicts: Conflict[] = [];

    // 检测同一角色的矛盾属性（这里简化，实际需要对比不同章节的提取结果）
    // 主要通过同名异人检测来发现
    const nameMap = new Map<string, Character[]>();
    for (const char of characters) {
      const list = nameMap.get(char.name) || [];
      list.push(char);
      nameMap.set(char.name, list);
    }

    for (const [name, chars] of nameMap) {
      if (chars.length > 1) {
        // 同名但属性不同
        for (let i = 0; i < chars.length; i++) {
          for (let j = i + 1; j < chars.length; j++) {
            const diffs: string[] = [];
            if (chars[i].gender && chars[j].gender && chars[i].gender !== chars[j].gender) {
              diffs.push(`性别: ${chars[i].gender} vs ${chars[j].gender}`);
            }
            if (chars[i].faction && chars[j].faction && chars[i].faction !== chars[j].faction) {
              diffs.push(`阵营: ${chars[i].faction} vs ${chars[j].faction}`);
            }
            if (diffs.length > 0) {
              conflicts.push({
                id: uuid(),
                conflictType: 'attribute',
                characterId: chars[i].id,
                chapters: [chars[i].firstAppearChapter, chars[j].firstAppearChapter],
                descriptions: diffs,
                resolved: false,
              });
            }
          }
        }
      }
    }

    return conflicts;
  }

  /**
   * 检测关系冲突
   */
  async detectRelationConflicts(novelId: string): Promise<Conflict[]> {
    const relations = await relationRepo.findByNovelId(novelId);
    const conflicts: Conflict[] = [];

    // 检测同一对角色的矛盾关系
    const pairMap = new Map<string, Relation[]>();
    for (const rel of relations) {
      const key = [rel.sourceId, rel.targetId].sort().join('-');
      const list = pairMap.get(key) || [];
      list.push(rel);
      pairMap.set(key, list);
    }

    const contradictoryTypes: Record<string, string[]> = {
      '朋友': ['敌对'],
      '敌对': ['朋友'],
      '师徒': ['同门'],
      '恋人': ['仇人'],
    };

    for (const [pair, rels] of pairMap) {
      if (rels.length > 1) {
        for (let i = 0; i < rels.length; i++) {
          for (let j = i + 1; j < rels.length; j++) {
            const contradictions = contradictoryTypes[rels[i].relationType];
            if (contradictions?.includes(rels[j].relationType)) {
              conflicts.push({
                id: uuid(),
                conflictType: 'relation',
                characterId: rels[i].sourceId,
                chapters: [rels[i].sinceChapter, rels[j].sinceChapter],
                descriptions: [
                  `${rels[i].relationType}（第${rels[i].sinceChapter}章）`,
                  `${rels[j].relationType}（第${rels[j].sinceChapter}章）`,
                ],
                resolved: false,
              });
            }
          }
        }
      }
    }

    return conflicts;
  }
}

export const conflictDetectorService = new ConflictDetectorService();
