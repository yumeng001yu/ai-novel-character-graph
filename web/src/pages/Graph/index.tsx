import React, { useState, useEffect, useRef } from 'react';
import { Card, Select, Slider, Button, Space, Spin, message, Modal } from 'antd';
import { RollbackOutlined, ExportOutlined } from '@ant-design/icons';
import { getGraph, getSnapshots, getSnapshot, rollback, exportGraph } from '../../services/api';
import G6 from '@antv/g6';

const Graph: React.FC = () => {
  const [novels, setNovels] = useState<any[]>([]);
  const [selectedNovel, setSelectedNovel] = useState<string>('');
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [graphData, setGraphData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);

  useEffect(() => { loadNovels(); }, []);

  const loadNovels = async () => {
    const res = await getGraph(''); // 获取小说列表需要单独API
    // 简化：使用 novels API
    const novelsRes = await (await import('../../services/api')).default.get('/novels');
    setNovels(novelsRes.data);
  };

  const loadGraph = async (novelId: string, step?: number) => {
    if (!novelId) return;
    setLoading(true);
    try {
      const params: any = {};
      if (step) params.step = step;
      const res = await getGraph(novelId, params);
      setGraphData(res.data);
      renderGraph(res.data);
    } catch (err) {
      message.error('加载图谱失败');
    }
    setLoading(false);
  };

  const loadSnapshots = async (novelId: string) => {
    const res = await getSnapshots(novelId);
    setSnapshots(res.data);
  };

  const renderGraph = (data: any) => {
    if (!containerRef.current) return;

    if (graphRef.current) {
      graphRef.current.destroy();
    }

    const width = containerRef.current.offsetWidth;
    const height = containerRef.current.offsetHeight;

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
      size: n.isProtagonist ? 60 : 40,
      style: { fill: n.isProtagonist ? '#f5222d' : '#1890ff' },
    }));

    const edges = (data.edges || []).map((e: any, i: number) => ({
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
      onOk: async () => {
        await rollback(selectedNovel, currentStep);
        message.success('回退成功');
        loadGraph(selectedNovel);
      },
    });
  };

  const handleExport = async (format: string) => {
    if (!selectedNovel) return;
    const res = await exportGraph(selectedNovel, format);
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = `graph.${format}`;
    a.click();
  };

  return (
    <div>
      <Card title="图谱查看" extra={
        <Space>
          <Select style={{ width: 200 }} placeholder="选择小说" value={selectedNovel}
            onChange={(v) => { setSelectedNovel(v); loadGraph(v); loadSnapshots(v); }}
            options={novels.map((n: any) => ({ label: n.name, value: n.id }))} />
          <Button icon={<RollbackOutlined />} onClick={handleRollback}>回退</Button>
          <Button icon={<ExportOutlined />} onClick={() => handleExport('json')}>导出</Button>
        </Space>
      }>
        {snapshots.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <span>时间轴（步）： </span>
            <Slider min={1} max={snapshots.length} value={currentStep || snapshots.length}
              onChange={(v) => { setCurrentStep(v); loadGraph(selectedNovel, v); }}
              marks={Object.fromEntries(snapshots.map((s: any) => [s.step, `第${s.step}步`]))} />
          </div>
        )}
        <Spin spinning={loading}>
          <div ref={containerRef} className="graph-container" />
        </Spin>
      </Card>
    </div>
  );
};

export default Graph;
