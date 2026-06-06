import { Character } from '../types';
import { characterRepo } from '../repositories/neo4j/character.repo';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config';
import { getLogger } from '../utils/logger';

const logger = getLogger();

export class SearchIndexerService {
  async buildIndex(novelId: string): Promise<void> {
    const characters = await characterRepo.findByNovelId(novelId);
    const index: Record<string, string> = {};

    for (const char of characters) {
      index[char.name] = char.id;
      for (const alias of char.aliases) {
        index[alias] = char.id;
      }
    }

    const filePath = this.getIndexPath(novelId);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(index, null, 2));

    logger.info(`搜索索引构建完成：${Object.keys(index).length} 条记录`);
  }

  async search(novelId: string, keyword: string): Promise<Character[]> {
    return characterRepo.search(novelId, keyword);
  }

  private getIndexPath(novelId: string): string {
    // 安全校验：防止路径遍历
    if (novelId.includes('/') || novelId.includes('\\') || novelId.includes('..')) {
      throw new Error('无效的小说ID');
    }
    const config = getConfig();
    return path.resolve(config.build.snapshot_dir, '..', 'search_index', `${novelId}.json`);
  }
}

export const searchIndexerService = new SearchIndexerService();
