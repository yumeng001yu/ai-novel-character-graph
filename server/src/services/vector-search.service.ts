import axios from 'axios';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { textChunkRepo } from '../repositories/neo4j/text-chunk.repo';
import { embeddingService } from './embedding.service';
import { rerankerService } from './reranker.service';
import { VectorSearchResult } from '../types';
import { getLogger } from '../utils/logger';

const logger = getLogger();

const TURBOVEC_URL = process.env.TURBOVEC_URL || 'http://turbovec:8900';

/**
 * 为角色生成描述文本（用于 embedding）
 */
function buildCharacterText(char: any): string {
  const parts = [char.name];
  if (char.aliases?.length) parts.push(`别名:${char.aliases.join('、')}`);
  if (char.gender) parts.push(`性别:${char.gender}`);
  if (char.faction) parts.push(`阵营:${char.faction}`);
  if (char.identity) parts.push(`身份:${char.identity}`);
  return parts.join(' ');
}

/**
 * 调用 turbovec 微服务
 */
async function turbovecRequest(path: string, body: any): Promise<any> {
  try {
    const res = await axios.post(`${TURBOVEC_URL}${path}`, body, { timeout: 30000 });
    return res.data;
  } catch (err: any) {
    logger.warn({ err, path }, 'turbovec 服务请求失败');
    throw err;
  }
}

export class VectorSearchService {
  private initialized = false;

  /**
   * 初始化 turbovec 索引 + Neo4j Vector Index（回退用）
   */
  async ensureVectorIndex(): Promise<void> {
    if (!(await embeddingService.isConfigured())) return;

    try {
      const config = await embeddingService.getConfig();
      if (!config) return;

      const dim = config.dimensions || 1536;

      // 初始化 turbovec
      await turbovecRequest('/index/init', { index_name: 'character', dimensions: dim });
      await turbovecRequest('/index/init', { index_name: 'text_chunk', dimensions: dim });

      // 尝试加载已有索引
      await turbovecRequest('/index/load', { index_name: 'character' });
      await turbovecRequest('/index/load', { index_name: 'text_chunk' });

      this.initialized = true;
      logger.info({ dimensions: dim }, 'turbovec 索引初始化完成');
    } catch (err) {
      logger.warn(err, 'turbovec 索引初始化失败，将回退到 Neo4j Vector Index');
      this.initialized = false;
    }

    // 同时确保 Neo4j Vector Index 存在（回退用）
    try {
      const config = await embeddingService.getConfig();
      if (config) {
        const dim = config.dimensions || 1536;
        const { characterRepo } = require('../repositories/neo4j/character.repo');
        const { textChunkRepo } = require('../repositories/neo4j/text-chunk.repo');
        await characterRepo.ensureVectorIndex(dim);
        await textChunkRepo.ensureVectorIndex(dim);
      }
    } catch (err) {
      logger.warn(err, 'Neo4j Vector Index 创建失败（非致命，回退搜索不可用）');
    }
  }

  /**
   * 为角色生成并存储 embedding 向量
   */
  async indexCharacter(characterId: string, character: any): Promise<void> {
    if (!(await embeddingService.isConfigured())) return;

    try {
      const text = buildCharacterText(character);
      const embedding = await embeddingService.embed(text);

      // 同时存 Neo4j（备份）和 turbovec
      await characterRepo.setEmbedding(characterId, embedding);

      if (this.initialized) {
        await turbovecRequest('/index/add', {
          index_name: 'character',
          vectors: [embedding],
          entity_ids: [characterId],
          novel_ids: [character.novelId],
          extra_meta: [{ name: character.name }],
        }).catch(err => logger.warn({ err }, 'turbovec 添加角色向量失败（非致命）'));
      }
    } catch (err) {
      logger.warn({ err, characterId }, '角色向量化失败（非致命）');
    }
  }

  /**
   * 批量为角色生成并存储 embedding 向量
   */
  async indexCharacters(characters: any[]): Promise<void> {
    if (!(await embeddingService.isConfigured())) return;
    if (characters.length === 0) return;

    try {
      const texts = characters.map(c => buildCharacterText(c));
      const embeddings = await embeddingService.embedBatch(texts);

      // 存 Neo4j
      for (let i = 0; i < characters.length; i++) {
        await characterRepo.setEmbedding(characters[i].id, embeddings[i]);
      }

      // 存 turbovec
      if (this.initialized) {
        await turbovecRequest('/index/add', {
          index_name: 'character',
          vectors: embeddings,
          entity_ids: characters.map(c => c.id),
          novel_ids: characters.map(c => c.novelId),
          extra_meta: characters.map(c => ({ name: c.name })),
        }).catch(err => logger.warn({ err }, 'turbovec 批量添加角色向量失败（非致命）'));
      }
    } catch (err) {
      logger.warn({ err }, '批量角色向量化失败（非致命）');
    }
  }

  /**
   * 向量相似度搜索（角色消歧增强）
   */
  async findSimilarCharacters(novelId: string, character: any, threshold: number = 0.85): Promise<Array<{ id: string; name: string; score: number }>> {
    if (!(await embeddingService.isConfigured())) return [];

    try {
      const text = buildCharacterText(character);
      const queryEmbedding = await embeddingService.embed(text);
      const results = await this._searchCharacters(novelId, queryEmbedding, 20);
      return results.filter(r => r.id !== character.id && r.score >= threshold);
    } catch (err) {
      logger.warn({ err }, '向量相似度搜索失败（非致命）');
      return [];
    }
  }

  /**
   * 语义搜索角色
   * 支持 turbovec 向量召回 + Reranker 精排
   */
  async semanticSearch(novelId: string, keyword: string, topK: number = 10): Promise<VectorSearchResult[]> {
    if (!(await embeddingService.isConfigured())) return [];

    try {
      const queryEmbedding = await embeddingService.embed(keyword);
      const candidates = await this._searchCharacters(novelId, queryEmbedding, topK * 3);

      if (candidates.length === 0) return [];

      // 如果配置了 Reranker，进行精排
      if (await rerankerService.isConfigured()) {
        try {
          const documents = candidates.map(c => c.name);
          const rerankResults = await rerankerService.rerank(keyword, documents, topK);
          return rerankResults.map(r => ({
            id: candidates[r.index].id,
            name: candidates[r.index].name,
            score: r.relevanceScore,
            type: 'Character' as const,
          }));
        } catch (err) {
          logger.warn({ err }, 'Reranker 精排失败，使用向量召回结果');
        }
      }

      return candidates.slice(0, topK).map(c => ({
        id: c.id,
        name: c.name,
        score: c.score,
        type: 'Character' as const,
      }));
    } catch (err) {
      logger.warn({ err }, '语义搜索失败（非致命）');
      return [];
    }
  }

  /**
   * 发现隐含关系候选
   */
  async discoverImplicitRelations(novelId: string, newCharacterIds: string[], allCharacters: any[]): Promise<Array<{ sourceId: string; targetId: string; score: number }>> {
    if (!(await embeddingService.isConfigured())) return [];
    if (newCharacterIds.length === 0) return [];

    try {
      const results: Array<{ sourceId: string; targetId: string; score: number }> = [];
      const newChars = allCharacters.filter(c => newCharacterIds.includes(c.id));

      for (const char of newChars) {
        const similar = await this.findSimilarCharacters(novelId, char, 0.7);
        for (const s of similar) {
          results.push({ sourceId: char.id, targetId: s.id, score: s.score });
        }
      }

      if (results.length > 0 && await rerankerService.isConfigured()) {
        try {
          const documents = results.map(r => {
            const source = allCharacters.find(c => c.id === r.sourceId);
            const target = allCharacters.find(c => c.id === r.targetId);
            return `${source?.name || ''}（${source?.identity || ''}）与${target?.name || ''}（${target?.identity || ''}）的关系`;
          });
          const reranked = await rerankerService.rerank(
            '小说中人物之间的关系',
            documents,
            Math.min(results.length, 5)
          );
          return reranked
            .filter(r => r.relevanceScore > 0.5)
            .map(r => results[r.index]);
        } catch (err) {
          logger.warn({ err }, 'Reranker 隐含关系精排失败');
        }
      }

      return results.filter(r => r.score > 0.75);
    } catch (err) {
      logger.warn({ err }, '隐含关系发现失败（非致命）');
      return [];
    }
  }

  /**
   * 为文本块生成 embedding 并存储
   */
  async indexTextChunk(chunkId: string, text: string, novelId?: string, stepNumber?: number, chapterRange?: string): Promise<void> {
    if (!(await embeddingService.isConfigured())) return;

    try {
      const embedding = await embeddingService.embed(text);
      await textChunkRepo.setEmbedding(chunkId, embedding);

      if (this.initialized && novelId) {
        await turbovecRequest('/index/add', {
          index_name: 'text_chunk',
          vectors: [embedding],
          entity_ids: [chunkId],
          novel_ids: [novelId],
          extra_meta: [{ stepNumber: stepNumber || 0, chapterRange: chapterRange || '' }],
        }).catch(err => logger.warn({ err }, 'turbovec 添加文本块向量失败（非致命）'));
      }
    } catch (err) {
      logger.warn({ err, chunkId }, '文本块向量化失败（非致命）');
    }
  }

  /**
   * 批量为文本块生成 embedding 并存储
   */
  async indexTextChunks(chunks: Array<{ id: string; text: string; novelId?: string; stepNumber?: number; chapterRange?: string }>): Promise<void> {
    if (!(await embeddingService.isConfigured())) return;
    if (chunks.length === 0) return;

    try {
      const texts = chunks.map(c => c.text);
      const embeddings = await embeddingService.embedBatch(texts);

      // 存 Neo4j
      for (let i = 0; i < chunks.length; i++) {
        await textChunkRepo.setEmbedding(chunks[i].id, embeddings[i]);
      }

      // 存 turbovec
      if (this.initialized) {
        const validChunks = chunks.filter(c => c.novelId);
        if (validChunks.length > 0) {
          const validIndices = validChunks.map(c => chunks.indexOf(c));
          await turbovecRequest('/index/add', {
            index_name: 'text_chunk',
            vectors: validIndices.map(i => embeddings[i]),
            entity_ids: validChunks.map(c => c.id),
            novel_ids: validChunks.map(c => c.novelId!),
            extra_meta: validChunks.map(c => ({
              stepNumber: c.stepNumber || 0,
              chapterRange: c.chapterRange || '',
            })),
          }).catch(err => logger.warn({ err }, 'turbovec 批量添加文本块向量失败（非致命）'));
        }
      }
    } catch (err) {
      logger.warn({ err }, '批量文本块向量化失败（非致命）');
    }
  }

  /**
   * 搜索相关原文段落
   */
  async searchTextChunks(novelId: string, query: string, topK: number = 5): Promise<Array<{ id: string; stepNumber: number; chapterRange: string; text: string; score: number }>> {
    if (!(await embeddingService.isConfigured())) return [];

    try {
      const queryEmbedding = await embeddingService.embed(query);

      // 优先使用 turbovec
      if (this.initialized) {
        try {
          const res = await turbovecRequest('/index/search', {
            index_name: 'text_chunk',
            query_vector: queryEmbedding,
            top_k: topK,
            novel_id: novelId,
          });

          if (res.results && res.results.length > 0) {
            // 从 Neo4j 获取完整文本
            const chunkIds = res.results.map((r: any) => r.entityId);
            const chunks = await textChunkRepo.findByIds(chunkIds);
            const chunkMap = new Map(chunks.map(c => [c.id, c]));

            return res.results.map((r: any) => {
              const chunk = chunkMap.get(r.entityId);
              return {
                id: r.entityId,
                stepNumber: chunk?.stepNumber || r.meta?.stepNumber || 0,
                chapterRange: chunk?.chapterRange || r.meta?.chapterRange || '',
                text: chunk?.text || '',
                score: r.score,
              };
            }).filter((r: any) => r.text);
          }
        } catch (err) {
          logger.warn({ err }, 'turbovec 文本块搜索失败，回退到 Neo4j');
        }
      }

      // 回退到 Neo4j Vector Index
      return await textChunkRepo.vectorSearch(novelId, queryEmbedding, topK);
    } catch (err) {
      logger.warn({ err }, '原文段落搜索失败（非致命）');
      return [];
    }
  }

  /**
   * 删除指定小说的所有向量
   */
  async deleteByNovel(novelId: string): Promise<void> {
    if (!this.initialized) return;

    try {
      await turbovecRequest('/index/delete-by-novel', { index_name: 'character', novel_id: novelId });
      await turbovecRequest('/index/delete-by-novel', { index_name: 'text_chunk', novel_id: novelId });
    } catch (err) {
      logger.warn({ err }, 'turbovec 删除小说向量失败（非致命）');
    }
  }

  /**
   * 保存索引到磁盘
   */
  async saveIndex(): Promise<void> {
    if (!this.initialized) return;

    try {
      await turbovecRequest('/index/save', {});
    } catch (err) {
      logger.warn({ err }, 'turbovec 保存索引失败（非致命）');
    }
  }

  /**
   * 内部方法：搜索角色（优先 turbovec，回退 Neo4j）
   */
  private async _searchCharacters(novelId: string, queryEmbedding: number[], topK: number): Promise<Array<{ id: string; name: string; score: number }>> {
    // 优先使用 turbovec
    if (this.initialized) {
      try {
        const res = await turbovecRequest('/index/search', {
          index_name: 'character',
          query_vector: queryEmbedding,
          top_k: topK,
          novel_id: novelId,
        });

        if (res.results && res.results.length > 0) {
          return res.results.map((r: any) => ({
            id: r.entityId,
            name: r.meta?.name || '',
            score: r.score,
          }));
        }
      } catch (err) {
        logger.warn({ err }, 'turbovec 角色搜索失败，回退到 Neo4j');
      }
    }

    // 回退到 Neo4j Vector Index
    return await characterRepo.vectorSearch(novelId, queryEmbedding, topK);
  }
}

export const vectorSearchService = new VectorSearchService();
