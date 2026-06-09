import { vectorSearchService } from './vector-search.service';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { relationRepo } from '../repositories/neo4j/relation.repo';
import { novelRepo } from '../repositories/neo4j/novel.repo';
import { callAIStream, AIStreamCallback } from './ai-client.service';
import { getLogger } from '../utils/logger';

const logger = getLogger();

export interface GraphRAGResult {
  answer: string;
  sources: Array<{
    type: 'character' | 'relation' | 'text_chunk' | 'novel';
    id?: string;
    name?: string;
    novelName?: string;
    stepNumber?: number;
    chapterRange?: string;
    score?: number;
  }>;
}

export class GraphRAGService {
  /**
   * 对小说进行 GraphRAG 查询
   * 1. 将问题向量化
   * 2. 从图谱中检索相关角色和关系
   * 3. 从原文中检索相关段落
   * 4. 组装上下文，调用 LLM 生成回答
   */
  async query(novelId: string, question: string, onStream?: AIStreamCallback): Promise<GraphRAGResult> {
    const novel = await novelRepo.findById(novelId);
    if (!novel) throw new Error('小说未找到');

    const sources: GraphRAGResult['sources'] = [];

    // 1. 语义搜索相关角色
    const characterResults = await vectorSearchService.semanticSearch(novelId, question, 10);
    const characterIds = characterResults.map(c => c.id);

    for (const cr of characterResults) {
      sources.push({ type: 'character', id: cr.id, name: cr.name, score: cr.score });
    }

    // 2. 查询相关角色的详细信息
    const characterDetails: Array<{ name: string; identity?: string; faction?: string; relations: string[] }> = [];
    for (const charId of characterIds) {
      const char = await characterRepo.findById(charId);
      if (!char) continue;

      const relations = await relationRepo.findByCharacter(charId);
      const relationDescs = relations.map(r => {
        const otherName = r.sourceId === charId ? r.targetName : r.sourceName;
        return `与${otherName || '未知'}是${r.relationType}关系（${r.description}）`;
      });

      characterDetails.push({
        name: char.name,
        identity: char.identity,
        faction: char.faction,
        relations: relationDescs,
      });

      for (const r of relations) {
        sources.push({ type: 'relation', id: r.id });
      }
    }

    // 3. 向量搜索相关原文段落
    const textChunks = await vectorSearchService.searchTextChunks(novelId, question, 5);
    for (const tc of textChunks) {
      sources.push({ type: 'text_chunk', id: tc.id, stepNumber: tc.stepNumber, chapterRange: tc.chapterRange, score: tc.score });
    }

    // 4. 组装上下文
    const characterSection = characterDetails.length > 0
      ? '## 相关角色\n' + characterDetails.map(cd => {
          const info = [cd.name];
          if (cd.identity) info.push(cd.identity);
          if (cd.faction) info.push(`阵营:${cd.faction}`);
          const prefix = info.join('、');
          if (cd.relations.length > 0) {
            return `- ${prefix}: ${cd.relations.join('；')}`;
          }
          return `- ${prefix}`;
        }).join('\n')
      : '## 相关角色\n未找到相关角色';

    const textChunkSection = textChunks.length > 0
      ? '## 相关原文\n' + textChunks.map(tc =>
          `[第${tc.stepNumber}步 ${tc.chapterRange}]\n${tc.text.length > 500 ? tc.text.substring(0, 500) + '...' : tc.text}`
        ).join('\n\n')
      : '## 相关原文\n未找到相关原文段落';

    const context = `${characterSection}\n\n${textChunkSection}\n\n## 问题\n${question}`;

    // 5. 调用 AI 生成回答
    const systemPrompt = `你是一个专业的小说分析助手。根据提供的角色关系信息和原文段落，回答用户关于小说的问题。
请基于提供的信息进行回答，如果信息不足，请如实说明。
回答时请引用相关的原文段落或角色信息作为依据。`;

    const answer = await callAIStream(
      context,
      systemPrompt,
      { onStream, phase: 'graphrag_query' },
    );

    return { answer, sources };
  }

  /**
   * 全局 GraphRAG 查询（跨所有小说）
   * 1. 将问题向量化
   * 2. 在所有小说中检索相关角色
   * 3. 检索相关原文段落
   * 4. 组装上下文，调用 LLM 生成回答
   */
  async globalQuery(question: string, onStream?: AIStreamCallback): Promise<GraphRAGResult> {
    const novels = await novelRepo.findAll();
    if (novels.length === 0) throw new Error('知识库为空，请先导入小说');

    const sources: GraphRAGResult['sources'] = [];

    // 1. 在所有小说中语义搜索相关角色
    const allCharacterResults: Array<{ id: string; name: string; score: number; novelId: string; novelName: string }> = [];
    for (const novel of novels) {
      const results = await vectorSearchService.semanticSearch(novel.id, question, 5);
      for (const r of results) {
        allCharacterResults.push({ ...r, novelId: novel.id, novelName: novel.name });
      }
    }
    // 按相似度排序，取 top 15
    allCharacterResults.sort((a, b) => b.score - a.score);
    const topCharacterResults = allCharacterResults.slice(0, 15);

    for (const cr of topCharacterResults) {
      sources.push({ type: 'character', id: cr.id, name: cr.name, novelName: cr.novelName, score: cr.score });
    }

    // 2. 查询相关角色的详细信息
    const characterDetails: Array<{ name: string; novelName: string; identity?: string; faction?: string; relations: string[] }> = [];
    for (const cr of topCharacterResults) {
      const char = await characterRepo.findById(cr.id);
      if (!char) continue;

      const relations = await relationRepo.findByCharacter(cr.id);
      const relationDescs = relations.map(r => {
        const otherName = r.sourceId === cr.id ? r.targetName : r.sourceName;
        return `与${otherName || '未知'}是${r.relationType}关系（${r.description}）`;
      });

      characterDetails.push({
        name: char.name,
        novelName: cr.novelName,
        identity: char.identity,
        faction: char.faction,
        relations: relationDescs,
      });

      for (const r of relations) {
        sources.push({ type: 'relation', id: r.id, novelName: cr.novelName });
      }
    }

    // 3. 在所有小说中搜索相关原文段落
    const allTextChunks: Array<{ id: string; stepNumber: number; chapterRange: string; text: string; score: number; novelName: string }> = [];
    for (const novel of novels) {
      const chunks = await vectorSearchService.searchTextChunks(novel.id, question, 3);
      for (const tc of chunks) {
        allTextChunks.push({ ...tc, novelName: novel.name });
      }
    }
    allTextChunks.sort((a, b) => b.score - a.score);
    const topTextChunks = allTextChunks.slice(0, 8);

    for (const tc of topTextChunks) {
      sources.push({ type: 'text_chunk', id: tc.id, stepNumber: tc.stepNumber, chapterRange: tc.chapterRange, novelName: tc.novelName, score: tc.score });
    }

    // 4. 组装上下文
    const characterSection = characterDetails.length > 0
      ? '## 相关角色\n' + characterDetails.map(cd => {
          const info = [`【${cd.novelName}】${cd.name}`];
          if (cd.identity) info.push(cd.identity);
          if (cd.faction) info.push(`阵营:${cd.faction}`);
          const prefix = info.join('、');
          if (cd.relations.length > 0) {
            return `- ${prefix}: ${cd.relations.join('；')}`;
          }
          return `- ${prefix}`;
        }).join('\n')
      : '## 相关角色\n未找到相关角色';

    const textChunkSection = topTextChunks.length > 0
      ? '## 相关原文\n' + topTextChunks.map(tc =>
          `【${tc.novelName}】[第${tc.stepNumber}步 ${tc.chapterRange}]\n${tc.text.length > 500 ? tc.text.substring(0, 500) + '...' : tc.text}`
        ).join('\n\n')
      : '## 相关原文\n未找到相关原文段落';

    const context = `${characterSection}\n\n${textChunkSection}\n\n## 问题\n${question}`;

    // 5. 调用 AI 生成回答
    const systemPrompt = `你是一个专业的小说知识库助手。用户会问关于知识库中多部小说的问题，你需要根据提供的角色关系信息和原文段落来回答。
请注意区分不同小说中的角色和情节，回答时标注角色来自哪部小说。
请基于提供的信息进行回答，如果信息不足，请如实说明。
回答时请引用相关的原文段落或角色信息作为依据。`;

    const answer = await callAIStream(
      context,
      systemPrompt,
      { onStream, phase: 'graphrag_global_query' },
    );

    return { answer, sources };
  }
}

export const graphragService = new GraphRAGService();
