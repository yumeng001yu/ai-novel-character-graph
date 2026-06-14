import { getSession } from './connection';
import { Relation } from '../../types';
import { v4 as uuid } from 'uuid';

export class RelationRepo {
  async create(data: Omit<Relation, 'id'>): Promise<Relation> {
    const session = getSession();
    try {
      const relation: Relation = { id: uuid(), ...data };
      await session.run(
        `MATCH (c1:Character {id: $sourceId}), (c2:Character {id: $targetId})
         CREATE (c1)-[r:RELATES_TO $props]->(c2)`,
        { sourceId: data.sourceId, targetId: data.targetId, props: relation }
      );
      return relation;
    } finally {
      await session.close();
    }
  }

  async findByNovelId(novelId: string): Promise<Relation[]> {
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (n:Novel {id: $novelId})-[:HAS_CHARACTER]->(c1:Character)-[r:RELATES_TO]->(c2:Character)
         MATCH (n)-[:HAS_CHARACTER]->(c2)
         RETURN c1.id AS sourceId, c1.name AS sourceName, c2.id AS targetId, c2.name AS targetName, r`,
        { novelId }
      );
      return result.records.map(r => {
        const rel = r.get('r').properties;
        return {
          ...rel,
          sourceId: r.get('sourceId'),
          sourceName: r.get('sourceName'),
          targetId: r.get('targetId'),
          targetName: r.get('targetName'),
        } as Relation;
      });
    } finally {
      await session.close();
    }
  }

  async findByCharacter(characterId: string): Promise<Relation[]> {
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (c1:Character {id: $charId})-[r:RELATES_TO]->(c2:Character)
         RETURN c1.id AS sourceId, c1.name AS sourceName, c2.id AS targetId, c2.name AS targetName, r
         UNION
         MATCH (c2:Character)-[r:RELATES_TO]->(c1:Character {id: $charId})
         RETURN c2.id AS sourceId, c2.name AS sourceName, c1.id AS targetId, c1.name AS targetName, r`,
        { charId: characterId }
      );
      return result.records.map(r => {
        const rel = r.get('r').properties;
        return {
          ...rel,
          sourceId: r.get('sourceId'),
          sourceName: r.get('sourceName'),
          targetId: r.get('targetId'),
          targetName: r.get('targetName'),
        } as Relation;
      });
    } finally {
      await session.close();
    }
  }

  /**
   * 批量查询多个角色的关系（替代 N 次 findByCharacter 调用）
   */
  async findByCharacterIds(characterIds: string[]): Promise<Map<string, Relation[]>> {
    if (characterIds.length === 0) return new Map();
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (c1:Character)-[r:RELATES_TO]->(c2:Character)
         WHERE c1.id IN $ids OR c2.id IN $ids
         RETURN c1.id AS sourceId, c1.name AS sourceName, c2.id AS targetId, c2.name AS targetName, r`,
        { ids: characterIds }
      );
      const relationMap = new Map<string, Relation[]>();
      for (const record of result.records) {
        const rel: Relation = {
          ...record.get('r').properties,
          sourceId: record.get('sourceId'),
          sourceName: record.get('sourceName'),
          targetId: record.get('targetId'),
          targetName: record.get('targetName'),
        } as Relation;
        // 添加到 sourceId 和 targetId 对应的列表
        for (const charId of characterIds) {
          if (rel.sourceId === charId || rel.targetId === charId) {
            const list = relationMap.get(charId) || [];
            list.push(rel);
            relationMap.set(charId, list);
          }
        }
      }
      return relationMap;
    } finally {
      await session.close();
    }
  }

  /**
   * 删除指定步创建的关系
   * 使用写操作日志中记录的关系 ID 来精确删除
   */
  async deleteByRelationIds(relationIds: string[]): Promise<void> {
    if (relationIds.length === 0) return;
    const session = getSession();
    try {
      for (const relId of relationIds) {
        await session.run(
          `MATCH ()-[r:RELATES_TO {id: $relId}]->() DELETE r`,
          { relId }
        );
      }
    } finally {
      await session.close();
    }
  }

  /**
   * 删除指定步创建的关系（通过 createdStep 属性）
   * 需要在创建关系时存储 createdStep 属性
   */
  async deleteByStep(novelId: string, stepNumber: number): Promise<void> {
    const session = getSession();
    try {
      await session.run(
        `MATCH (n:Novel {id: $novelId})-[:HAS_CHARACTER]->(c1:Character)-[r:RELATES_TO]->(c2:Character)
         WHERE r.createdStep = $stepNumber
         DELETE r`,
        { novelId, stepNumber }
      );
    } finally {
      await session.close();
    }
  }
}

export const relationRepo = new RelationRepo();
