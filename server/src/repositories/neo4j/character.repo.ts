import { getSession } from './connection';
import { Character, CharacterProfile, DisambiguationStatus } from '../../types';
import { v4 as uuid } from 'uuid';

export class CharacterRepo {
  async create(data: Omit<Character, 'id'>): Promise<Character> {
    const session = getSession();
    try {
      const character: Character = { id: uuid(), ...data };
      await session.run(`CREATE (c:Character $props)`, { props: character });
      await session.run(
        `MATCH (n:Novel {id: $novelId}), (c:Character {id: $charId})
         CREATE (n)-[:HAS_CHARACTER]->(c)`,
        { novelId: data.novelId, charId: character.id }
      );
      return character;
    } finally {
      await session.close();
    }
  }

  async findById(id: string): Promise<Character | null> {
    const session = getSession();
    try {
      const result = await session.run(`MATCH (c:Character {id: $id}) RETURN c`, { id });
      if (result.records.length === 0) return null;
      return result.records[0].get('c').properties as Character;
    } finally {
      await session.close();
    }
  }

  async findByNovelId(novelId: string): Promise<Character[]> {
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (n:Novel {id: $novelId})-[:HAS_CHARACTER]->(c:Character) RETURN c`,
        { novelId }
      );
      return result.records.map(r => r.get('c').properties as Character);
    } finally {
      await session.close();
    }
  }

  async findByNameOrAlias(novelId: string, name: string): Promise<Character[]> {
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (n:Novel {id: $novelId})-[:HAS_CHARACTER]->(c:Character)
         WHERE c.name CONTAINS $name OR ANY(alias IN c.aliases WHERE alias CONTAINS $name)
         RETURN c`,
        { novelId, name }
      );
      return result.records.map(r => r.get('c').properties as Character);
    } finally {
      await session.close();
    }
  }

  async update(id: string, data: Partial<Character>): Promise<void> {
    const session = getSession();
    try {
      // 白名单校验：只允许更新已知字段
      const allowedFields = new Set([
        'name', 'aliases', 'gender', 'faction', 'identity', 'description',
        'firstAppearChapter', 'isProtagonist', 'protagonistOrder',
        'disambiguationStatus', 'novelId',
      ]);
      const safeData: Record<string, any> = {};
      for (const [k, v] of Object.entries(data)) {
        if (allowedFields.has(k)) safeData[k] = v;
      }
      if (Object.keys(safeData).length === 0) return;

      const setClauses = Object.keys(safeData).map(k => `c.${k} = $${k}`).join(', ');
      await session.run(
        `MATCH (c:Character {id: $id}) SET ${setClauses}`,
        { id, ...safeData }
      );
    } finally {
      await session.close();
    }
  }

  async mergeCharacters(primaryId: string, mergeIds: string[]): Promise<void> {
    const session = getSession();
    try {
      for (const mergeId of mergeIds) {
        // 1. 获取被合并角色的所有出边属性
        const outEdges = await session.run(
          `MATCH (merge:Character {id: $mergeId})-[r:RELATES_TO]->(c2:Character)
           RETURN c2.id AS targetId, properties(r) AS props`,
          { mergeId }
        );
        // 2. 获取被合并角色的所有入边属性
        const inEdges = await session.run(
          `MATCH (c2:Character)-[r:RELATES_TO]->(merge:Character {id: $mergeId})
           RETURN c2.id AS sourceId, properties(r) AS props`,
          { mergeId }
        );

        // 3. 为主角色创建新边（携带原属性）
        for (const record of outEdges.records) {
          const targetId = record.get('targetId');
          const props = record.get('props');
          await session.run(
            `MATCH (primary:Character {id: $primaryId}), (target:Character {id: $targetId})
             CREATE (primary)-[:RELATES_TO]->(target)`,
            { primaryId, targetId }
          );
          // 设置边属性
          if (props && Object.keys(props).length > 0) {
            const setClauses = Object.keys(props).map(k => `r.${k} = $prop_${k}`).join(', ');
            await session.run(
              `MATCH (primary:Character {id: $primaryId})-[r:RELATES_TO]->(target:Character {id: $targetId})
               SET ${setClauses}`,
              { primaryId, targetId, ...Object.fromEntries(Object.keys(props).map(k => [`prop_${k}`, props[k]])) }
            );
          }
        }
        for (const record of inEdges.records) {
          const sourceId = record.get('sourceId');
          const props = record.get('props');
          await session.run(
            `MATCH (source:Character {id: $sourceId}), (primary:Character {id: $primaryId})
             CREATE (source)-[:RELATES_TO]->(primary)`,
            { primaryId, sourceId }
          );
          if (props && Object.keys(props).length > 0) {
            const setClauses = Object.keys(props).map(k => `r.${k} = $prop_${k}`).join(', ');
            await session.run(
              `MATCH (source:Character {id: $sourceId})-[r:RELATES_TO]->(primary:Character {id: $primaryId})
               SET ${setClauses}`,
              { primaryId, sourceId, ...Object.fromEntries(Object.keys(props).map(k => [`prop_${k}`, props[k]])) }
            );
          }
        }

        // 4. 将被合并角色的名字添加到主角色别名
        await session.run(
          `MATCH (primary:Character {id: $primaryId}), (merge:Character {id: $mergeId})
           SET primary.aliases = primary.aliases + merge.name`,
          { primaryId, mergeId }
        );

        // 5. 删除被合并角色（DETACH DELETE 自动删除其所有关系）
        await session.run(`MATCH (c:Character {id: $mergeId}) DETACH DELETE c`, { mergeId });
      }
    } finally {
      await session.close();
    }
  }

  async search(novelId: string, keyword: string): Promise<Character[]> {
    const session = getSession();
    try {
      // 使用 CONTAINS 替代正则，避免注入风险
      // 同时搜索名字和别名
      const result = await session.run(
        `MATCH (n:Novel {id: $novelId})-[:HAS_CHARACTER]->(c:Character)
         WHERE c.name CONTAINS $keyword OR ANY(alias IN c.aliases WHERE alias CONTAINS $keyword)
         RETURN c`,
        { novelId, keyword }
      );
      return result.records.map(r => r.get('c').properties as Character);
    } finally {
      await session.close();
    }
  }

  async setProtagonist(id: string, isProtagonist: boolean, order?: number): Promise<void> {
    const session = getSession();
    try {
      const params: any = { id, isProtagonist };
      let extraSet = '';
      if (order !== undefined) {
        params.protagonistOrder = order;
        extraSet = ', c.protagonistOrder = $protagonistOrder';
      }
      await session.run(
        `MATCH (c:Character {id: $id}) SET c.isProtagonist = $isProtagonist${extraSet}`,
        params
      );
    } finally {
      await session.close();
    }
  }

  async getProtagonists(novelId: string): Promise<Character[]> {
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (n:Novel {id: $novelId})-[:HAS_CHARACTER]->(c:Character)
         WHERE c.isProtagonist = true
         RETURN c ORDER BY c.protagonistOrder`,
        { novelId }
      );
      return result.records.map(r => r.get('c').properties as Character);
    } finally {
      await session.close();
    }
  }
}

export const characterRepo = new CharacterRepo();
