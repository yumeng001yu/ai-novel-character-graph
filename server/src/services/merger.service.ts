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
        if (charData.faction && !existing.faction) updates.faction = charData.faction;
        if (charData.identity && !existing.identity) updates.identity = charData.identity;

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
        isInference: relData.isInference,
        inferenceBasis: relData.inferenceBasis,
        description: relData.description,
        novelId,
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
}

export const mergerService = new MergerService();
