import fs from 'fs';
import path from 'path';
import { AiConfig } from '../../types';
import { getConfig } from '../../config';
import { getLogger } from '../../utils/logger';

const logger = getLogger();

function getSettingsPath(): string {
  const config = getConfig();
  return path.resolve(path.dirname(config.encryption.key_file), 'ai-settings.json');
}

export class AiSettingsRepo {
  async load(): Promise<AiConfig | null> {
    const filePath = getSettingsPath();
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data) as AiConfig;
    } catch (err) {
      logger.error(err, '加载 AI 配置失败');
      return null;
    }
  }

  async save(config: AiConfig): Promise<void> {
    const filePath = getSettingsPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
  }
}

export const aiSettingsRepo = new AiSettingsRepo();
