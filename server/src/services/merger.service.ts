import { Character, Relation, Event, WriteLogEntry } from '../types';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { relationRepo } from '../repositories/neo4j/relation.repo';
import { eventRepo } from '../repositories/neo4j/event.repo';
import { writeLogRepo } from '../repositories/redis/write-log.repo';
import { ExtractionResult } from './extractor.service';
import { getLogger } from '../utils/logger';

const logger = getLogger();

export interface MergeResult {
  newCharacters: Character[];
  updatedCharacters: Character[];
  newRelations: Relation[];
  newEvents: Event[];
  writeLog: WriteLogEntry[];
}

export class MergerService {
  async merge(
    novelId: string,
    stepNumber: number,
    extraction: ExtractionResult,
    chapterNumber: number
  ): Promise<MergeResult> {
    const writeLog: WriteLogEntry[] = [];
    const newCharacters: Character[] = [];
    const updatedCharacters: Character[] = [];
    const newRelations: Relation[] = [];
    const newEvents: Event[] = [];

    // 获取已有角色
    const existingCharacters = await characterRepo.findByNovelId(novelId);
    const nameToChar = new Map<string, Character>();
    existingCharacters.forEach(c => {
      nameToChar.set(c.name, c);
      c.aliases.forEach(a => nameToChar.set(a, c));
    });

    // 合并角色
    for (const charData of extraction.characters) {
      const existing = nameToChar.get(charData.name);
      if (existing) {
        // 更新已有角色
        const updates: Partial<Character> = {};
        if (charData.aliases.length > 0) {
          const mergedAliases = [...new Set([...existing.aliases, ...charData.aliases])];
          updates.aliases = mergedAliases;
        }
        // 只在原角色属性为空时填充新信息
        if (charData.faction && !existing.faction) updates.faction = charData.faction;
        if (charData.identity && !existing.identity) updates.identity = charData.identity;
        if (charData.gender && !existing.gender) updates.gender = charData.gender;

        await characterRepo.update(existing.id, updates);
        updatedCharacters.push(existing);

        writeLog.push({
          action: 'update_node',
          label: 'Character',
          id: existing.id,
          field: Object.keys(updates).join(','),
          added: updates,
        });
      } else {
        // 创建新角色
        const character = await characterRepo.create({
          name: charData.name,
          aliases: charData.aliases,
          gender: charData.gender,
          faction: charData.faction,
          identity: charData.identity,
          firstAppearChapter: chapterNumber,
          isProtagonist: false,
          disambiguationStatus: 'confirmed',
          novelId,
        });
        newCharacters.push(character);
        nameToChar.set(charData.name, character);
        charData.aliases.forEach(a => nameToChar.set(a, character));

        writeLog.push({
          action: 'create_node',
          label: 'Character',
          id: character.id,
        });
      }
    }

    // 合并关系
    for (const relData of extraction.relations) {
      const source = nameToChar.get(relData.sourceName);
      const target = nameToChar.get(relData.targetName);
      if (!source || !target) {
        logger.warn(`关系角色未找到: ${relData.sourceName} -> ${relData.targetName}`);
        continue;
      }

      const relation = await relationRepo.create({
        sourceId: source.id,
        targetId: target.id,
        relationType: relData.relationType,
        sinceChapter: chapterNumber,
        untilChapter: null,
        strength: 0.5,
        confidence: this.calculateConfidence(relData),
        importance: this.calculateImportance(relData),
        isInference: relData.isInference,
        inferenceBasis: relData.inferenceBasis,
        description: relData.description,
        novelId,
        createdStep: stepNumber,
      });
      newRelations.push(relation);

      writeLog.push({
        action: 'create_edge',
        label: 'RELATES_TO',
        id: relation.id,
      });
    }

    // 合并事件
    for (const eventData of extraction.events) {
      const participantIds = eventData.participantNames
        .map(n => nameToChar.get(n)?.id)
        .filter(Boolean) as string[];

      const event = await eventRepo.create({
        name: eventData.name,
        chapter: eventData.chapter || chapterNumber,
        summary: eventData.summary,
        eventType: eventData.eventType,
        participantIds,
        novelId,
      });
      newEvents.push(event);

      writeLog.push({
        action: 'create_node',
        label: 'Event',
        id: event.id,
      });
    }

    // 保存写操作日志
    await writeLogRepo.appendLog(novelId, stepNumber, writeLog);

    logger.info(`合并完成：新增 ${newCharacters.length} 角色，${newRelations.length} 关系，${newEvents.length} 事件`);
    return { newCharacters, updatedCharacters, newRelations, newEvents, writeLog };
  }

  /**
   * 计算关系置信度
   * 优先使用 AI 返回的 confidence，否则基于 isInference 推断
   */
  private calculateConfidence(relData: any): number {
    // 如果 AI 已经返回了 confidence，直接使用
    if (typeof relData.confidence === 'number') {
      return Math.min(1, Math.max(0, relData.confidence));
    }

    // 否则基于 isInference 推断
    if (relData.isInference) {
      return 0.6; // 推断关系默认中等置信度
    }

    return 0.85; // 非推断关系默认高置信度
  }

  /**
   * 计算关系重要性
   * 优先使用 AI 返回的 importance，否则基于关系类型推断
   */
  private calculateImportance(relData: any): number {
    // 如果 AI 已经返回了 importance，直接使用
    if (typeof relData.importance === 'number') {
      return Math.min(10, Math.max(1, Math.round(relData.importance)));
    }

    // 否则基于关系类型推断
    const type = relData.relationType || '';
    const coreTypes = ['父子', '父女', '母子', '母女', '夫妻', '兄弟', '姐妹'];
    const importantTypes = ['师徒', '主仆', '结义', '恋人', '表兄妹'];

    if (coreTypes.some(t => type.includes(t))) return 9;
    if (importantTypes.some(t => type.includes(t))) return 7;
    if (type.includes('友') || type.includes('同')) return 5;
    if (type.includes('敌') || type.includes('对')) return 6;
    return 4; // 默认中等重要性
  }
}

export const mergerService = new MergerService();
