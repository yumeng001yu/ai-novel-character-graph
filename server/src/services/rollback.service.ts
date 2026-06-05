import { writeLogRepo } from '../repositories/redis/write-log.repo';
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

    // 分类收集需要删除的 ID
    const nodeIdsToDelete: { label: string; id: string }[] = [];
    const relationIdsToDelete: string[] = [];

    for (const entry of log) {
      switch (entry.action) {
        case 'create_node':
          nodeIdsToDelete.push({ label: entry.label, id: entry.id });
          break;
        case 'create_edge':
          relationIdsToDelete.push(entry.id);
          break;
        // update_node/update_edge 不需要删除，但需要回退
        // 简化处理：update 操作暂不回退（后续可增强）
      }
    }

    // 删除关系（先删关系再删节点，避免约束冲突）
    if (relationIdsToDelete.length > 0) {
      await relationRepo.deleteByRelationIds(relationIdsToDelete);
      logger.info(`步骤 ${step}：删除 ${relationIdsToDelete.length} 条关系`);
    }

    // 删除节点
    if (nodeIdsToDelete.length > 0) {
      const session = getSession();
      try {
        const tx = session.beginTransaction();
        for (const node of nodeIdsToDelete) {
          await tx.run(
            `MATCH (n {id: $id}) DETACH DELETE n`,
            { id: node.id }
          );
        }
        await tx.commit();
      } finally {
        await session.close();
      }
      logger.info(`步骤 ${step}：删除 ${nodeIdsToDelete.length} 个节点`);
    }

    // 清理写操作日志
    await writeLogRepo.deleteLog(novelId, step);
    logger.info(`步骤 ${step} 回退完成`);
  }
}

export const rollbackService = new RollbackService();
