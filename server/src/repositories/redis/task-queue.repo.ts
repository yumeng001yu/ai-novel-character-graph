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
    // 使用 Lua 脚本保证原子性：读取-修改-写入
    const redis = getRedis();
    const script = `
      local data = redis.call('GET', KEYS[1])
      if not data then return 0 end
      local task = cjson.decode(data)
      task.status = ARGV[1]
      redis.call('SET', KEYS[1], cjson.encode(task))
      return 1
    `;
    await redis.eval(script, 1, `${KEY_PREFIX}${novelId}`, status);
  }

  async updateProgress(novelId: string, currentStep: number): Promise<void> {
    // 使用 Lua 脚本保证原子性
    const redis = getRedis();
    const script = `
      local data = redis.call('GET', KEYS[1])
      if not data then return 0 end
      local task = cjson.decode(data)
      task.currentStep = tonumber(ARGV[1])
      redis.call('SET', KEYS[1], cjson.encode(task))
      return 1
    `;
    await redis.eval(script, 1, `${KEY_PREFIX}${novelId}`, currentStep);
  }

  async deleteTask(novelId: string): Promise<void> {
    const redis = getRedis();
    await redis.del(`${KEY_PREFIX}${novelId}`);
  }
}

export const taskQueueRepo = new TaskQueueRepo();
