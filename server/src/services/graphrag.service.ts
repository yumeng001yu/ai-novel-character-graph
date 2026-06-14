import { vectorSearchService } from './vector-search.service';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { relationRepo } from '../repositories/neo4j/relation.repo';
import { novelRepo } from '../repositories/neo4j/novel.repo';
import { callAIStream, AIStreamCallback } from './ai-client.service';
import { rerankerService } from './reranker.service';
import { getRedis } from '../repositories/redis/connection';
import { getLogger } from '../utils/logger';
import crypto from 'crypto';

const logger = getLogger();

// GraphRAG 查询缓存配置
const CACHE_PREFIX = 'graphrag:cache:';
const CACHE_TTL_SECONDS = 300; // 5分钟缓存

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
   * 对小说进行 GraphRAG 查询（混合检索：向量 + 关键词 + 图谱遍历）
   * 1. 三路召回：向量语义搜索 + 关键词搜索 + 图谱关系遍历
   * 2. 合并去重 + Reranker 精排
   * 3. 组装上下文，调用 LLM 生成回答
   */
  async query(novelId: string, question: string, onStream?: AIStreamCallback): Promise<GraphRAGResult> {
    const novel = await novelRepo.findById(novelId);
    if (!novel) throw new Error('小说未找到');

    // 非流式查询时尝试从缓存获取
    if (!onStream) {
      try {
        const cacheKey = this.getCacheKey(novelId, question);
        const redis = getRedis();
        const cached = await redis.get(cacheKey);
        if (cached) {
          logger.info({ novelId, question: question.substring(0, 30) }, 'GraphRAG 查询命中缓存');
          return JSON.parse(cached) as GraphRAGResult;
        }
      } catch (err) {
        logger.warn({ err }, 'GraphRAG 缓存读取失败（非致命）');
      }
    }

    const sources: GraphRAGResult['sources'] = [];

    // === 第一路：向量语义搜索相关角色 ===
    const vectorCharacterResults = await vectorSearchService.semanticSearch(novelId, question, 10);

    // === 第二路：关键词搜索相关角色 ===
    const keywordCharacterResults = await this.keywordSearchCharacters(novelId, question);

    // === 合并两路角色结果，去重 ===
    const characterMap = new Map<string, { id: string; name: string; score: number }>();
    for (const cr of vectorCharacterResults) {
      characterMap.set(cr.id, { id: cr.id, name: cr.name, score: cr.score });
    }
    for (const cr of keywordCharacterResults) {
      if (!characterMap.has(cr.id)) {
        characterMap.set(cr.id, { id: cr.id, name: cr.name, score: cr.score * 0.8 }); // 关键词匹配给稍低权重
      } else {
        // 同时被两路召回的角色提升分数
        const existing = characterMap.get(cr.id)!;
        existing.score = Math.max(existing.score, cr.score) * 1.2;
      }
    }

    const mergedCharacterResults = Array.from(characterMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    for (const cr of mergedCharacterResults) {
      sources.push({ type: 'character', id: cr.id, name: cr.name, score: cr.score });
    }

    const characterIds = mergedCharacterResults.map(c => c.id);

    // === 第三路：图谱关系遍历 — 从召回的角色出发，扩展其直接关联角色 ===
    const expandedIds = new Set(characterIds);
    const graphExpandedChars: Array<{ id: string; name: string; score: number }> = [];
    for (const charId of characterIds.slice(0, 8)) { // 只对 top8 角色做图谱扩展
      const relations = await relationRepo.findByCharacter(charId);
      for (const r of relations) {
        const otherId = r.sourceId === charId ? r.targetId : r.sourceId;
        const otherName = r.sourceId === charId ? r.targetName : r.sourceName;
        if (!expandedIds.has(otherId) && otherName) {
          expandedIds.add(otherId);
          graphExpandedChars.push({ id: otherId, name: otherName, score: 0.5 }); // 图谱扩展给较低分数
        }
        sources.push({ type: 'relation', id: r.id });
      }
    }

    // 合并图谱扩展角色
    for (const gc of graphExpandedChars.slice(0, 5)) {
      mergedCharacterResults.push(gc);
      sources.push({ type: 'character', id: gc.id, name: gc.name, score: gc.score });
    }

    // === 查询角色详细信息（批量查询优化，替代 N+1） ===
    const allCharIds = mergedCharacterResults.map(c => c.id);
    const charMap = new Map<string, any>();
    const relationMap = await relationRepo.findByCharacterIds(allCharIds);

    // 批量获取角色信息
    const charDocs = await characterRepo.findByIds(allCharIds);
    for (const char of charDocs) {
      charMap.set(char.id, char);
    }

    const characterDetails: Array<{ name: string; identity?: string; faction?: string; profile?: string; keyTraits?: string[]; relations: string[] }> = [];
    for (const charResult of mergedCharacterResults) {
      const char = charMap.get(charResult.id);
      if (!char) continue;

      const relations = relationMap.get(charResult.id) || [];
      const relationDescs = relations
        .sort((a, b) => (b.importance || 5) - (a.importance || 5)) // 按重要性排序
        .slice(0, 8) // 最多展示8条关系
        .map(r => {
          const otherName = r.sourceId === charResult.id ? r.targetName : r.sourceName;
          const conf = r.confidence != null ? `（置信度:${(r.confidence * 100).toFixed(0)}%）` : '';
          return `与${otherName || '未知'}是${r.relationType}关系${conf}（${r.description}）`;
        });

      characterDetails.push({
        name: char.name,
        identity: char.identity,
        faction: char.faction,
        profile: (char as any).profile,
        keyTraits: (char as any).keyTraits,
        relations: relationDescs,
      });
    }

    // === 向量搜索相关原文段落 ===
    const textChunks = await vectorSearchService.searchTextChunks(novelId, question, 8);

    // === Reranker 精排：对原文段落重排序 ===
    let rankedTextChunks = textChunks;
    if (textChunks.length > 3 && await rerankerService.isConfigured()) {
      try {
        const documents = textChunks.map(tc =>
          `[${tc.chapterRange}] ${tc.text.substring(0, 300)}`
        );
        const rerankResults = await rerankerService.rerank(question, documents, 5);
        rankedTextChunks = rerankResults.map(r => ({
          ...textChunks[r.index],
          score: r.relevanceScore,
        }));
      } catch (err) {
        logger.warn({ err }, 'GraphRAG Reranker 精排原文段落失败，使用原始排序');
      }
    }

    for (const tc of rankedTextChunks) {
      sources.push({ type: 'text_chunk', id: tc.id, stepNumber: tc.stepNumber, chapterRange: tc.chapterRange, score: tc.score });
    }

    // === 组装上下文 ===
    const characterSection = characterDetails.length > 0
      ? '## 相关角色\n' + characterDetails.map(cd => {
          const info = [cd.name];
          if (cd.identity) info.push(cd.identity);
          if (cd.faction) info.push(`阵营:${cd.faction}`);
          if (cd.keyTraits && cd.keyTraits.length > 0) info.push(`性格:${cd.keyTraits.join('、')}`);
          const prefix = info.join('、');
          const parts: string[] = [];
          if (cd.profile) parts.push(`档案:${cd.profile}`);
          if (cd.relations.length > 0) parts.push(cd.relations.join('；'));
          return parts.length > 0 ? `- ${prefix}: ${parts.join('。')}` : `- ${prefix}`;
        }).join('\n')
      : '## 相关角色\n未找到相关角色';

    const textChunkSection = rankedTextChunks.length > 0
      ? '## 相关原文\n' + rankedTextChunks.map(tc =>
          `[${tc.chapterRange}]\n${tc.text.length > 2000 ? tc.text.substring(0, 2000) + '...' : tc.text}`
        ).join('\n\n')
      : '## 相关原文\n未找到相关原文段落';

    const context = `${characterSection}\n\n${textChunkSection}\n\n## 问题\n${question}`;

    // === 调用 AI 生成回答 ===
    const systemPrompt = `你是一个专业的小说分析助手。根据提供的角色关系信息和原文段落，回答用户关于小说的问题。
请基于提供的信息进行回答，如果信息不足，请如实说明。
回答时请引用相关的原文段落或角色信息作为依据。`;

    const answer = await callAIStream(
      context,
      systemPrompt,
      { onStream, phase: 'graphrag_query' },
    );

    const result = { answer, sources };

    // 非流式查询时写入缓存
    if (!onStream) {
      try {
        const cacheKey = this.getCacheKey(novelId, question);
        const redis = getRedis();
        await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result));
      } catch (err) {
        logger.warn({ err }, 'GraphRAG 缓存写入失败（非致命）');
      }
    }

    return result;
  }

  /**
   * 关键词搜索角色（第二路召回）
   * 从问题中提取人名关键词，在 Neo4j 中做名称/别名匹配
   */
  private async keywordSearchCharacters(novelId: string, question: string): Promise<Array<{ id: string; name: string; score: number }>> {
    const results: Array<{ id: string; name: string; score: number }> = [];

    try {
      // 从问题中提取可能的中文人名（2-4字的连续中文字符）
      const namePatterns = question.match(/[\u4e00-\u9fff]{2,4}/g) || [];

      for (const pattern of namePatterns) {
        const chars = await characterRepo.findByNameOrAlias(novelId, pattern);
        for (const char of chars) {
          if (!results.some(r => r.id === char.id)) {
            // 精确匹配给高分，别名匹配给较低分
            const isExactName = char.name === pattern;
            const isAlias = char.aliases?.some((a: string) => a === pattern);
            const score = isExactName ? 0.95 : isAlias ? 0.85 : 0.7;
            results.push({ id: char.id, name: char.name, score });
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, '关键词搜索角色失败（非致命）');
    }

    return results;
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

    // 非流式查询时尝试从缓存获取
    if (!onStream) {
      try {
        const cacheKey = this.getCacheKey('global', question);
        const redis = getRedis();
        const cached = await redis.get(cacheKey);
        if (cached) {
          logger.info({ question: question.substring(0, 30) }, 'GraphRAG 全局查询命中缓存');
          return JSON.parse(cached) as GraphRAGResult;
        }
      } catch (err) {
        logger.warn({ err }, 'GraphRAG 全局缓存读取失败（非致命）');
      }
    }

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

    // 2. 查询相关角色的详细信息（批量查询优化，替代 N+1）
    const topCharIds = topCharacterResults.map(cr => cr.id);
    const charMap = new Map<string, any>();
    const charDocs = await characterRepo.findByIds(topCharIds);
    for (const char of charDocs) {
      charMap.set(char.id, char);
    }
    const relationMap = await relationRepo.findByCharacterIds(topCharIds);

    const characterDetails: Array<{ name: string; novelName: string; identity?: string; faction?: string; relations: string[] }> = [];
    for (const cr of topCharacterResults) {
      const char = charMap.get(cr.id);
      if (!char) continue;

      const relations = relationMap.get(cr.id) || [];
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

    const result = { answer, sources };

    // 非流式查询时写入缓存
    if (!onStream) {
      try {
        const cacheKey = this.getCacheKey('global', question);
        const redis = getRedis();
        await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result));
      } catch (err) {
        logger.warn({ err }, 'GraphRAG 全局缓存写入失败（非致命）');
      }
    }

    return result;
  }

  /**
   * 生成缓存 key（基于 novelId + question 的 SHA256 哈希）
   */
  private getCacheKey(novelId: string, question: string): string {
    const hash = crypto.createHash('sha256').update(`${novelId}:${question}`).digest('hex').substring(0, 16);
    return `${CACHE_PREFIX}${hash}`;
  }
}

export const graphragService = new GraphRAGService();
