import { Character } from '../types';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { callAI } from './ai-client.service';
import { getLogger } from '../utils/logger';

const logger = getLogger();

export class ProtagonistDetectorService {
  async detectProtagonists(novelId: string): Promise<Character[]> {
    const characters = await characterRepo.findByNovelId(novelId);
    if (characters.length === 0) return [];

    const charList = characters.map(c =>
      `${c.name}(出场章:${c.firstAppearChapter},身份:${c.identity || '未知'})`
    ).join('\n');

    const prompt = `分析以下角色列表，判断哪些是小说的主角。

角色列表：
${charList}

请返回JSON数组，按主角重要性排序：
[{"name": "角色名", "isProtagonist": true, "reason": "判断理由"}]

只返回主角，非主角不需要列出。`;

    try {
      const response = await callAI(prompt, '你是小说分析专家，擅长判断主角。');
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('AI 返回格式错误');
      const parsed = JSON.parse(jsonMatch[0]);

      const protagonists: Character[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        const char = characters.find(c => c.name === item.name);
        if (char && item.isProtagonist) {
          await characterRepo.setProtagonist(char.id, true, i + 1);
          protagonists.push({ ...char, isProtagonist: true, protagonistOrder: i + 1 });
        }
      }

      logger.info(`主角识别完成：${protagonists.map(p => p.name).join('、')}`);
      return protagonists;
    } catch (err) {
      logger.error(err, '主角识别失败');
      // 回退：第一个角色作为主角
      if (characters.length > 0) {
        await characterRepo.setProtagonist(characters[0].id, true, 1);
        return [characters[0]];
      }
      return [];
    }
  }
}

export const protagonistDetectorService = new ProtagonistDetectorService();
