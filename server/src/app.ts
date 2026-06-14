import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { loadConfig } from './config';
import { getLogger } from './utils/logger';
import { registerRoutes } from './routes';
import { characterRepo } from './repositories/neo4j/character.repo';
import { configureRedisPersistence } from './repositories/redis/connection';
import { taskQueueRepo } from './repositories/redis/task-queue.repo';

async function main() {
  const config = loadConfig();
  const logger = getLogger();

  // 创建 Neo4j 索引（启动时执行一次）
  try {
    await characterRepo.ensureIndexes();
  } catch (err) {
    logger.warn(err, 'Neo4j 索引初始化失败（非致命）');
  }

  // 配置 Redis AOF 持久化
  await configureRedisPersistence();

  // 恢复中断的任务：将 running 状态标记为 interrupted
  try {
    const interruptedCount = await taskQueueRepo.markRunningAsInterrupted();
    if (interruptedCount > 0) {
      logger.info(`${interruptedCount} 个任务因服务重启标记为 interrupted，可手动续建`);
    }
  } catch (err) {
    logger.warn(err, '任务恢复检查失败（非致命）');
  }

  const app = Fastify({
    logger: false,
    bodyLimit: config.build.max_file_size_mb * 1024 * 1024,
  });

  // 注册插件
  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: {
      fileSize: config.build.max_file_size_mb * 1024 * 1024,
    },
  });

  // 注册路由
  registerRoutes(app);

  // 启动服务
  try {
    await app.listen({
      port: config.server.port,
      host: config.server.host,
    });
    logger.info(`服务器启动: http://${config.server.host}:${config.server.port}`);
  } catch (err) {
    logger.error(err, '服务器启动失败');
    process.exit(1);
  }
}

main();
