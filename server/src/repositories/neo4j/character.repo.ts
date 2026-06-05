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
      const setClauses = Object.keys(data).map(k => `c.${k} = $${k}`).join(', ');
      await session.run(
        `MATCH (c:Character {id: $id}) SET ${setClauses}`,
        { id, ...data }
      );
    } finally {
      await session.close();
    }
  }

  async mergeCharacters(primaryId: string, mergeIds: string[]): Promise<void> {
    const session = getSession();
    try {
      const tx = session.beginTransaction();
      // 将被合并角色的关系转移到主角色
      for (const mergeId of mergeIds) {
        await tx.run(
          `MATCH (c1:Character {id: $mergeId})-[r:RELATES_TO]->(c2)
           CREATE (c3:Character {id: $primaryId})-[:RELATES_TO]->(c2)
           SET c3 += properties(r)`,
          { mergeId, primaryId }
        );
        await tx.run(
          `MATCH (c2)-[r:RELATES_TO]->(c1:Character {id: $mergeId})
           CREATE (c2)-[:RELATES_TO]->(c3:Character {id: $primaryId})
           SET c3 += properties(r)`,
          { mergeId, primaryId }
        );
        // 删除被合并角色
        await tx.run(`MATCH (c:Character {id: $mergeId}) DETACH DELETE c`, { mergeId });
      }
      await tx.commit();
    } finally {
      await session.close();
    }
  }

  async search(novelId: string, keyword: string): Promise<Character[]> {
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (n:Novel {id: $novelId})-[:HAS_CHARACTER]->(c:Character)
         WHERE c.name =~ $regex OR ANY(alias IN c.aliases WHERE alias =~ $regex)
         RETURN c`,
        { novelId, regex: `(?i).*${keyword}.*` }
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
