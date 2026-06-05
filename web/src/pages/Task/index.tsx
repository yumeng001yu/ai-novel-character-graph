import React, { useState, useEffect } from 'react';
import { Card, Button, Progress, Input, Steps, message, Tag, Descriptions } from 'antd';
import { startBuild, cancelBuild, getCostEstimate } from '../../services/api';

const Task: React.FC = () => {
  const [novelId, setNovelId] = useState('');
  const [progress, setProgress] = useState<any>(null);
  const [costEstimate, setCostEstimate] = useState<any>(null);
  const [building, setBuilding] = useState(false);

  const handleBuild = async () => {
    if (!novelId) return message.warning('请输入小说ID');
    setBuilding(true);
    try {
      await startBuild(novelId);
      message.success('构建任务已启动');
    } catch (err: any) {
      message.error(err.response?.data?.error || '启动失败');
    }
    setBuilding(false);
  };

  const handleCancel = async () => {
    try {
      await cancelBuild(novelId);
      message.success('取消请求已发送');
      setBuilding(false);
    } catch (err: any) {
      message.error(err.response?.data?.error || '取消失败');
    }
  };

  const handleEstimate = async () => {
    if (!novelId) return;
    const res = await getCostEstimate(novelId);
    setCostEstimate(res.data);
  };

  return (
    <div>
      <Card title="构建任务" style={{ marginBottom: 24 }}>
        <Input placeholder="输入小说ID" value={novelId} onChange={e => setNovelId(e.target.value)} style={{ width: 300, marginBottom: 16 }} />
        <div>
          <Button type="primary" onClick={handleBuild} loading={building} style={{ marginRight: 8 }}>启动构建</Button>
          <Button danger onClick={handleCancel} disabled={!building} style={{ marginRight: 8 }}>取消构建</Button>
          <Button onClick={handleEstimate}>成本预估</Button>
        </div>
      </Card>

      {costEstimate && (
        <Card title="成本预估" style={{ marginBottom: 24 }}>
          <Descriptions column={2}>
            <Descriptions.Item label="预估调用次数">{costEstimate.estimatedCalls} 次</Descriptions.Item>
            <Descriptions.Item label="预估输入Token">{costEstimate.estimatedInputTokens.toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="预估输出Token">{costEstimate.estimatedOutputTokens.toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="预估总Token">{costEstimate.estimatedTotalTokens.toLocaleString()}</Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      <Card title="构建进度">
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
