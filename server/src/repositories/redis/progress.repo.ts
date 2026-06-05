import { getRedis } from './connection';
import { StepProgress } from '../../types';

const KEY_PREFIX = 'progress:';

export class ProgressRepo {
  async setProgress(novelId: string, progress: StepProgress): Promise<void> {
    const redis = getRedis();
    await redis.set(`${KEY_PREFIX}${novelId}`, JSON.stringify(progress));
    // 发布进度更新事件
    await redis.publish(`progress:${novelId}`, JSON.stringify(progress));
  }

  async getProgress(novelId: string): Promise<StepProgress | null> {
    const redis = getRedis();
    const data = await redis.get(`${KEY_PREFIX}${novelId}`);
    return data ? JSON.parse(data) : null;
  }

  async deleteProgress(novelId: string): Promise<void> {
    const redis = getRedis();
    await redis.del(`${KEY_PREFIX}${novelId}`);
  }
}

export const progressRepo = new ProgressRepo();
