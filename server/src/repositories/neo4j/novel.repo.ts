import { Session } from 'neo4j-driver';
import { getSession } from './connection';
import { Novel, InputMode } from '../../types';
import { v4 as uuid } from 'uuid';

export class NovelRepo {
  async create(data: { name: string; totalChars: number; totalTokens: number; inputMode: InputMode; contextSize: number }): Promise<Novel> {
    const session = getSession();
    try {
      const novel: Novel = {
        id: uuid(),
        name: data.name,
        totalChars: data.totalChars,
        totalTokens: data.totalTokens,
        inputMode: data.inputMode,
        currentStep: 0,
        totalSteps: 0,
        contextSize: data.contextSize,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await session.run(
        `CREATE (n:Novel $props)`,
        { props: novel }
      );
      return novel;
    } finally {
      await session.close();
    }
  }

  async findById(id: string): Promise<Novel | null> {
    const session = getSession();
    try {
      const result = await session.run(`MATCH (n:Novel {id: $id}) RETURN n`, { id });
      if (result.records.length === 0) return null;
      return result.records[0].get('n').properties as Novel;
    } finally {
      await session.close();
    }
  }

  async findAll(): Promise<Novel[]> {
    const session = getSession();
    try {
      const result = await session.run(`MATCH (n:Novel) RETURN n ORDER BY n.createdAt DESC`);
      return result.records.map(r => r.get('n').properties as Novel);
    } finally {
      await session.close();
    }
  }

  async updateStep(id: string, currentStep: number, totalSteps: number): Promise<void> {
    const session = getSession();
    try {
      await session.run(
        `MATCH (n:Novel {id: $id}) SET n.currentStep = $currentStep, n.totalSteps = $totalSteps, n.updatedAt = $updatedAt`,
        { id, currentStep, totalSteps, updatedAt: new Date().toISOString() }
      );
    } finally {
      await session.close();
    }
  }

  async deleteById(id: string): Promise<void> {
    const session = getSession();
    try {
      await session.run(`MATCH (n:Novel {id: $id}) DETACH DELETE n`, { id });
    } finally {
      await session.close();
    }
  }
}

export const novelRepo = new NovelRepo();
