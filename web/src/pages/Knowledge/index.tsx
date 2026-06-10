import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Row, Col, Input, Tag, Popconfirm, Button, Empty, Spin, message, theme, Typography, Space } from 'antd';
import { SearchOutlined, DeleteOutlined, BookOutlined, SendOutlined, UserOutlined, RobotOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getKnowledgeBase, searchKnowledgeBase, deleteNovel } from '../../services/api';

const { Paragraph } = Typography;

interface NovelItem {
  id: string;
  name: string;
  totalChars?: number;
  totalTokens?: number;
  buildStatus?: string;
  graphBuilt?: boolean;
  characterCount?: number;
  relationCount?: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: {
    characters?: string[];
    novels?: string[];
    passages?: string[];
  };
  loading?: boolean;
}

const Knowledge: React.FC = () => {
  const { token: themeToken } = theme.useToken();
  const navigate = useNavigate();
  const [novels, setNovels] = useState<NovelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // 问答相关状态
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const loadNovels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getKnowledgeBase();
      setNovels(res.data?.novels || []);
    } catch (err) {
      message.error('加载知识库失败');
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadNovels(); }, [loadNovels]);

  const handleSearch = async (value: string) => {
    const q = value.trim();
    if (!q) {
      loadNovels();
      return;
    }
    setLoading(true);
    try {
      const res = await searchKnowledgeBase(q);
      setNovels(res.data?.novels || []);
    } catch (err) {
      message.error('搜索失败');
    }
    setLoading(false);
  };

  const handleDelete = async (id: string, name: string) => {
    try {
      const res = await deleteNovel(id);
      message.success(res.data?.message || `已删除「${name}」`);
      loadNovels();
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
    }
  };

  const getGraphStatusTag = (novel: NovelItem) => {
    const status = novel.buildStatus;
    if (status === 'completed') return <Tag color="success">已完成</Tag>;
    if (status === 'running') return <Tag color="processing">构建中</Tag>;
    if (status === 'failed') return <Tag color="error">构建失败</Tag>;
    return <Tag>未构建</Tag>;
  };

  const formatChars = (n?: number) => {
    if (!n) return '-';
    if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
    return n.toLocaleString();
  };

  // 全局问答发送
  const handleSend = async () => {
    const question = input.trim();
    if (!question || sending) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: question,
    };
    const assistantMsg: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      loading: true,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setSending(true);

    try {
      const response = await fetch('/novelgraph/api/graphrag/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, stream: true }),
      });

      if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('浏览器不支持流式读取');
      }

      const decoder = new TextDecoder();
      let fullContent = '';
      let sources: ChatMessage['sources'];
      let sseBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const eventBlocks = sseBuffer.split('\n\n');
        sseBuffer = eventBlocks.pop() || '';

        for (const block of eventBlocks) {
          const lines = block.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);

              if (data.type === 'delta' && data.delta) {
                fullContent += data.delta;
                setMessages(prev => prev.map(m =>
                  m.id === assistantMsg.id
                    ? { ...m, content: fullContent, loading: false }
                    : m
                ));
              }

              if (data.type === 'done') {
                if (data.sources) {
                  sources = {
                    characters: data.sources
                      .filter((s: any) => s.type === 'character')
                      .map((s: any) => `${s.name}（${s.novelName || '未知'}）`),
                    novels: [...new Set(data.sources
                      .filter((s: any) => s.novelName)
                      .map((s: any) => s.novelName as string))] as string[],
                    passages: data.sources
                      .filter((s: any) => s.type === 'text_chunk')
                      .map((s: any) => `【${s.novelName || '未知'}】第${s.stepNumber}步 ${s.chapterRange}`),
                  };
                }
                setMessages(prev => prev.map(m =>
                  m.id === assistantMsg.id
                    ? { ...m, content: fullContent, sources, loading: false }
                    : m
                ));
              }

              if (data.type === 'error') {
                setMessages(prev => prev.map(m =>
                  m.id === assistantMsg.id
                    ? { ...m, content: data.error || '请求失败', loading: false }
                    : m
                ));
              }
            } catch {
              // 非 JSON 数据忽略
            }
          }
        }
      }

      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id
          ? { ...m, content: fullContent || '无回答', sources, loading: false }
          : m
      ));
    } catch (err: any) {
      await fallbackPostRequest(question, assistantMsg);
      return;
    }
    setSending(false);
  };

  const fallbackPostRequest = async (question: string, assistantMsg: ChatMessage) => {
    try {
      const api = (await import('../../services/api')).default;
      const res = await api.post('/graphrag/query', { question });
      const data = res.data;
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id
          ? {
              ...m,
              content: data.answer || data.response || data.content || '无回答',
              sources: data.sources,
              loading: false,
            }
          : m
      ));
    } catch (err: any) {
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id
          ? { ...m, content: err.response?.data?.error || '请求失败，请检查后端是否支持 GraphRAG', loading: false }
          : m
      ));
    }
    setSending(false);
  };

  return (
    <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 120px)' }}>
      {/* 左侧：问答模块 */}
      <Card
        title="知识库问答"
        style={{ width: '45%', minWidth: 380, display: 'flex', flexDirection: 'column' }}
        styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 16px', overflow: 'hidden' } }}
      >
        {/* 消息列表 */}
        <div
          ref={chatContainerRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 12,
            background: themeToken.colorBgContainer,
            borderRadius: 8,
            border: `1px solid ${themeToken.colorBorder}`,
            marginBottom: 12,
          }}
        >
          {messages.length === 0 ? (
            <Empty description="输入问题，AI 将基于知识库中所有小说回答" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            messages.map(msg => (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  marginBottom: 12,
                }}
              >
                <div style={{
                  maxWidth: '85%',
                  display: 'flex',
                  gap: 8,
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                }}>
                  <div style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: msg.role === 'user' ? themeToken.colorPrimary : themeToken.colorSuccess,
                    color: '#fff',
                    flexShrink: 0,
                    fontSize: 12,
                  }}>
                    {msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                  </div>
                  <div>
                    <div style={{
                      padding: '8px 12px',
                      borderRadius: msg.role === 'user' ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
                      background: msg.role === 'user' ? themeToken.colorPrimaryBg : themeToken.colorBgLayout,
                      border: `1px solid ${msg.role === 'user' ? themeToken.colorPrimaryBorder : themeToken.colorBorder}`,
                      fontSize: 13,
                      lineHeight: 1.6,
                    }}>
                      {msg.loading ? (
                        <Spin size="small" />
                      ) : (
                        <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap', fontSize: 13 }}>
                          {msg.content}
                        </Paragraph>
                      )}
                    </div>
                    {msg.sources && (
                      <div style={{ marginTop: 4, fontSize: 11, color: themeToken.colorTextSecondary }}>
                        {msg.sources.novels && msg.sources.novels.length > 0 && (
                          <div>
                            相关小说：{msg.sources.novels.map(n => <Tag key={n} color="green" style={{ fontSize: 10 }}>{n}</Tag>)}
                          </div>
                        )}
                        {msg.sources.characters && msg.sources.characters.length > 0 && (
                          <div style={{ marginTop: 2 }}>
                            相关角色：{msg.sources.characters.map(c => <Tag key={c} color="blue" style={{ fontSize: 10 }}>{c}</Tag>)}
                          </div>
                        )}
                        {msg.sources.passages && msg.sources.passages.length > 0 && (
                          <div style={{ marginTop: 2 }}>
                            相关原文：
                            {msg.sources.passages.map((p, i) => (
                              <div key={i} style={{
                                marginTop: 2,
                                padding: '2px 6px',
                                background: themeToken.colorFillQuaternary,
                                borderRadius: 3,
                                fontSize: 10,
                              }}>
                                {p}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 输入框 */}
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="输入关于小说的问题..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onPressEnter={handleSend}
            disabled={sending}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            loading={sending}
          >
            发送
          </Button>
        </Space.Compact>
      </Card>

      {/* 右侧：小说列表 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ marginBottom: 16 }}>
          <Input.Search
            placeholder="搜索小说名或角色名"
            allowClear
            enterButton={<><SearchOutlined /> 搜索</>}
            size="large"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onSearch={handleSearch}
          />
        </div>

        <Spin spinning={loading}>
          <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 220px)' }}>
            {novels.length === 0 && !loading ? (
              <Empty description={searchQuery ? '未找到匹配的小说' : '知识库为空，请先导入小说'} />
            ) : (
              <Row gutter={[16, 16]}>
                {novels.map(novel => (
                  <Col key={novel.id} xs={24} sm={12} md={8}>
                    <Card
                      hoverable
                      onClick={() => navigate(`/novel/${novel.id}`)}
                      style={{ height: '100%', position: 'relative' }}
                      styles={{ body: { padding: 16 } }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 'bold', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <BookOutlined style={{ marginRight: 6, color: themeToken.colorPrimary }} />
                            {novel.name}
                          </div>
                        </div>
                        <Popconfirm
                          title={`确认删除「${novel.name}」？`}
                          description="将删除该小说的所有数据，此操作不可撤销。"
                          onConfirm={(e) => { e?.stopPropagation(); handleDelete(novel.id, novel.name); }}
                          onCancel={(e) => e?.stopPropagation()}
                          okText="确认删除"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                        >
                          <Button
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            size="small"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </Popconfirm>
                      </div>

                      <div style={{ marginBottom: 6 }}>
                        {getGraphStatusTag(novel)}
                      </div>

                      <div style={{ fontSize: 12, color: themeToken.colorTextSecondary }}>
                        <div>总字数：{formatChars(novel.totalChars)}</div>
                        {novel.buildStatus === 'completed' && (
                          <>
                            <div>角色数：{novel.characterCount ?? '-'}</div>
                            <div>关系数：{novel.relationCount ?? '-'}</div>
                            <div>Token：{novel.totalTokens?.toLocaleString() ?? '-'}</div>
                          </>
                        )}
                      </div>
                    </Card>
                  </Col>
                ))}
              </Row>
            )}
          </div>
        </Spin>
      </div>
    </div>
  );
};

export default Knowledge;
