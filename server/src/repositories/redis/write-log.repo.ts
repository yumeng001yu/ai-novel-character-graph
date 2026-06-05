import { getRedis } from './connection';
import { WriteLogEntry } from '../../types';

const KEY_PREFIX = 'writelog:';

export class WriteLogRepo {
  async appendLog(novelId: string, step: number, entries: WriteLogEntry[]): Promise<void> {
    const redis = getRedis();
    const key = `${KEY_PREFIX}${novelId}:${step}`;
    const serialized = entries.map(e => JSON.stringify(e));
    await redis.rpush(key, ...serialized);
  }

  async getLog(novelId: string, step: number): Promise<WriteLogEntry[]> {
    const redis = getRedis();
    const key = `${KEY_PREFIX}${novelId}:${step}`;
    const data = await redis.lrange(key, 0, -1);
    return data.map(d => JSON.parse(d));
  }

  async deleteLog(novelId: string, step: number): Promise<void> {
    const redis = getRedis();
    await redis.del(`${KEY_PREFIX}${novelId}:${step}`);
  }
}

export const writeLogRepo = new WriteLogRepo();
