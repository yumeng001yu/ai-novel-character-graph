import { Snapshot, SnapshotNode, SnapshotEdge, Character, Relation, Event } from '../types';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { relationRepo } from '../repositories/neo4j/relation.repo';
import { eventRepo } from '../repositories/neo4j/event.repo';
import { snapshotCacheRepo } from '../repositories/redis/snapshot-cache.repo';
import { chapterRepo } from '../repositories/neo4j/chapter.repo';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config';
import { getLogger } from '../utils/logger';

const logger = getLogger();

export class SnapshotService {
  async saveSnapshot(novelId: string, stepNumber: number, chaptersCovered: number[]): Promise<Snapshot> {
    const characters = await characterRepo.findByNovelId(novelId);
    const relations = await relationRepo.findByNovelId(novelId);
    const events = await eventRepo.findByNovelId(novelId);

    const nodes: SnapshotNode[] = characters.map(c => ({
      id: c.id,
      name: c.name,
      aliases: c.aliases,
      isProtagonist: c.isProtagonist,
      firstAppearChapter: c.firstAppearChapter,
    }));

    const edges: SnapshotEdge[] = relations.map(r => ({
      source: r.sourceId,
      target: r.targetId,
      relationType: r.relationType,
      sinceChapter: r.sinceChapter,
      untilChapter: r.untilChapter,
      strength: r.strength,
      isInference: r.isInference,
    }));

    // 计算已覆盖的章节字数和 Token 数
    const chapters = await chapterRepo.findByNovelId(novelId);
    const coveredChapters = chapters.filter(c => chaptersCovered.includes(c.index));
    const totalCharsCovered = coveredChapters.reduce((sum, c) => sum + c.charCount, 0);
    const totalTokensCovered = coveredChapters.reduce((sum, c) => sum + (c.tokenCount || 0), 0);

    const snapshot: Snapshot = {
      step: stepNumber,
      chaptersCovered,
      totalCharsCovered,
      totalTokensCovered,
      nodes,
      edges,
      events,
      createdAt: new Date().toISOString(),
    };

    // 保存到文件
    const filePath = this.getSnapshotPath(novelId, stepNumber);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));

    // 缓存元信息到 Redis
    await snapshotCacheRepo.setMeta(novelId, stepNumber, {
      filePath,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      createdAt: snapshot.createdAt,
    });

    logger.info(`快照保存：步骤${stepNumber}，${nodes.length}节点，${edges.length}边`);
    return snapshot;
  }

  async loadSnapshot(novelId: string, stepNumber: number): Promise<Snapshot | null> {
    const filePath = this.getSnapshotPath(novelId, stepNumber);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  async listSnapshots(novelId: string): Promise<Array<{ step: number; nodeCount: number; edgeCount: number; createdAt: string }>> {
    const dir = this.getSnapshotDir(novelId);
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir).filter(f => f.startsWith('snapshot_') && f.endsWith('.json'));
    const snapshots = [];

    for (const file of files) {
      const step = parseInt(file.replace('snapshot_', '').replace('.json', ''));
      const meta = await snapshotCacheRepo.getMeta(novelId, step);
      if (meta) {
        snapshots.push({ step, nodeCount: meta.nodeCount, edgeCount: meta.edgeCount, createdAt: meta.createdAt });
      }
    }

    return snapshots.sort((a, b) => a.step - b.step);
  }

  async getDiff(novelId: string, step: number): Promise<{ addedNodes: string[]; addedEdges: string[]; removedNodes: string[]; removedEdges: string[] } | null> {
    const current = await this.loadSnapshot(novelId, step);
    const previous = step > 1 ? await this.loadSnapshot(novelId, step - 1) : null;

    if (!current) return null;

    const prevNodeIds = new Set((previous?.nodes || []).map(n => n.id));
    const currNodeIds = new Set(current.nodes.map(n => n.id));
    const prevEdgeKeys = new Set((previous?.edges || []).map(e => `${e.source}-${e.target}-${e.relationType}`));
    const currEdgeKeys = new Set(current.edges.map(e => `${e.source}-${e.target}-${e.relationType}`));

    return {
      addedNodes: [...currNodeIds].filter(id => !prevNodeIds.has(id)),
      addedEdges: [...currEdgeKeys].filter(key => !prevEdgeKeys.has(key)),
      removedNodes: [...prevNodeIds].filter(id => !currNodeIds.has(id)),
      removedEdges: [...prevEdgeKeys].filter(key => !currEdgeKeys.has(key)),
    };
  }

  private getSnapshotDir(novelId: string): string {
    const config = getConfig();
    return path.resolve(config.build.snapshot_dir, novelId);
  }

  private getSnapshotPath(novelId: string, step: number): string {
    return path.join(this.getSnapshotDir(novelId), `snapshot_${step}.json`);
  }
}

export const snapshotService = new SnapshotService();
