import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { loadConfig } from './config';
import { getLogger } from './utils/logger';
import { registerRoutes } from './routes';

async function main() {
  const config = loadConfig();
  const logger = getLogger();

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
