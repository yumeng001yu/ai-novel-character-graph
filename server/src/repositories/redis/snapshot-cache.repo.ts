import { getRedis } from './connection';

const KEY_PREFIX = 'snapshot_meta:';

export class SnapshotCacheRepo {
  async setMeta(novelId: string, step: number, meta: { filePath: string; nodeCount: number; edgeCount: number; createdAt: string }): Promise<void> {
    const redis = getRedis();
    await redis.set(`${KEY_PREFIX}${novelId}:${step}`, JSON.stringify(meta));
  }

  async getMeta(novelId: string, step: number): Promise<any | null> {
    const redis = getRedis();
    const data = await redis.get(`${KEY_PREFIX}${novelId}:${step}`);
    return data ? JSON.parse(data) : null;
  }

  async deleteMeta(novelId: string, step: number): Promise<void> {
    const redis = getRedis();
    await redis.del(`${KEY_PREFIX}${novelId}:${step}`);
  }
}

export const snapshotCacheRepo = new SnapshotCacheRepo();
