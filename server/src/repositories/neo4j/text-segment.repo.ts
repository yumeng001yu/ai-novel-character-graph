import { getSession } from './connection';
import { TextSegment } from '../../types';
import { v4 as uuid } from 'uuid';

export class TextSegmentRepo {
  async create(data: Omit<TextSegment, 'id'>): Promise<TextSegment> {
    const session = getSession();
    try {
      const segment: TextSegment = { id: uuid(), ...data };
      await session.run(`CREATE (t:TextSegment $props)`, { props: segment });
      return segment;
    } finally {
      await session.close();
    }
  }

  async findByNovelId(novelId: string): Promise<TextSegment[]> {
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (t:TextSegment {novelId: $novelId}) RETURN t ORDER BY t.startOffset`,
        { novelId }
      );
      return result.records.map(r => r.get('t').properties as TextSegment);
    } finally {
      await session.close();
    }
  }

  async getFingerprints(novelId: string): Promise<string[]> {
    const segments = await this.findByNovelId(novelId);
    return segments.map(s => s.contentHash);
  }
}

export const textSegmentRepo = new TextSegmentRepo();
