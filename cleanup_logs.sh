#!/bin/bash
# 清理 /root/ai-novel-character-graph/logs/ 目录下超过 24 小时的日志文件
# 每 3 天执行一次（由 cron 调度）

LOG_DIR="/root/ai-novel-character-graph/logs"
KEEP_HOURS=24

if [ ! -d "$LOG_DIR" ]; then
  echo "[$(date)] Log directory $LOG_DIR does not exist, nothing to clean"
  exit 0
fi

# 删除超过 KEEP_HOURS 的文件
COUNT=$(find "$LOG_DIR" -type f -name "*.log" -mmin +$((KEEP_HOURS * 60)) -delete 2>/dev/null | wc -l)
echo "[$(date)] Cleaned $COUNT log file(s) older than ${KEEP_HOURS}h in $LOG_DIR"