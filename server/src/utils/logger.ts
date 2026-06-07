import pino from 'pino';
import { getConfig } from '../config';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

let logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (logger) return logger;

  const config = getConfig();
  const isDev = process.env.NODE_ENV !== 'production';

  // Ensure log directory exists
  const logDir = join(process.cwd(), 'logs');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const logFile = join(logDir, 'app.log');

  if (isDev) {
    logger = pino({
      level: config.log.level,
      transport: { target: 'pino-pretty', options: { colorize: true } },
    });
  } else {
    // Production: write to file + stdout (via multistream)
    const fileDest = pino.destination({ dest: logFile, sync: false });
    const stdoutDest = pino.destination({ dest: 1, sync: false }); // stdout = fd 1
    logger = pino({
      level: config.log.level,
    }, pino.multistream([fileDest, stdoutDest]));
  }

  return logger;
}