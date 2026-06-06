import { getRedis } from './connection';
import { StepProgress, AILogEntry, AIStreamEvent } from '../../types';
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

  /**
   * 推送 AI 调用日志（独立于进度更新，实时性更高）
   */
  async publishAILog(novelId: string, aiLog: AILogEntry): Promise<void> {
    const redis = getRedis();
    await redis.publish(`progress:${novelId}`, JSON.stringify({ aiLog }));
  }

  /**
   * 推送 AI 流式事件（逐字输出）
   */
  async publishAIStream(novelId: string, event: AIStreamEvent): Promise<void> {
    const redis = getRedis();
    await redis.publish(`progress:${novelId}`, JSON.stringify({ aiStream: event }));
  }
}

export const progressRepo = new ProgressRepo();
