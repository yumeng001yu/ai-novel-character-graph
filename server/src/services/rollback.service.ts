import { writeLogRepo } from '../repositories/redis/write-log.repo';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { relationRepo } from '../repositories/neo4j/relation.repo';
import { snapshotService } from './snapshot.service';
import { getSession } from '../repositories/neo4j/connection';
import { getLogger } from '../utils/logger';

const logger = getLogger();

export class RollbackService {
  /**
   * 回退到指定步
   */
  async rollback(novelId: string, targetStep: number, currentStep: number): Promise<void> {
    logger.info(`开始回退：${currentStep} → ${targetStep}`);

    // 从当前步逆序回退到目标步
    for (let step = currentStep; step > targetStep; step--) {
      await this.rollbackStep(novelId, step);
    }

    // 验证目标步快照
    const snapshot = await snapshotService.loadSnapshot(novelId, targetStep);
    if (!snapshot) {
      logger.warn(`目标步 ${targetStep} 的快照不存在`);
    }

    logger.info(`回退完成：已回退到第 ${targetStep} 步`);
  }

  private async rollbackStep(novelId: string, step: number): Promise<void> {
    const log = await writeLogRepo.getLog(novelId, step);
    if (log.length === 0) {
      logger.warn(`步骤 ${step} 无写操作日志`);
      return;
    }

    const session = getSession();
    try {
      const tx = session.beginTransaction();

      // 逆序执行写操作日志
      for (let i = log.length - 1; i >= 0; i--) {
        const entry = log[i];
        switch (entry.action) {
          case 'create_node':
            await tx.run(
              `MATCH (n:${entry.label} {id: $id}) DETACH DELETE n`,
              { id: entry.id }
            );
            break;
          case 'create_edge':
            // RELATES_TO 边通过关系属性删除
            await tx.run(
              `MATCH ()-[r:RELATES_TO {id: $id}]->() DELETE r`,
              { id: entry.id }
            );
            break;
          case 'update_node':
            // 更新操作较难回退，简化处理
            break;
        }
      }

      await tx.commit();
    } finally {
      await session.close();
    }

    // 清理写操作日志
    await writeLogRepo.deleteLog(novelId, step);
  }
}

export const rollbackService = new RollbackService();
