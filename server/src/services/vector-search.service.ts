import { characterRepo } from '../repositories/neo4j/character.repo';
import { embeddingService } from './embedding.service';
import { rerankerService } from './reranker.service';
import { VectorSearchResult } from '../types';
import { getLogger } from '../utils/logger';

const logger = getLogger();

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

export class VectorSearchService {
  /**
   * 为角色生成并存储 embedding 向量
   */
  async indexCharacter(characterId: string, character: any): Promise<void> {
    if (!(await embeddingService.isConfigured())) return;

    try {
      const text = buildCharacterText(character);
      const embedding = await embeddingService.embed(text);
      await characterRepo.setEmbedding(characterId, embedding);
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
      for (let i = 0; i < characters.length; i++) {
        await characterRepo.setEmbedding(characters[i].id, embeddings[i]);
      }
    } catch (err) {
      logger.warn({ err }, '批量角色向量化失败（非致命）');
    }
  }

  /**
   * 确保向量索引存在
   */
  async ensureVectorIndex(): Promise<void> {
    if (!(await embeddingService.isConfigured())) return;

    try {
      const config = await embeddingService.getConfig();
      if (config) {
        await characterRepo.ensureVectorIndex(config.dimensions);
      }
    } catch (err) {
      logger.warn(err, '创建向量索引失败（非致命）');
    }
  }

  /**
   * 向量相似度搜索（角色消歧增强）
   * 返回与目标角色描述相似的其他角色
   */
  async findSimilarCharacters(novelId: string, character: any, threshold: number = 0.85): Promise<Array<{ id: string; name: string; score: number }>> {
    if (!(await embeddingService.isConfigured())) return [];

    try {
      const text = buildCharacterText(character);
      const queryEmbedding = await embeddingService.embed(text);
      const results = await characterRepo.vectorSearch(novelId, queryEmbedding, 20);

      // 过滤掉自身和低于阈值的
      return results.filter(r => r.id !== character.id && r.score >= threshold);
    } catch (err) {
      logger.warn({ err }, '向量相似度搜索失败（非致命）');
      return [];
    }
  }

  /**
   * 语义搜索角色
   * 支持向量召回 + Reranker 精排
   */
  async semanticSearch(novelId: string, keyword: string, topK: number = 10): Promise<VectorSearchResult[]> {
    if (!(await embeddingService.isConfigured())) return [];

    try {
      // 1. 向量召回
      const queryEmbedding = await embeddingService.embed(keyword);
      const candidates = await characterRepo.vectorSearch(novelId, queryEmbedding, topK * 3);

      if (candidates.length === 0) return [];

      // 2. 如果配置了 Reranker，进行精排
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

      // 3. 无 Reranker 或精排失败，直接返回向量召回结果
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
   * 通过向量近邻查找可能存在但未被 AI 提取的关系
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

      // 如果配置了 Reranker，对候选关系进行精排
      if (results.length > 0 && await rerankerService.isConfigured()) {
        try {
          const queries = results.map(r => {
            const source = allCharacters.find(c => c.id === r.sourceId);
            const target = allCharacters.find(c => c.id === r.targetId);
            return `${source?.name || ''}与${target?.name || ''}的关系`;
          });
          const documents = results.map(r => {
            const source = allCharacters.find(c => c.id === r.sourceId);
            const target = allCharacters.find(c => c.id === r.targetId);
            return `${source?.identity || ''} ${target?.identity || ''}`;
          });
          const reranked = await rerankerService.rerank(
            '小说中人物之间的关系',
            documents,
            Math.min(results.length, 5)
          );
          // 只保留高分的
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
}

export const vectorSearchService = new VectorSearchService();
