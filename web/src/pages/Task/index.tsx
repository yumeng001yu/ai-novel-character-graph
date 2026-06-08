import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, Button, Progress, Select, Steps, message, Descriptions, Alert, Space, Tooltip, Tag, Typography, Empty } from 'antd';
import { ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { startBuild, cancelBuild, getCostEstimate, getNovels, getTaskStatus } from '../../services/api';

const { Text, Paragraph } = Typography;

/** AI 流式事件 */
interface AIStreamEvent {
  logId: string;
  type: 'start' | 'delta' | 'done';
  phase: string;
  prompt?: string;
  systemPrompt?: string;
  delta?: string;
  fullResponse?: string;
  tokenUsage?: { input: number; output: number; total: number };
  duration?: number;
  retryCount?: number;
  error?: string;
}

/** 渲染用的日志条目 */
interface AILogItem {
  logId: string;
  phase: string;
  prompt?: string;
  systemPrompt?: string;
  streamingText: string;   // 流式累积的文本
  fullResponse?: string;   // 完成后的完整响应
  tokenUsage?: { input: number; output: number; total: number };
  duration?: number;
  retryCount?: number;
  error?: string;
  status: 'streaming' | 'done' | 'error';
  timestamp: number;
}

const phaseLabels: Record<string, string> = {
  extracting: '提取人物关系',
  disambiguating: '角色消歧',
  vector_disambiguating: '向量消歧增强',
  merging: '合并图谱数据',
  implicit_relations: '隐含关系发现',
  conflict_detecting: '冲突检测',
  profile_updating: '更新角色档案',
  vector_indexing: '向量索引更新',
  snapshot_saving: '保存快照',
  protagonist_detecting: '主角识别',
  indexing: '搜索索引',
  content_refused: '内容审核跳过',
  step_skipped: '跳过',
  step_completed: '步骤完成',
};

const phaseColors: Record<string, string> = {
  extracting: 'blue',
  disambiguating: 'purple',
  merging: 'green',
  conflict_detecting: 'orange',
  profile_updating: 'cyan',
  snapshot_saving: 'default',
  protagonist_detecting: 'red',
  indexing: 'default',
};

function formatDuration(ms?: number): string {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(n?: number): string {
  if (!n) return '-';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

const Task: React.FC = () => {
  const [novels, setNovels] = useState<any[]>([]);
  const [novelId, setNovelId] = useState<string>('');
  const [progress, setProgress] = useState<any>(null);
  const [taskStatus, setTaskStatus] = useState<any>(null);
  const [costEstimate, setCostEstimate] = useState<any>(null);
  const [building, setBuilding] = useState(false);
  const [aiLogs, setAiLogs] = useState<AILogItem[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const logsRef = useRef<AILogItem[]>([]);
  const expandedKeysRef = useRef<string[]>([]);

  // 保持 ref 同步
  useEffect(() => { logsRef.current = aiLogs; }, [aiLogs]);
  useEffect(() => { expandedKeysRef.current = expandedKeys; }, [expandedKeys]);

  useEffect(() => {
    loadNovels();
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [aiLogs, autoScroll]);

  // 新日志条目自动展开（仅在新增日志时触发，不在 delta 更新时触发）
  const prevLogCountRef = useRef(0);
  useEffect(() => {
    if (aiLogs.length > prevLogCountRef.current) {
      const lastLog = aiLogs[aiLogs.length - 1];
      if (!expandedKeys.includes(lastLog.logId)) {
        setExpandedKeys(prev => [...prev, lastLog.logId]);
      }
    }
    prevLogCountRef.current = aiLogs.length;
  }, [aiLogs.length]);

  const loadNovels = async () => {
    try {
      const res = await getNovels();
      setNovels(res.data || []);
    } catch (err) {
      message.error('加载小说列表失败');
    }
  };

  // 处理流式事件
  const handleStreamEvent = useCallback((event: AIStreamEvent) => {
    if (event.type === 'start') {
      // 新建日志条目
      const newLog: AILogItem = {
        logId: event.logId,
        phase: event.phase,
        prompt: event.prompt,
        systemPrompt: event.systemPrompt,
        streamingText: '',
        status: 'streaming',
        timestamp: Date.now(),
      };
      setAiLogs(prev => [...prev, newLog]);
    } else if (event.type === 'delta') {
      // 增量追加文本
      setAiLogs(prev => prev.map(log =>
        log.logId === event.logId
          ? { ...log, streamingText: log.streamingText + (event.delta || '') }
          : log
      ));
    } else if (event.type === 'done') {
      // 完成
      setAiLogs(prev => prev.map(log =>
        log.logId === event.logId
          ? {
              ...log,
              status: event.error ? 'error' : 'done',
              fullResponse: event.fullResponse,
              tokenUsage: event.tokenUsage,
              duration: event.duration,
              retryCount: event.retryCount,
              error: event.error,
            }
          : log
      ));
    }
  }, []);

  // 连接 SSE 进度推送
  const connectSSE = useCallback((id: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const eventSource = new EventSource(`/novelgraph/api/novels/${id}/progress`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // 处理 AI 流式事件
        if (data.aiStream) {
          handleStreamEvent(data.aiStream);
        }

        // 处理 AI 日志（兼容旧格式）
        if (data.aiLog) {
          const log = data.aiLog;
          handleStreamEvent({
            logId: log.id,
            type: 'start',
            phase: log.phase,
            prompt: log.prompt,
            systemPrompt: log.systemPrompt,
          });
          handleStreamEvent({
            logId: log.id,
            type: 'delta',
            phase: log.phase,
            delta: log.response,
          });
          handleStreamEvent({
            logId: log.id,
            type: 'done',
            phase: log.phase,
            fullResponse: log.response,
            tokenUsage: log.tokenUsage,
            duration: log.duration,
            retryCount: log.retryCount,
            error: log.error,
          });
        }

        // 处理进度更新
        if (data.progress) {
          setProgress(data.progress);
        }

        // 处理任务状态
        if (data.task) {
          setTaskStatus(data.task);
          if (['completed', 'failed', 'canceled'].includes(data.task.status)) {
            setBuilding(false);
            eventSource.close();
            eventSourceRef.current = null;
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
      // SSE 连接断开时不立即关闭，让浏览器自动重连
    };
  }, [handleStreamEvent]);

  const disconnectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  // 选择小说时检查任务状态
  const prevNovelIdRef = useRef<string>('');
  useEffect(() => {
    if (!novelId) return;

    // 切换小说时清空日志，同一小说重连时保留
    if (novelId !== prevNovelIdRef.current) {
      setAiLogs([]);
      setProgress(null);
      prevNovelIdRef.current = novelId;
    }

    const checkAndConnect = async () => {
      try {
        const res = await getTaskStatus(novelId);
        if (res.data) {
          setTaskStatus(res.data);
          if (res.data.status === 'running') {
            setBuilding(true);
            connectSSE(novelId);
          } else {
            setBuilding(false);
          }
        } else {
          setTaskStatus(null);
          setBuilding(false);
        }
      } catch {
        // 忽略
      }
    };

    checkAndConnect();

    return () => { disconnectSSE(); };
  }, [novelId, connectSSE, disconnectSSE]);

  useEffect(() => {
    return () => { disconnectSSE(); };
  }, [disconnectSSE]);

  const handleBuild = async () => {
    if (!novelId) return message.warning('请选择小说');
    setBuilding(true);
    setProgress(null);
    setTaskStatus(null);
    setAiLogs([]);
    try {
      await startBuild(novelId);
      message.success('构建任务已启动');
      connectSSE(novelId);
    } catch (err: any) {
      message.error(err.response?.data?.error || '启动失败');
      setBuilding(false);
    }
  };

  const handleResume = async () => {
    if (!novelId) return message.warning('请选择小说');
    setBuilding(true);
    setAiLogs([]);
    try {
      await startBuild(novelId);
      message.success('断点续建已启动');
      connectSSE(novelId);
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

  const isFailedWithProgress = taskStatus?.status === 'failed' && taskStatus?.lastCompletedStep !== undefined;
  const isRunning = taskStatus?.status === 'running';

  // 统计总 Token 用量
  const totalTokenUsage = aiLogs.reduce(
    (acc, log) => ({
      input: acc.input + (log.tokenUsage?.input || 0),
      output: acc.output + (log.tokenUsage?.output || 0),
      total: acc.total + (log.tokenUsage?.total || 0),
    }),
    { input: 0, output: 0, total: 0 },
  );

  // 正在流式输出的日志数量
  const streamingCount = aiLogs.filter(l => l.status === 'streaming').length;

  // 计算构建流程大阶段
  const buildPhase = (() => {
    if (!taskStatus) return -1;
    if (taskStatus.status === 'completed') return 5;
    if (taskStatus.status === 'failed' || taskStatus.status === 'canceled') return -1;
    if (!progress) return 0;
    // 根据 progress.phase 映射到大阶段
    const phase = progress.phase || '';
    if (phase === 'extracting' || phase === 'disambiguating' || phase === 'vector_disambiguating'
      || phase === 'merging' || phase === 'implicit_relations' || phase === 'conflict_detecting'
      || phase === 'profile_updating' || phase === 'snapshot_saving' || phase === 'vector_indexing'
      || phase === 'content_refused') {
      return 2; // 逐步构建
    }
    if (phase === 'protagonist_detecting') return 3;
    if (phase === 'indexing') return 4;
    return 1; // 步划分（默认）
  })();

  return (
    <div>
      <Card title="构建任务" style={{ marginBottom: 24 }}>
        <Space style={{ marginBottom: 16 }}>
          <Select style={{ width: 250 }} placeholder="选择小说" value={novelId || undefined}
            onChange={setNovelId}
            options={novels.map((n: any) => ({ label: n.name, value: n.id }))} />
          <Button type="primary" onClick={handleBuild} loading={building && !isRunning} disabled={building}>
            {isRunning ? '构建中...' : '启动构建'}
          </Button>
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

      {(progress || taskStatus) && (
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
              type={progress.phase === 'content_refused' ? 'warning' : 'info'}
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
                status={taskStatus.status === 'failed' ? 'exception' : taskStatus.status === 'completed' ? 'success' : undefined}
              />
              {isRunning && (
                <div style={{ marginTop: 8 }}>
                  <Tag color="processing">构建中</Tag>
                  {totalTokenUsage.total > 0 && (
                    <Tag color="blue">已用Token: {formatTokens(totalTokenUsage.total)}</Tag>
                  )}
                  {streamingCount > 0 && (
                    <Tag color="cyan">AI 输出中 x{streamingCount}</Tag>
                  )}
                  <span style={{ color: '#888', fontSize: 12 }}>离开此页面不会中断构建，返回后将自动恢复进度显示</span>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* AI 实时日志面板 */}
      <Card
        title={
          <Space>
            <span>AI 实时日志</span>
            {aiLogs.length > 0 && <Tag color="blue">{aiLogs.length} 条</Tag>}
            {totalTokenUsage.total > 0 && (
              <Tag color="green">
                Token: {formatTokens(totalTokenUsage.input)} 入 / {formatTokens(totalTokenUsage.output)} 出
              </Tag>
            )}
          </Space>
        }
        extra={
          <Space>
            <Button size="small" type={autoScroll ? 'primary' : 'default'} onClick={() => setAutoScroll(!autoScroll)}>
              {autoScroll ? '自动滚动' : '手动滚动'}
            </Button>
            {aiLogs.length > 0 && <Button size="small" onClick={() => setAiLogs([])}>清空</Button>}
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        {aiLogs.length === 0 ? (
          <Empty
            description={isRunning ? '等待 AI 响应...' : '暂无 AI 日志，启动构建后实时显示'}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <div
            ref={logContainerRef}
            style={{
              maxHeight: 600,
              overflowY: 'auto',
              border: '1px solid #f0f0f0',
              borderRadius: 6,
              padding: 8,
            }}
          >
            {aiLogs.map((log) => (
              <div
                key={log.logId}
                style={{
                  marginBottom: 8,
                  border: '1px solid #f0f0f0',
                  borderRadius: 6,
                  overflow: 'hidden',
                }}
              >
                {/* 标题栏 */}
                <div
                  style={{
                    padding: '6px 12px',
                    background: log.status === 'error' ? '#fff2f0' : log.status === 'streaming' ? '#e6f7ff' : '#f6ffed',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setExpandedKeys(prev =>
                      prev.includes(log.logId)
                        ? prev.filter(k => k !== log.logId)
                        : [...prev, log.logId]
                    );
                  }}
                >
                  {log.status === 'streaming' ? (
                    <LoadingOutlined style={{ color: '#1890ff' }} />
                  ) : log.status === 'error' ? (
                    <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                  ) : (
                    <CheckCircleOutlined style={{ color: '#52c41a' }} />
                  )}
                  <Tag color={phaseColors[log.phase] || 'default'} style={{ marginRight: 0 }}>
                    {phaseLabels[log.phase] || log.phase}
                  </Tag>
                  {log.status === 'streaming' && (
                    <Tag color="processing" style={{ fontSize: 11 }}>输出中...</Tag>
                  )}
                  {log.tokenUsage && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {formatTokens(log.tokenUsage.total)} tokens
                    </Text>
                  )}
                  {log.duration && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDuration(log.duration)}
                    </Text>
                  )}
                  {log.retryCount && log.retryCount > 0 && (
                    <Tag color="warning" style={{ fontSize: 11 }}>重试{log.retryCount}次</Tag>
                  )}
                  {log.error && <Text type="danger" style={{ fontSize: 12 }}>失败</Text>}
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </Text>
                </div>

                {/* 流式输出区域 - 始终显示 */}
                <div style={{ padding: '8px 12px' }}>
                  {/* 流式文本（打字机效果） */}
                  <div
                    style={{
                      background: '#f9f9f9',
                      padding: 8,
                      borderRadius: 4,
                      border: '1px solid #d9d9d9',
                      fontFamily: 'monospace',
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      maxHeight: 300,
                      overflowY: 'auto',
                      lineHeight: 1.6,
                    }}
                  >
                    {log.streamingText || (log.status === 'streaming' ? '▌' : '')}
                    {log.status === 'streaming' && (
                      <span style={{ animation: 'blink 1s infinite', color: '#1890ff' }}>▌</span>
                    )}
                  </div>
                </div>

                {/* 展开详情 */}
                {expandedKeys.includes(log.logId) && (
                  <div style={{ padding: '0 12px 8px' }}>
                    {/* 系统提示词 */}
                    {log.systemPrompt && (
                      <div style={{ marginBottom: 8 }}>
                        <Text strong style={{ color: '#722ed1' }}>系统提示词：</Text>
                        <Paragraph
                          style={{ marginBottom: 0, fontSize: 12, color: '#666', whiteSpace: 'pre-wrap' }}
                          ellipsis={{ rows: 3, expandable: 'collapsible', symbol: '展开' }}
                        >
                          {log.systemPrompt}
                        </Paragraph>
                      </div>
                    )}

                    {/* 用户提示词 */}
                    {log.prompt && (
                      <div style={{ marginBottom: 8 }}>
                        <Text strong style={{ color: '#1890ff' }}>提示词：</Text>
                        <Paragraph
                          style={{ marginBottom: 0, fontSize: 12, color: '#333', whiteSpace: 'pre-wrap' }}
                          ellipsis={{ rows: 5, expandable: 'collapsible', symbol: '展开' }}
                        >
                          {log.prompt}
                        </Paragraph>
                      </div>
                    )}

                    {/* 错误信息 */}
                    {log.error && (
                      <div style={{ marginBottom: 8 }}>
                        <Text strong style={{ color: '#ff4d4f' }}>错误：</Text>
                        <Paragraph
                          style={{
                            marginBottom: 0,
                            fontSize: 12,
                            color: '#ff4d4f',
                            background: '#fff2f0',
                            padding: 8,
                            borderRadius: 4,
                            border: '1px solid #ffccc7',
                          }}
                        >
                          {log.error}
                        </Paragraph>
                      </div>
                    )}

                    {/* Token 用量 */}
                    {log.tokenUsage && (
                      <div style={{ marginTop: 4 }}>
                        <Space size={16}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            输入: {log.tokenUsage.input.toLocaleString()} tokens
                          </Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            输出: {log.tokenUsage.output.toLocaleString()} tokens
                          </Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            合计: {log.tokenUsage.total.toLocaleString()} tokens
                          </Text>
                          {log.duration && (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              耗时: {formatDuration(log.duration)}
                            </Text>
                          )}
                        </Space>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="构建流程">
        <Steps direction="vertical" current={buildPhase} items={[
          { title: '章节识别', description: '识别小说章节边界', status: buildPhase > 0 ? 'finish' : buildPhase === 0 ? 'process' : 'wait' },
          { title: '步划分', description: '按Token数贪心分组', status: buildPhase > 1 ? 'finish' : buildPhase === 1 ? 'process' : 'wait' },
          {
            title: '逐步构建',
            description: progress && buildPhase === 2
              ? `第 ${progress.stepNumber} 步 - ${phaseLabels[progress.phase] || progress.phase}`
              : 'AI提取人物/关系/事件',
            status: buildPhase > 2 ? 'finish' : buildPhase === 2 ? 'process' : 'wait',
          },
          { title: '主角识别', description: 'AI判定主角', status: buildPhase > 3 ? 'finish' : buildPhase === 3 ? 'process' : 'wait' },
          { title: '搜索索引', description: '构建角色搜索索引', status: buildPhase === 5 ? 'finish' : buildPhase === 4 ? 'process' : 'wait' },
        ]} />
      </Card>

      {/* 光标闪烁动画 */}
      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default Task;
