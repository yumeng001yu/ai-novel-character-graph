import React, { useState, useEffect, useRef } from 'react';
import { Card, Select, Slider, Button, Space, Spin, message, Modal, Empty, Input } from 'antd';
import { RollbackOutlined, ExportOutlined, SearchOutlined } from '@ant-design/icons';
import { getGraph, getSnapshots, getNovels, rollback, exportGraph } from '../../services/api';
import G6 from '@antv/g6';

const Graph: React.FC = () => {
  const [novels, setNovels] = useState<any[]>([]);
  const [selectedNovel, setSelectedNovel] = useState<string>('');
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [centerName, setCenterName] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);

  useEffect(() => { loadNovels(); }, []);

  const loadNovels = async () => {
    try {
      const res = await getNovels();
      setNovels(res.data || []);
    } catch (err) {
      message.error('加载小说列表失败');
    }
  };

  const loadGraph = async (novelId: string, step?: number, center?: string) => {
    if (!novelId) return;
    setLoading(true);
    try {
      const params: any = {};
      if (step) params.step = step;
      if (center) params.center = center;
      const res = await getGraph(novelId, params);
      renderGraph(res.data);
    } catch (err) {
      message.error('加载图谱失败');
    }
    setLoading(false);
  };

  const loadSnapshots = async (novelId: string) => {
    try {
      const res = await getSnapshots(novelId);
      setSnapshots(res.data || []);
      if (res.data?.length > 0) {
        setCurrentStep(res.data[res.data.length - 1].step);
      }
    } catch (err) {
      message.error('加载快照失败');
    }
  };

  const handleNovelChange = (novelId: string) => {
    setSelectedNovel(novelId);
    setCenterName('');
    loadGraph(novelId);
    loadSnapshots(novelId);
  };

  const handleCenterSearch = () => {
    if (!selectedNovel || !centerName.trim()) return;
    loadGraph(selectedNovel, currentStep || undefined, centerName.trim());
  };

  const renderGraph = (data: any) => {
    if (!containerRef.current) return;

    if (graphRef.current) {
      graphRef.current.destroy();
    }

    const width = containerRef.current.offsetWidth;
    const height = containerRef.current.offsetHeight || 500;

    const graph = new G6.Graph({
      container: containerRef.current,
      width,
      height,
      layout: {
        type: 'force',
        preventOverlap: true,
        nodeSize: 50,
      },
      defaultNode: {
        size: 40,
        style: { fill: '#1890ff', stroke: '#096dd9' },
        labelCfg: { position: 'bottom', style: { fontSize: 12 } },
      },
      defaultEdge: {
        style: { stroke: '#a3b1bf', lineWidth: 1 },
        labelCfg: { style: { fontSize: 10, fill: '#666' }, autoRotate: true },
      },
      nodeStateStyles: {
        hover: { shadowColor: '#1890ff', shadowBlur: 10 },
      },
      modes: {
        default: ['drag-canvas', 'zoom-canvas', 'drag-node'],
      },
    });

    const nodes = (data.nodes || []).map((n: any) => ({
      id: n.id,
      label: n.name || n.id,
      type: 'circle',
      size: n.isProtagonist ? 60 : (data.centerId === n.id ? 55 : 40),
      style: {
        fill: data.centerId === n.id ? '#fa8c16' : (n.isProtagonist ? '#f5222d' : '#1890ff'),
      },
    }));

    const edges = (data.edges || []).map((e: any) => ({
      source: e.source || e.sourceId,
      target: e.target || e.targetId,
      label: e.relationType || '',
      style: e.isInference ? { lineDash: [5, 5], stroke: '#1890ff' } : {},
    }));

    graph.data({ nodes, edges });
    graph.render();
    graphRef.current = graph;
  };

  const handleRollback = async () => {
    if (!selectedNovel || !currentStep) return;
    Modal.confirm({
      title: `确认回退到第 ${currentStep} 步？`,
      content: '回退将删除该步之后的所有数据，此操作不可撤销。',
      onOk: async () => {
        try {
          await rollback(selectedNovel, currentStep);
          message.success('回退成功');
          loadGraph(selectedNovel);
          loadSnapshots(selectedNovel);
        } catch (err) {
          message.error('回退失败');
        }
      },
    });
  };

  const handleExport = async (format: string) => {
    if (!selectedNovel) return;
    try {
      const res = await exportGraph(selectedNovel, format);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `graph.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      message.error('导出失败');
    }
  };

  return (
    <div>
      <Card title="图谱查看" extra={
        <Space>
          <Select style={{ width: 200 }} placeholder="选择小说" value={selectedNovel || undefined}
            onChange={handleNovelChange}
            options={novels.map((n: any) => ({ label: n.name, value: n.id }))} />
          <Input
            style={{ width: 150 }}
            placeholder="中心角色名"
            value={centerName}
            onChange={e => setCenterName(e.target.value)}
            onPressEnter={handleCenterSearch}
            allowClear
          />
          <Button icon={<SearchOutlined />} onClick={handleCenterSearch} disabled={!selectedNovel}>定位</Button>
          <Button icon={<RollbackOutlined />} onClick={handleRollback} disabled={!selectedNovel}>回退</Button>
          <Button icon={<ExportOutlined />} onClick={() => handleExport('json')} disabled={!selectedNovel}>导出</Button>
        </Space>
      }>
        {snapshots.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <span>时间轴（步）： </span>
            <Slider min={1} max={snapshots.length} value={currentStep || snapshots.length}
              onChange={(v) => { setCurrentStep(v); loadGraph(selectedNovel, v, centerName || undefined); }}
              marks={Object.fromEntries(snapshots.map((s: any) => [s.step, `第${s.step}步`]))} />
          </div>
        )}
        <Spin spinning={loading}>
          {selectedNovel ? (
            <div ref={containerRef} className="graph-container" />
          ) : (
            <Empty description="请先选择一部小说" />
          )}
        </Spin>
      </Card>
    </div>
  );
};

export default Graph;
