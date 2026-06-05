import pino from 'pino';
import { getConfig } from '../config';

let logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (logger) return logger;

  const config = getConfig();
  const isDev = process.env.NODE_ENV !== 'production';

  logger = pino({
    level: config.log.level,
    transport: isDev
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  });

  return logger;
}
