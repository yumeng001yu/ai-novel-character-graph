import React, { useState, useEffect } from 'react';
import { Card, Button, Progress, Select, Steps, message, Descriptions, Alert, Space, Tooltip } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { startBuild, cancelBuild, getCostEstimate, getNovels, getTaskStatus } from '../../services/api';

const Task: React.FC = () => {
  const [novels, setNovels] = useState<any[]>([]);
  const [novelId, setNovelId] = useState<string>('');
  const [progress, setProgress] = useState<any>(null);
  const [taskStatus, setTaskStatus] = useState<any>(null);
  const [costEstimate, setCostEstimate] = useState<any>(null);
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    loadNovels();
  }, []);

  const loadNovels = async () => {
    try {
      const res = await getNovels();
      setNovels(res.data || []);
    } catch (err) {
      message.error('加载小说列表失败');
    }
  };

  // 选择小说时检查是否有失败的任务
  useEffect(() => {
    if (!novelId) return;
    checkExistingTask();
  }, [novelId]);

  const checkExistingTask = async () => {
    try {
      const res = await getTaskStatus(novelId);
      if (res.data) {
        setTaskStatus(res.data);
        if (res.data.status === 'failed' && res.data.lastCompletedStep !== undefined) {
          setBuilding(false);
        } else if (res.data.status === 'running') {
          setBuilding(true);
        }
      } else {
        setTaskStatus(null);
      }
    } catch {
      // 忽略
    }
  };

  useEffect(() => {
    if (!novelId || !building) return;

    // 订阅 SSE 进度
    const eventSource = new EventSource(`/novelgraph/api/novels/${novelId}/progress`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.progress) {
          setProgress(data.progress);
        }
        if (data.task) {
          setTaskStatus(data.task);
          if (['completed', 'failed', 'canceled'].includes(data.task.status)) {
            setBuilding(false);
            eventSource.close();
            if (data.task.status === 'completed') {
              message.success('构建完成！');
            } else if (data.task.status === 'failed') {
              message.error('构建失败，可点击"断点续建"从上次中断处继续');
            }
          }
        }
      } catch (err) {
        // 忽略解析错误
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [novelId, building]);

  const handleBuild = async () => {
    if (!novelId) return message.warning('请选择小说');
    setBuilding(true);
    setProgress(null);
    setTaskStatus(null);
    try {
      await startBuild(novelId);
      message.success('构建任务已启动');
    } catch (err: any) {
      message.error(err.response?.data?.error || '启动失败');
      setBuilding(false);
    }
  };

  const handleResume = async () => {
    if (!novelId) return message.warning('请选择小说');
    setBuilding(true);
    try {
      await startBuild(novelId);
      message.success('断点续建已启动');
    } catch (err: any) {
      message.error(err.response?.data?.error || '续建失败');
      setBuilding(false);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelBuild(novelId);
      message.success('取消请求已发送');
    } catch (err: any) {
      message.error(err.response?.data?.error || '取消失败');
    }
  };

  const handleEstimate = async () => {
    if (!novelId) return message.warning('请选择小说');
    try {
      const res = await getCostEstimate(novelId);
      setCostEstimate(res.data);
    } catch (err: any) {
      message.error(err.response?.data?.error || '预估失败');
    }
  };

  const phaseLabels: Record<string, string> = {
    extracting: '提取人物关系',
    disambiguating: '角色消歧',
    merging: '合并图谱数据',
    conflict_detecting: '冲突检测',
    profile_updating: '更新角色档案',
    snapshot_saving: '保存快照',
    protagonist_detecting: '主角识别',
    indexing: '搜索索引',
  };

  const isFailedWithProgress = taskStatus?.status === 'failed' && taskStatus?.lastCompletedStep !== undefined;

  return (
    <div>
      <Card title="构建任务" style={{ marginBottom: 24 }}>
        <Space style={{ marginBottom: 16 }}>
          <Select style={{ width: 250 }} placeholder="选择小说" value={novelId || undefined}
            onChange={setNovelId}
            options={novels.map((n: any) => ({ label: n.name, value: n.id }))} />
          <Button type="primary" onClick={handleBuild} loading={building}>启动构建</Button>
          {isFailedWithProgress && (
            <Tooltip title={`从第${(taskStatus.lastCompletedStep || 0) + 1}步继续`}>
              <Button type="primary" icon={<ReloadOutlined />} onClick={handleResume} disabled={building}>
                断点续建
              </Button>
            </Tooltip>
          )}
          <Button danger onClick={handleCancel} disabled={!building}>取消构建</Button>
          <Button onClick={handleEstimate} disabled={!novelId}>成本预估</Button>
        </Space>
      </Card>

      {costEstimate && (
        <Card title="成本预估" style={{ marginBottom: 24 }}>
          <Descriptions column={2}>
            <Descriptions.Item label="预估调用次数">{costEstimate.estimatedCalls} 次</Descriptions.Item>
            <Descriptions.Item label="预估输入Token">{costEstimate.estimatedInputTokens?.toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="预估输出Token">{costEstimate.estimatedOutputTokens?.toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="预估总Token">{costEstimate.estimatedTotalTokens?.toLocaleString()}</Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {(progress || isFailedWithProgress) && (
        <Card title="构建进度" style={{ marginBottom: 24 }}>
          {isFailedWithProgress && !progress && (
            <Alert
              type="warning"
              message="上次构建异常中断"
              description={`已完成第 ${taskStatus.lastCompletedStep + 1} 步（${phaseLabels[taskStatus.lastCompletedPhase] || taskStatus.lastCompletedPhase}），可点击"断点续建"继续`}
              showIcon
              style={{ marginBottom: 12 }}
            />
          )}
          {progress && (
            <Alert
              type="info"
              message={`第 ${progress.stepNumber} 步 - ${phaseLabels[progress.phase] || progress.phase}`}
              description={progress.message}
              showIcon
            />
          )}
          {taskStatus && (
            <div style={{ marginTop: 12 }}>
              <Progress
                percent={taskStatus.totalSteps ? Math.round((taskStatus.currentStep / taskStatus.totalSteps) * 100) : 0}
                format={() => `${taskStatus.currentStep || 0}/${taskStatus.totalSteps || '?'}`}
                status={taskStatus.status === 'failed' ? 'exception' : undefined}
              />
            </div>
          )}
        </Card>
      )}

      <Card title="构建流程">
        <Steps direction="vertical" items={[
          { title: '章节识别', description: '识别小说章节边界' },
          { title: '步划分', description: '按Token数贪心分组' },
          { title: '逐步构建', description: 'AI提取人物/关系/事件' },
          { title: '主角识别', description: 'AI判定主角' },
          { title: '搜索索引', description: '构建角色搜索索引' },
        ]} />
      </Card>
    </div>
  );
};

export default Task;
