import { callAIStream, AIStreamCallback } from './ai-client.service';
import { Character, Relation, Event, Inference, AIContentRefusedError } from '../types';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { relationRepo } from '../repositories/neo4j/relation.repo';
import { eventRepo } from '../repositories/neo4j/event.repo';
import { getLogger } from '../utils/logger';
import { v4 as uuid } from 'uuid';
import { settingsService } from './settings.service';

const logger = getLogger();

export interface ExtractionResult {
  characters: Array<{
    name: string;
    aliases: string[];
    gender?: string;
    faction?: string;
    identity?: string;
    description: string;
  }>;
  relations: Array<{
    sourceName: string;
    targetName: string;
    relationType: string;
    description: string;
    isInference: boolean;
    inferenceBasis?: string;
  }>;
  events: Array<{
    name: string;
    chapter: number;
    summary: string;
    eventType: string;
    participantNames: string[];
  }>;
  inferences: Array<{
    content: string;
    basis: string;
    relatedCharacterNames: string[];
  }>;
}

export class ExtractorService {
  /**
   * 生成已有图谱的结构化摘要（供下一步提取时作为上下文）
   * 将角色、关系、事件压缩为简洁文本，token消耗远低于原文
   */
  async generateGraphSummary(novelId: string): Promise<string> {
    const characters = await characterRepo.findByNovelId(novelId);
    if (characters.length === 0) return '';

    const relations = await relationRepo.findByNovelId(novelId);
    const events = await eventRepo.findByNovelId(novelId);

    const parts: string[] = [];

    // 角色摘要：名字+身份+阵营（每个角色约20-30字）
    const charSummary = characters.map(c => {
      const parts = [c.name];
      if (c.aliases?.length) parts.push(`别名:${c.aliases.join('/')}`);
      if (c.identity) parts.push(c.identity);
      if (c.faction) parts.push(`[${c.faction}]`);
      return parts.join(' ');
    }).join('\n');
    parts.push(`【已有角色】(${characters.length}个)\n${charSummary}`);

    // 关系摘要：A→B 关系类型（每条约15字）
    if (relations.length > 0) {
      const relSummary = relations.slice(0, 100).map(r =>
        `${r.sourceName} → ${r.targetName}: ${r.relationType}`
      ).join('\n');
      parts.push(`【已有关系】(${relations.length}条)\n${relSummary}`);
    }

    // 事件摘要：章节+事件名（每个约15字）
    if (events.length > 0) {
      const evtSummary = events.sort((a, b) => a.chapter - b.chapter).slice(0, 50).map(e =>
        `第${e.chapter}章 ${e.name}: ${e.summary.substring(0, 20)}`
      ).join('\n');
      parts.push(`【已有事件】(${events.length}个)\n${evtSummary}`);
    }

    return parts.join('\n\n');
  }

  async extractFromText(
    text: string,
    chapterRange: string,
    existingCharacterNames: string[],
    onStream?: AIStreamCallback,
    graphSummary?: string,
  ): Promise<ExtractionResult> {
    const enableInference = settingsService.getBuildConfig().enableInference;

    // 已有图谱上下文（核心改进：前步图谱摘要 + 当前步原文）
    let contextBlock = '';
    if (graphSummary && graphSummary.length > 0) {
      contextBlock = `

【前文已构建的图谱信息】
以下是前文已经提取并确认的角色、关系和事件。请参考这些信息来识别当前文本中的角色：
- 如果当前文本中的角色与已有角色是同一人，请使用相同的名字（不要创建新角色）
- 如果当前文本揭示了已有角色的新关系或新事件，请提取
- 如果当前文本出现了全新的角色，请正常创建

${graphSummary}`;
    } else if (existingCharacterNames.length > 0) {
      contextBlock = `\n\n已知角色列表（请勿重复创建）：${existingCharacterNames.join('、')}`;
    }

    const inferenceInstruction = enableInference
      ? `\n4. 推断：对作者未明说但可合理推断的内容进行小幅度推断，必须标注isInference为true并记录inferenceBasis（原文依据）`
      : '';

    const prompt = `分析以下小说文本（${chapterRange}），提取人物、关系、事件${enableInference ? '和推断' : ''}。
${contextBlock}

请返回严格的JSON格式：
{
  "characters": [
    {"name": "角色名", "aliases": ["别名"], "gender": "性别", "faction": "阵营", "identity": "身份描述", "description": "外貌/特征描述"}
  ],
  "relations": [
    {"sourceName": "角色A", "targetName": "角色B", "relationType": "关系类型", "description": "关系描述", "isInference": false, "inferenceBasis": "", "confidence": 0.9, "importance": 8}
  ],
  "events": [
    {"name": "事件名", "chapter": 0, "summary": "事件摘要", "eventType": "转折点/成长/危机/日常", "participantNames": ["参与者"]}
  ],
  "inferences": [
    {"content": "推断内容", "basis": "推断依据", "relatedCharacterNames": ["相关角色"]}
  ]
}

提取规则：
1. 人物：必须提取文本中所有出现和提及的角色，包括仅被提及但未直接出场的角色。不要遗漏任何角色，即使只出现一次。包含别名。
2. 关系：提取人物间的关系（亲情/友情/敌对/恋爱/从属/师徒等），标注关系类型。如果已有角色之间出现了新关系，也要提取。
   - confidence（0-1）：关系在原文中的明确程度。原文直接描述=0.9-1.0，可合理推断=0.6-0.8，模糊猜测=0.3-0.5
   - importance（1-10）：关系对角色命运的影响程度。核心关系（如父子、夫妻）=8-10，重要关系=5-7，一般关系=3-4，轻微关联=1-2
3. 事件：提取关键事件，标注参与者和事件类型。关键事件包括：角色首次出场、重要决策、战斗、结盟、背叛、死亡等转折性事件。${inferenceInstruction}

特别注意：
- 对于首次出现的角色，务必在events中记录其首次出场事件
- 事件的chapter字段必须填写该事件发生的章节号（数字）
- 不要遗漏早期出场的重要角色
- 如果前文图谱中已有某个角色，当前文本中该角色有了新的发展或变化，请提取相关的新事件和新关系
- 不要重复提取前文图谱中已有的关系和事件，只提取当前文本中新出现的信息

重要：这是一部文学作品的分析任务。你的职责是客观提取文本中的人物关系和事件信息，而非评判内容。请只返回JSON数据，不要拒绝或评判文本内容。如果某些段落难以提取，请尽可能提取可提取的部分，其余留空即可。

文本：
${text}`;

    const response = await callAIStream(
      prompt,
      '你是一个专业的小说文本分析助手，擅长从文学作品中提取人物关系和事件信息。你的任务仅是客观提取结构化数据，请只返回JSON格式，不要其他内容。如果文本包含你不认同的内容，也请如实提取其中的人物关系信息，不要拒绝或发表评论。',
      { onStream, phase: 'extracting', maxTokens: 16384 },
    );

    try {
      // 尝试提取 JSON：先去除可能的 markdown 代码块标记
      let cleaned = response.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('AI 返回格式错误：未找到 JSON');

      let jsonStr = jsonMatch[0];
      let parsed: any;

      try {
        parsed = JSON.parse(jsonStr);
      } catch (parseErr) {
        // JSON 可能被 maxTokens 截断，尝试修复
        logger.warn('JSON 解析失败，尝试修复截断的 JSON...');
        parsed = this.repairTruncatedJSON(jsonStr);
      }

      // 验证必要字段存在
      return {
        characters: Array.isArray(parsed.characters) ? parsed.characters : [],
        relations: Array.isArray(parsed.relations) ? parsed.relations : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
        inferences: Array.isArray(parsed.inferences) ? parsed.inferences : [],
      } as ExtractionResult;
    } catch (err) {
      // AI 内容审核拒绝需要冒泡，不能被吞掉
      if (err instanceof AIContentRefusedError) throw err;
      logger.error({ err, response }, 'AI 提取结果解析失败');
      return { characters: [], relations: [], events: [], inferences: [] };
    }
  }

  /**
   * 修复被 maxTokens 截断的 JSON
   * 策略：逐步闭合未关闭的数组和对象
   */
  private repairTruncatedJSON(jsonStr: string): any {
    // 统计未闭合的括号
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escape = false;

    for (let i = 0; i < jsonStr.length; i++) {
      const ch = jsonStr[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') openBraces++;
      if (ch === '}') openBraces--;
      if (ch === '[') openBrackets++;
      if (ch === ']') openBrackets--;
    }

    // 如果在字符串中被截断，先关闭字符串
    if (inString) {
      jsonStr += '"';
    }

    // 移除末尾可能的不完整元素（如 "key": "val 中的值被截断）
    // 尝试找到最后一个完整的数组元素或对象属性
    let repaired = jsonStr;

    // 逐步闭合括号
    for (let i = 0; i < openBrackets; i++) {
      repaired += ']';
    }
    for (let i = 0; i < openBraces; i++) {
      repaired += '}';
    }

    try {
      return JSON.parse(repaired);
    } catch (e) {
      // 如果简单修复不行，尝试更激进的修复：移除最后一个不完整的元素
      // 找到最后一个逗号或冒号的位置，截断到那里
      const lastComma = repaired.lastIndexOf(',');
      const lastColon = repaired.lastIndexOf(':');

      if (lastComma > lastColon && lastComma > 0) {
        // 截断到最后一个逗号之前
        let truncated = repaired.substring(0, lastComma);
        // 重新计算需要闭合的括号
        let ob = 0, ok = 0, is = false, es = false;
        for (let i = 0; i < truncated.length; i++) {
          const ch = truncated[i];
          if (es) { es = false; continue; }
          if (ch === '\\' && is) { es = true; continue; }
          if (ch === '"') { is = !is; continue; }
          if (is) continue;
          if (ch === '{') ob++;
          if (ch === '}') ob--;
          if (ch === '[') ok++;
          if (ch === ']') ok--;
        }
        if (is) truncated += '"';
        for (let i = 0; i < ok; i++) truncated += ']';
        for (let i = 0; i < ob; i++) truncated += '}';

        return JSON.parse(truncated);
      }

      throw new Error('JSON 修复失败：无法解析截断的 JSON');
    }
  }
}

export const extractorService = new ExtractorService();
