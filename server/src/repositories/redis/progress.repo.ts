import { getRedis } from './connection';
import { StepProgress } from '../../types';
import { taskQueueRepo } from './task-queue.repo';

const KEY_PREFIX = 'progress:';

export class ProgressRepo {
  async setProgress(novelId: string, progress: StepProgress): Promise<void> {
    const redis = getRedis();
    await redis.set(`${KEY_PREFIX}${novelId}`, JSON.stringify(progress));
    // 发布进度更新事件（包含 task 信息供 SSE 使用）
    const task = await taskQueueRepo.getTask(novelId);
    await redis.publish(`progress:${novelId}`, JSON.stringify({ progress, task }));
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
