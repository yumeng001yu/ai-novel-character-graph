import React, { useState, useEffect, useRef } from 'react';
import { Slider, Button, Space, Spin, message, Modal, Input, Descriptions, Tag, Timeline, Divider, theme } from 'antd';
import { RollbackOutlined, ExportOutlined, SearchOutlined } from '@ant-design/icons';
import { getGraph, getSnapshots, rollback, exportGraph, getCharacter, getCharacterTimeline } from '../../services/api';
import G6 from '@antv/g6';

interface Props {
  novelId: string;
}

const GraphTab: React.FC<Props> = ({ novelId }) => {
  const { token } = theme.useToken();
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [centerName, setCenterName] = useState<string>('');
  const [selectedChar, setSelectedChar] = useState<any>(null);
  const [charDetail, setCharDetail] = useState<any>(null);
  const [charTimeline, setCharTimeline] = useState<any[]>([]);
  const [charLoading, setCharLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);

  useEffect(() => {
    loadGraph(novelId);
    loadSnapshots(novelId);
  }, [novelId]);

  // 组件卸载时销毁 G6 实例
  useEffect(() => {
    return () => {
      if (graphRef.current) {
        graphRef.current.destroy();
        graphRef.current = null;
      }
    };
  }, []);

  const loadGraph = async (nid: string, step?: number, center?: string) => {
    if (!nid) return;
    if (center) setLocating(true);
    else setLoading(true);
    try {
      const params: any = {};
      if (step) params.step = step;
      if (center) params.center = center;
      const res = await getGraph(nid, params);
      renderGraph(res.data);
      // 如果搜索了角色但后端返回 centerFound=false，说明角色未找到
      if (center && !res.data.centerFound) {
        message.warning(`未找到角色「${center}」，已显示主角图谱`);
      }
    } catch (err) {
      message.error('加载图谱失败');
    }
    setLoading(false);
    setLocating(false);
  };

  const loadSnapshots = async (nid: string) => {
    try {
      const res = await getSnapshots(nid);
      setSnapshots(res.data || []);
      if (res.data?.length > 0) {
        setCurrentStep(res.data[res.data.length - 1].step);
      }
    } catch (err) {
      message.error('加载快照失败');
    }
  };

  const handleCenterSearch = () => {
    if (!novelId || !centerName.trim()) return;
    loadGraph(novelId, currentStep || undefined, centerName.trim());
  };

  const handleNodeClick = async (nodeId: string) => {
    setCharLoading(true);
    setSelectedChar(nodeId);
    try {
      const [detailRes, timelineRes] = await Promise.all([
        getCharacter(nodeId),
        getCharacterTimeline(nodeId),
      ]);
      setCharDetail(detailRes.data);
      setCharTimeline(timelineRes.data?.experienceTimeline || []);
    } catch {
      setCharDetail({ character: { id: nodeId, name: nodeId } });
      setCharTimeline([]);
    }
    setCharLoading(false);
  };

  const renderGraph = (data: any) => {
    if (!containerRef.current) return;

    if (graphRef.current) {
      graphRef.current.destroy();
    }

    const width = containerRef.current.offsetWidth;
    const height = containerRef.current.offsetHeight || 600;

    const primaryColor = token.colorPrimary;
    const primaryBg = token.colorBgContainer;
    const textColor = token.colorText;
    const textSecondary = token.colorTextSecondary;
    const borderColor = token.colorBorder;

    const graph = new G6.Graph({
      container: containerRef.current,
      width,
      height,
      layout: {
        type: 'force',
        preventOverlap: true,
        nodeSize: 80,
        nodeSpacing: 40,
        linkDistance: 180,
        nodeStrength: -1200,
        edgeStrength: 0.3,
        collideStrength: 0.8,
        alpha: 0.3,
        alphaDecay: 0.02,
        forceSimulation: undefined,
      },
      defaultNode: {
        size: 40,
        style: { fill: primaryColor, stroke: primaryColor },
        labelCfg: {
          position: 'bottom',
          style: { fontSize: 12, fill: textColor },
          offset: 6,
        },
      },
      defaultEdge: {
        style: { stroke: borderColor, lineWidth: 1 },
        labelCfg: {
          style: { fontSize: 10, fill: textSecondary, background: { fill: primaryBg, padding: [2, 4, 2, 4], radius: 2 } },
          autoRotate: true,
        },
      },
      nodeStateStyles: {
        hover: { shadowColor: primaryColor, shadowBlur: 12 },
        selected: { shadowColor: '#fa8c16', shadowBlur: 15 },
      },
      modes: {
        default: ['drag-canvas', 'zoom-canvas', 'drag-node'],
      },
    });

    graph.on('node:click', (evt: any) => {
      const nodeId = evt.item.getID();
      handleNodeClick(nodeId);
    });

    const nodes = (data.nodes || []).map((n: any) => ({
      id: n.id,
      label: n.name || n.id,
      type: 'circle',
      size: n.isProtagonist ? 65 : (data.centerId === n.id ? 55 : 45),
      style: {
        fill: data.centerId === n.id ? '#fa8c16' : (n.isProtagonist ? '#f5222d' : primaryColor),
      },
    }));

    const edges = (data.edges || []).map((e: any) => ({
      source: e.source || e.sourceId,
      target: e.target || e.targetId,
      label: e.relationType || '',
      style: e.isInference ? { lineDash: [5, 5], stroke: primaryColor } : {},
    }));

    graph.data({ nodes, edges });
    graph.render();

    graph.on('layout:end', () => {
      graph.fitView([40, 40]);
      // 优先聚焦 centerId（搜索的角色），其次聚焦主角
      const focusId = data.centerId || (data.nodes || []).find((n: any) => n.isProtagonist)?.id;
      if (focusId) {
        const nodeItem = graph.findById(focusId);
        if (nodeItem) {
          graph.focusItem(nodeItem, false, { easing: 'easeCubic', duration: 500 });
        }
      }
    });

    graphRef.current = graph;
  };

  const handleRollback = async () => {
    if (!novelId || !currentStep) return;
    Modal.confirm({
      title: `确认回退到第 ${currentStep} 步？`,
      content: '回退将删除该步之后的所有数据，此操作不可撤销。',
      onOk: async () => {
        try {
          await rollback(novelId, currentStep);
          message.success('回退成功');
          loadGraph(novelId);
          loadSnapshots(novelId);
        } catch (err) {
          message.error('回退失败');
        }
      },
    });
  };

  const handleExport = async (format: string) => {
    if (!novelId) return;
    try {
      const res = await exportGraph(novelId, format);
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

  const char = charDetail?.character;
  const relations = charDetail?.relations || [];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Space wrap>
          <Input
            style={{ width: 150 }}
            placeholder="中心角色名"
            value={centerName}
            onChange={e => setCenterName(e.target.value)}
            onPressEnter={handleCenterSearch}
            allowClear
          />
          <Button icon={<SearchOutlined />} onClick={handleCenterSearch} loading={locating}>定位</Button>
          <Button icon={<RollbackOutlined />} onClick={handleRollback}>回退</Button>
          <Button icon={<ExportOutlined />} onClick={() => handleExport('json')}>导出</Button>
        </Space>
      </div>

      {snapshots.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <span>时间轴（步）： </span>
          <Slider min={1} max={snapshots.length} value={currentStep || snapshots.length}
            onChange={(v) => { setCurrentStep(v); loadGraph(novelId, v, centerName || undefined); }}
            marks={Object.fromEntries(snapshots.map((s: any) => [s.step, `第${s.step}步`]))} />
        </div>
      )}
      <Spin spinning={loading} tip="加载图谱中...">
        <div style={{ position: 'relative' }}>
          {locating && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
              display: 'flex', justifyContent: 'center', padding: '8px 0',
            }}>
              <span style={{
                background: token.colorPrimaryBg,
                border: `1px solid ${token.colorPrimaryBorder}`,
                borderRadius: 6, padding: '4px 16px', fontSize: 13,
                color: token.colorPrimary,
              }}>
                正在定位角色「{centerName}」...
              </span>
            </div>
          )}
          <div ref={containerRef} className="graph-container" />
        </div>
      </Spin>

      {/* 角色详情弹窗 */}
      <Modal
        title={char ? `角色详情：${char.name}` : '角色详情'}
        open={!!selectedChar}
        onCancel={() => { setSelectedChar(null); setCharDetail(null); setCharTimeline([]); }}
        footer={null}
        width={560}
      >
        <Spin spinning={charLoading}>
          {char && (
            <div>
              <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
                <Descriptions.Item label="名字">{char.name}</Descriptions.Item>
                <Descriptions.Item label="性别">{char.gender || '未知'}</Descriptions.Item>
                <Descriptions.Item label="阵营">{char.faction || '未知'}</Descriptions.Item>
                <Descriptions.Item label="身份">{char.identity || '未知'}</Descriptions.Item>
                <Descriptions.Item label="主角" span={2}>
                  {char.isProtagonist ? <Tag color="red">主角</Tag> : '否'}
                  {char.protagonistOrder != null && char.protagonistOrder > 0 && ` · 第${char.protagonistOrder}主角`}
                </Descriptions.Item>
                {char.aliases?.length > 0 && (
                  <Descriptions.Item label="别名" span={2}>
                    {char.aliases.map((a: string) => <Tag key={a} style={{ marginBottom: 2 }}>{a}</Tag>)}
                  </Descriptions.Item>
                )}
                {char.description && (
                  <Descriptions.Item label="描述" span={2}>{char.description}</Descriptions.Item>
                )}
                {char.firstAppearChapter && (
                  <Descriptions.Item label="首次出场">{char.firstAppearChapter}</Descriptions.Item>
                )}
              </Descriptions>

              {charTimeline.length > 0 && (
                <>
                  <Divider orientation="left">人物经历</Divider>
                  <Timeline style={{ marginBottom: 16 }}>
                    {charTimeline.map((t: any, i: number) => (
                      <Timeline.Item key={i} color={i === 0 ? 'red' : 'blue'}>
                        <b>{t.chapter || `第${i + 1}步`}</b>：{t.event}
                      </Timeline.Item>
                    ))}
                  </Timeline>
                </>
              )}

              {relations.length > 0 && (
                <>
                  <Divider orientation="left">人物关系（{relations.length}条）</Divider>
                  <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                    {relations.map((r: any, i: number) => {
                      const isSource = r.sourceId === selectedChar;
                      const otherName = isSource
                        ? (r.targetName || r.targetId)
                        : (r.sourceName || r.sourceId);
                      const direction = isSource ? '→' : '←';
                      return (
                        <div key={i} style={{ marginBottom: 8, padding: '4px 8px', background: token.colorFillQuaternary, borderRadius: 4 }}>
                          <Tag color="blue">{otherName}</Tag>
                          <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>{direction} {r.relationType}</span>
                          {r.description && <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>{r.description}</div>}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </Spin>
      </Modal>
    </div>
  );
};

export default GraphTab;
