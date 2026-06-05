import { getSession } from './connection';
import { Event } from '../../types';
import { v4 as uuid } from 'uuid';

export class EventRepo {
  async create(data: Omit<Event, 'id'>): Promise<Event> {
    const session = getSession();
    try {
      const event: Event = { id: uuid(), ...data };
      await session.run(`CREATE (e:Event $props)`, { props: event });
      // 关联到小说
      await session.run(
        `MATCH (n:Novel {id: $novelId}), (e:Event {id: $eventId})
         CREATE (n)-[:HAS_EVENT]->(e)`,
        { novelId: data.novelId, eventId: event.id }
      );
      // 关联到章节
      await session.run(
        `MATCH (e:Event {id: $eventId}), (c:Chapter {novelId: $novelId, index: $chapter})
         CREATE (e)-[:HAPPENS_IN]->(c)`,
        { eventId: event.id, novelId: data.novelId, chapter: data.chapter }
      );
      return event;
    } finally {
      await session.close();
    }
  }

  async findByNovelId(novelId: string): Promise<Event[]> {
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (n:Novel {id: $novelId})-[:HAS_EVENT]->(e:Event) RETURN e ORDER BY e.chapter`,
        { novelId }
      );
      return result.records.map(r => r.get('e').properties as Event);
    } finally {
      await session.close();
    }
  }

  async findByChapter(novelId: string, chapter: number): Promise<Event[]> {
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (e:Event {novelId: $novelId, chapter: $chapter}) RETURN e`,
        { novelId, chapter }
      );
      return result.records.map(r => r.get('e').properties as Event);
    } finally {
      await session.close();
    }
  }
}

export const eventRepo = new EventRepo();
