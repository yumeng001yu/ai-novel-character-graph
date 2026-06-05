import { getSession } from './connection';
import { Chapter } from '../../types';

export class ChapterRepo {
  async createBatch(chapters: Chapter[]): Promise<void> {
    const session = getSession();
    try {
      const tx = session.beginTransaction();
      for (const ch of chapters) {
        await tx.run(
          `CREATE (c:Chapter $props)`,
          { props: ch }
        );
        await tx.run(
          `MATCH (n:Novel {id: $novelId}), (c:Chapter {id: $chapterId})
           CREATE (n)-[:HAS_CHAPTER {order: $index}]->(c)`,
          { novelId: ch.novelId, chapterId: ch.id, index: ch.index }
        );
      }
      await tx.commit();
    } finally {
      await session.close();
    }
  }

  async findByNovelId(novelId: string): Promise<Chapter[]> {
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (n:Novel {id: $novelId})-[:HAS_CHAPTER]->(c:Chapter) RETURN c ORDER BY c.index`,
        { novelId }
      );
      return result.records.map(r => r.get('c').properties as Chapter);
    } finally {
      await session.close();
    }
  }

  async findById(id: string): Promise<Chapter | null> {
    const session = getSession();
    try {
      const result = await session.run(`MATCH (c:Chapter {id: $id}) RETURN c`, { id });
      if (result.records.length === 0) return null;
      return result.records[0].get('c').properties as Chapter;
    } finally {
      await session.close();
    }
  }
}

export const chapterRepo = new ChapterRepo();
