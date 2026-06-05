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
         WHERE c2.novelId = $novelId
         RETURN c1.id AS sourceId, c2.id AS targetId, r`,
        { novelId }
      );
      return result.records.map(r => {
        const rel = r.get('r').properties;
        return { ...rel, sourceId: r.get('sourceId'), targetId: r.get('targetId') } as Relation;
      });
    } finally {
      await session.close();
    }
  }

  async findByCharacter(characterId: string): Promise<Relation[]> {
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (c1:Character {id: $charId})-[r:RELATES_TO]->(c2:Character) RETURN c1.id AS sourceId, c2.id AS targetId, r
         UNION
         MATCH (c2:Character)-[r:RELATES_TO]->(c1:Character {id: $charId}) RETURN c2.id AS sourceId, c1.id AS targetId, r`,
        { charId: characterId }
      );
      return result.records.map(r => {
        const rel = r.get('r').properties;
        return { ...rel, sourceId: r.get('sourceId'), targetId: r.get('targetId') } as Relation;
      });
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
        `MATCH (c1:Character {novelId: $novelId})-[r:RELATES_TO]->(c2:Character)
         WHERE r.createdStep = $step
         DELETE r`,
        { novelId, step: stepNumber }
      );
    } finally {
      await session.close();
    }
  }
}

export const relationRepo = new RelationRepo();
