import Redis from 'ioredis';
import { getConfig } from '../../config';
import { getLogger } from '../../utils/logger';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (redis) return redis;
  const config = getConfig();
  redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password || undefined,
    db: config.redis.db,
  });
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    redis.disconnect();
    redis = null;
  }
}

export async function checkRedisConnection(): Promise<boolean> {
  try {
    const r = getRedis();
    await r.ping();
    return true;
  } catch (err) {
    getLogger().error(err, 'Redis 连接失败');
    return false;
  }
}
