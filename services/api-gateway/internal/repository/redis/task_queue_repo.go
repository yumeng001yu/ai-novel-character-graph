package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// TaskStatus 任务状态类型
type TaskStatus string

const (
	TaskStatusPending     TaskStatus = "pending"
	TaskStatusRunning     TaskStatus = "running"
	TaskStatusCompleted   TaskStatus = "completed"
	TaskStatusFailed      TaskStatus = "failed"
	TaskStatusInterrupted TaskStatus = "interrupted"
)

// TaskInfo 任务信息
type TaskInfo struct {
	ID        string     `json:"id"`
	NovelID   string     `json:"novelId"`
	Type      string     `json:"type"`
	Status    TaskStatus `json:"status"`
	Progress  int        `json:"progress"`
	Message   string     `json:"message"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
}

// TaskQueueRepo 任务队列仓库
type TaskQueueRepo struct{}

// NewTaskQueueRepo 创建任务队列仓库实例
func NewTaskQueueRepo() *TaskQueueRepo {
	return &TaskQueueRepo{}
}

// Enqueue 将任务加入队列
func (r *TaskQueueRepo) Enqueue(ctx context.Context, novelID, taskType string) (*TaskInfo, error) {
	now := time.Now()
	task := &TaskInfo{
		ID:        uuid.New().String(),
		NovelID:   novelID,
		Type:      taskType,
		Status:    TaskStatusPending,
		Progress:  0,
		Message:   "任务已创建，等待处理",
		CreatedAt: now,
		UpdatedAt: now,
	}

	data, err := json.Marshal(task)
	if err != nil {
		return nil, fmt.Errorf("序列化任务失败: %w", err)
	}

	pipe := GetClient().Pipeline()
	// 存储任务详情
	pipe.Set(ctx, taskKey(task.ID), data, 24*time.Hour)
	// 加入待处理队列
	pipe.LPush(ctx, queueKey(), task.ID)
	// 建立小说到任务的映射
	pipe.Set(ctx, novelTaskKey(novelID), task.ID, 24*time.Hour)

	if _, err := pipe.Exec(ctx); err != nil {
		return nil, fmt.Errorf("入队操作失败: %w", err)
	}

	slog.Info("任务已入队", "taskId", task.ID, "novelId", novelID, "type", taskType)
	return task, nil
}

// Dequeue 从队列中取出一个待处理任务
func (r *TaskQueueRepo) Dequeue(ctx context.Context) (*TaskInfo, error) {
	// 阻塞式从队列右侧弹出
	result, err := GetClient().BRPop(ctx, 5*time.Second, queueKey()).Result()
	if err != nil {
		if err.Error() == "redis: nil" {
			return nil, nil
		}
		return nil, fmt.Errorf("出队操作失败: %w", err)
	}

	taskID := result[1]
	return r.GetTask(ctx, taskID)
}

// MarkRunning 将任务标记为运行中
func (r *TaskQueueRepo) MarkRunning(ctx context.Context, taskID string) error {
	return r.updateStatus(ctx, taskID, TaskStatusRunning, 0, "任务正在处理")
}

// MarkCompleted 将任务标记为已完成
func (r *TaskQueueRepo) MarkCompleted(ctx context.Context, taskID string) error {
	return r.updateStatus(ctx, taskID, TaskStatusCompleted, 100, "任务已完成")
}

// MarkFailed 将任务标记为失败
func (r *TaskQueueRepo) MarkFailed(ctx context.Context, taskID string, errMsg string) error {
	return r.updateStatus(ctx, taskID, TaskStatusFailed, 0, errMsg)
}

// MarkRunningAsInterrupted 将运行中的任务标记为中断
func (r *TaskQueueRepo) MarkRunningAsInterrupted(ctx context.Context, taskID string) error {
	return r.updateStatus(ctx, taskID, TaskStatusInterrupted, 0, "任务已被中断")
}

// GetTask 获取任务信息
func (r *TaskQueueRepo) GetTask(ctx context.Context, taskID string) (*TaskInfo, error) {
	data, err := GetClient().Get(ctx, taskKey(taskID)).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, nil
		}
		return nil, fmt.Errorf("获取任务失败: %w", err)
	}

	var task TaskInfo
	if err := json.Unmarshal(data, &task); err != nil {
		return nil, fmt.Errorf("反序列化任务失败: %w", err)
	}
	return &task, nil
}

// GetTaskByNovelID 根据小说 ID 获取任务信息
func (r *TaskQueueRepo) GetTaskByNovelID(ctx context.Context, novelID string) (*TaskInfo, error) {
	taskID, err := GetClient().Get(ctx, novelTaskKey(novelID)).Result()
	if err != nil {
		if err == redis.Nil {
			return nil, nil
		}
		return nil, fmt.Errorf("获取小说任务映射失败: %w", err)
	}
	return r.GetTask(ctx, taskID)
}

// UpdateProgress 更新任务进度
func (r *TaskQueueRepo) UpdateProgress(ctx context.Context, taskID string, progress int, message string) error {
	return r.updateStatus(ctx, taskID, TaskStatusRunning, progress, message)
}

// updateStatus 更新任务状态
func (r *TaskQueueRepo) updateStatus(ctx context.Context, taskID string, status TaskStatus, progress int, message string) error {
	task, err := r.GetTask(ctx, taskID)
	if err != nil {
		return err
	}
	if task == nil {
		return fmt.Errorf("任务不存在: %s", taskID)
	}

	task.Status = status
	task.Progress = progress
	task.Message = message
	task.UpdatedAt = time.Now()

	data, err := json.Marshal(task)
	if err != nil {
		return fmt.Errorf("序列化任务失败: %w", err)
	}

	if err := GetClient().Set(ctx, taskKey(taskID), data, 24*time.Hour).Err(); err != nil {
		return fmt.Errorf("更新任务状态失败: %w", err)
	}

	slog.Info("任务状态已更新", "taskId", taskID, "status", string(status), "progress", progress)
	return nil
}

// redis Nil 错误判断辅助
func isRedisNil(err error) bool {
	return err != nil && err.Error() == "redis: nil"
}

// Redis key 生成函数
func taskKey(taskID string) string {
	return fmt.Sprintf("task:%s", taskID)
}

func queueKey() string {
	return "task:queue"
}

func novelTaskKey(novelID string) string {
	return fmt.Sprintf("novel:task:%s", novelID)
}
