import { getSession } from './connection';
import { v4 as uuid } from 'uuid';
import { getLogger } from '../../utils/logger';

const logger = getLogger();

export interface TextChunk {
  id: string;
  novelId: string;
  stepNumber: number;
  chapterRange: string;
  text: string;
  embedding?: number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class TextChunkRepo {
  async create(novelId: string, stepNumber: number, chapterRange: string, text: string): Promise<TextChunk> {
    const session = getSession();
    try {
      const chunk: TextChunk = {
        id: uuid(),
        novelId,
        stepNumber,
        chapterRange,
        text,
      };
      await session.run(`CREATE (t:TextChunk $props)`, { props: chunk });
      await session.run(
        `MATCH (n:Novel {id: $novelId}), (t:TextChunk {id: $chunkId})
         CREATE (n)-[:HAS_CHUNK]->(t)`,
        { novelId, chunkId: chunk.id }
      );
      return chunk;
    } finally {
      await session.close();
    }
  }

  async setEmbedding(id: string, embedding: number[]): Promise<void> {
    const session = getSession();
    try {
      await session.run(
        `MATCH (t:TextChunk {id: $id}) SET t.embedding = $embedding`,
        { id, embedding }
      );
    } finally {
      await session.close();
    }
  }

  async vectorSearch(novelId: string, queryEmbedding: number[], topK: number = 10): Promise<Array<{ id: string; stepNumber: number; chapterRange: string; text: string; score: number }>> {
    const session = getSession();
    try {
      const recallK = topK * 5;
      const result = await session.run(
        `CALL db.index.vector.queryNodes('text_chunk_embedding', $recallK, $queryEmbedding)
         YIELD node, score
         MATCH (n:Novel {id: $novelId})-[:HAS_CHUNK]->(t:TextChunk)
         WHERE t.id = node.id
         RETURN t.id AS id, t.stepNumber AS stepNumber, t.chapterRange AS chapterRange, t.text AS text, score
         LIMIT $topK`,
        { novelId, recallK, topK, queryEmbedding }
      );
      return result.records.map(r => ({
        id: r.get('id'),
        stepNumber: r.get('stepNumber'),
        chapterRange: r.get('chapterRange'),
        text: r.get('text'),
        score: r.get('score'),
      }));
    } catch (err) {
      logger.warn(err, 'TextChunk 向量索引查询失败，回退到手动计算');
      return this.fallbackVectorSearch(novelId, queryEmbedding, topK);
    } finally {
      await session.close();
    }
  }

  async fallbackVectorSearch(novelId: string, queryEmbedding: number[], topK: number): Promise<Array<{ id: string; stepNumber: number; chapterRange: string; text: string; score: number }>> {
    const chunks = await this.findByNovelId(novelId);
    const results: Array<{ id: string; stepNumber: number; chapterRange: string; text: string; score: number }> = [];

    for (const chunk of chunks as any[]) {
      if (!chunk.embedding || !Array.isArray(chunk.embedding)) continue;
      const score = cosineSimilarity(queryEmbedding, chunk.embedding);
      results.push({
        id: chunk.id,
        stepNumber: chunk.stepNumber,
        chapterRange: chunk.chapterRange,
        text: chunk.text,
        score,
      });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  async ensureVectorIndex(dimensions: number): Promise<void> {
    const session = getSession();
    try {
      await session.run(
        `CREATE VECTOR INDEX text_chunk_embedding IF NOT EXISTS
         FOR (t:TextChunk) ON (t.embedding)
         OPTIONS {indexConfig: {
           \`vector.dimensions\`: $dimensions,
           \`vector.similarity_function\`: 'cosine'
         }}`,
        { dimensions }
      );
    } catch (err) {
      logger.warn(err, '创建 TextChunk 向量索引失败（可能 Neo4j 版本不支持或索引已存在）');
    } finally {
      await session.close();
    }
  }

  async findByNovelId(novelId: string): Promise<TextChunk[]> {
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (n:Novel {id: $novelId})-[:HAS_CHUNK]->(t:TextChunk) RETURN t ORDER BY t.stepNumber`,
        { novelId }
      );
      return result.records.map(r => r.get('t').properties as TextChunk);
    } finally {
      await session.close();
    }
  }

  async findByIds(ids: string[]): Promise<TextChunk[]> {
    if (ids.length === 0) return [];
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (t:TextChunk) WHERE t.id IN $ids RETURN t`,
        { ids }
      );
      return result.records.map(r => r.get('t').properties as TextChunk);
    } finally {
      await session.close();
    }
  }

  async deleteByNovelId(novelId: string): Promise<void> {
    const session = getSession();
    try {
      await session.run(
        `MATCH (n:Novel {id: $novelId})-[:HAS_CHUNK]->(t:TextChunk) DETACH DELETE t`,
        { novelId }
      );
    } finally {
      await session.close();
    }
  }
}

export const textChunkRepo = new TextChunkRepo();
