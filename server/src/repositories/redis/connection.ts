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
    // 持久化相关配置：启用 AOF 每秒刷盘，防止断电数据丢失
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
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

/**
 * 配置 Redis 持久化（AOF 模式，每秒刷盘）
 * 在服务启动时调用一次
 */
export async function configureRedisPersistence(): Promise<void> {
  const logger = getLogger();
  try {
    const r = getRedis();
    // 启用 AOF 持久化，每秒刷盘（平衡性能与数据安全）
    await r.config('SET', 'appendonly', 'yes');
    await r.config('SET', 'appendfsync', 'everysec');
    // 自动重写 AOF 文件（体积翻倍时触发）
    await r.config('SET', 'auto-aof-rewrite-percentage', '100');
    await r.config('SET', 'auto-aof-rewrite-min-size', '64mb');
    logger.info('Redis AOF 持久化已配置（appendfsync=everysec）');
  } catch (err) {
    logger.warn(err, 'Redis AOF 持久化配置失败（非致命，可能无权限修改配置）');
  }
}
