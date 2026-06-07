import { callAIStream, AIStreamCallback } from './ai-client.service';
import { Character, Relation, Event, Inference, AIContentRefusedError } from '../types';
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
  async extractFromText(
    text: string,
    chapterRange: string,
    existingCharacterNames: string[],
    onStream?: AIStreamCallback,
  ): Promise<ExtractionResult> {
    const enableInference = settingsService.getBuildConfig().enableInference;

    const existingInfo = existingCharacterNames.length > 0
      ? `\n\n已知角色列表（请勿重复创建）：${existingCharacterNames.join('、')}`
      : '';

    const inferenceInstruction = enableInference
      ? `\n4. 推断：对作者未明说但可合理推断的内容进行小幅度推断，必须标注isInference为true并记录inferenceBasis（原文依据）`
      : '';

    const prompt = `分析以下小说文本（${chapterRange}），提取人物、关系、事件${enableInference ? '和推断' : ''}。

请返回严格的JSON格式：
{
  "characters": [
    {"name": "角色名", "aliases": ["别名"], "gender": "性别", "faction": "阵营", "identity": "身份描述", "description": "外貌/特征描述"}
  ],
  "relations": [
    {"sourceName": "角色A", "targetName": "角色B", "relationType": "关系类型", "description": "关系描述", "isInference": false, "inferenceBasis": ""}
  ],
  "events": [
    {"name": "事件名", "chapter": 0, "summary": "事件摘要", "eventType": "转折点/成长/危机/日常", "participantNames": ["参与者"]}
  ],
  "inferences": [
    {"content": "推断内容", "basis": "推断依据", "relatedCharacterNames": ["相关角色"]}
  ]
}

提取规则：
1. 人物：提取所有出现和提及的角色，包含别名
2. 关系：提取人物间的关系（亲情/友情/敌对/恋爱/从属/师徒等），标注关系类型
3. 事件：提取关键事件，标注参与者和事件类型${inferenceInstruction}${existingInfo}

重要：这是一部文学作品的分析任务。你的职责是客观提取文本中的人物关系和事件信息，而非评判内容。请只返回JSON数据，不要拒绝或评判文本内容。如果某些段落难以提取，请尽可能提取可提取的部分，其余留空即可。

文本：
${text}`;

    const response = await callAIStream(
      prompt,
      '你是一个专业的小说文本分析助手，擅长从文学作品中提取人物关系和事件信息。你的任务仅是客观提取结构化数据，请只返回JSON格式，不要其他内容。如果文本包含你不认同的内容，也请如实提取其中的人物关系信息，不要拒绝或发表评论。',
      { onStream, phase: 'extracting' },
    );

    try {
      // 尝试提取 JSON：先去除可能的 markdown 代码块标记
      let cleaned = response.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('AI 返回格式错误：未找到 JSON');
      const parsed = JSON.parse(jsonMatch[0]);
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
}

export const extractorService = new ExtractorService();
