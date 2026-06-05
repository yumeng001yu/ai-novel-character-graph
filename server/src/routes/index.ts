import { FastifyInstance } from 'fastify';
import { novelRoutes } from './novel.route';
import { graphRoutes } from './graph.route';
import { characterRoutes } from './character.route';
import { snapshotRoutes } from './snapshot.route';
import { taskRoutes } from './task.route';
import { continueRoutes } from './continue.route';
import { settingsRoutes } from './settings.route';
import { exportRoutes } from './export.route';

export function registerRoutes(app: FastifyInstance): void {
  app.register(novelRoutes, { prefix: '/api/novels' });
  app.register(graphRoutes, { prefix: '/api/novels' });
  app.register(characterRoutes, { prefix: '/api/characters' });
  app.register(snapshotRoutes, { prefix: '/api/novels' });
  app.register(taskRoutes, { prefix: '/api/novels' });
  app.register(continueRoutes, { prefix: '/api/novels' });
  app.register(settingsRoutes, { prefix: '/api/settings' });
  app.register(exportRoutes, { prefix: '/api/novels' });
}
