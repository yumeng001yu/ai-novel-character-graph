import { getRedis } from './connection';
import { BuildTask, TaskStatus } from '../../types';

const KEY_PREFIX = 'task:';

export class TaskQueueRepo {
  async setTask(novelId: string, task: BuildTask): Promise<void> {
    const redis = getRedis();
    await redis.set(`${KEY_PREFIX}${novelId}`, JSON.stringify(task));
  }

  async getTask(novelId: string): Promise<BuildTask | null> {
    const redis = getRedis();
    const data = await redis.get(`${KEY_PREFIX}${novelId}`);
    return data ? JSON.parse(data) : null;
  }

  async updateStatus(novelId: string, status: TaskStatus): Promise<void> {
    const task = await this.getTask(novelId);
    if (task) {
      task.status = status;
      await this.setTask(novelId, task);
    }
  }

  async updateProgress(novelId: string, currentStep: number): Promise<void> {
    const task = await this.getTask(novelId);
    if (task) {
      task.currentStep = currentStep;
      await this.setTask(novelId, task);
    }
  }

  async deleteTask(novelId: string): Promise<void> {
    const redis = getRedis();
    await redis.del(`${KEY_PREFIX}${novelId}`);
  }
}

export const taskQueueRepo = new TaskQueueRepo();
