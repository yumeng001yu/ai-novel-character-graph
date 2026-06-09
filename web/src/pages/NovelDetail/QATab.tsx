import React, { useState, useRef, useEffect } from 'react';
import { Input, Button, Space, Spin, Empty, Tag, theme, Typography } from 'antd';
import { SendOutlined, UserOutlined, RobotOutlined } from '@ant-design/icons';

const { Paragraph } = Typography;

interface Props {
  novelId: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: {
    characters?: string[];
    passages?: string[];
  };
  loading?: boolean;
}

const QATab: React.FC<Props> = ({ novelId }) => {
  const { token: themeToken } = theme.useToken();
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
      // 使用 POST 请求 + 流式读取
      const response = await fetch('/novelgraph/api/graphrag/' + novelId + '/query', {
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
      let sseBuffer = ''; // 缓冲区，处理跨 chunk 边界的 SSE 事件

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        // 按双换行分割完整的 SSE 事件
        const eventBlocks = sseBuffer.split('\n\n');
        // 最后一个可能是不完整的事件，保留在缓冲区
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
                      .map((s: any) => s.name),
                    passages: data.sources
                      .filter((s: any) => s.type === 'text_chunk')
                      .map((s: any) => `[第${s.stepNumber}步 ${s.chapterRange}]`),
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

      // 确保最终状态更新
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id
          ? { ...m, content: fullContent || '无回答', sources, loading: false }
          : m
      ));
    } catch (err: any) {
      // 流式请求失败，回退到普通 POST
      await fallbackPostRequest(novelId, question, assistantMsg);
      return; // fallbackPostRequest 内部已调用 setSending(false)
    }
    setSending(false);
  };

  const fallbackPostRequest = async (nid: string, question: string, assistantMsg: ChatMessage) => {
    try {
      const api = (await import('../../services/api')).default;
      const res = await api.post(`/graphrag/${nid}/query`, { question });
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '70vh' }}>
      {/* 消息列表 */}
      <div
        ref={chatContainerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
          background: themeToken.colorBgContainer,
          borderRadius: 8,
          border: `1px solid ${themeToken.colorBorder}`,
          marginBottom: 16,
        }}
      >
        {messages.length === 0 ? (
          <Empty description="输入问题，AI 将基于小说知识图谱回答" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          messages.map(msg => (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                marginBottom: 16,
              }}
            >
              <div style={{
                maxWidth: '70%',
                display: 'flex',
                gap: 8,
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
              }}>
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: msg.role === 'user' ? themeToken.colorPrimary : themeToken.colorSuccess,
                  color: '#fff',
                  flexShrink: 0,
                }}>
                  {msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                </div>
                <div>
                  <div style={{
                    padding: '10px 14px',
                    borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                    background: msg.role === 'user' ? themeToken.colorPrimaryBg : themeToken.colorBgLayout,
                    border: `1px solid ${msg.role === 'user' ? themeToken.colorPrimaryBorder : themeToken.colorBorder}`,
                    fontSize: 14,
                    lineHeight: 1.6,
                  }}>
                    {msg.loading ? (
                      <Spin size="small" />
                    ) : (
                      <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                        {msg.content}
                      </Paragraph>
                    )}
                  </div>
                  {msg.sources && (
                    <div style={{ marginTop: 6, fontSize: 12, color: themeToken.colorTextSecondary }}>
                      {msg.sources.characters && msg.sources.characters.length > 0 && (
                        <div>
                          相关角色：{msg.sources.characters.map(c => <Tag key={c} color="blue" style={{ fontSize: 11 }}>{c}</Tag>)}
                        </div>
                      )}
                      {msg.sources.passages && msg.sources.passages.length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          相关原文：
                          {msg.sources.passages.map((p, i) => (
                            <div key={i} style={{
                              marginTop: 4,
                              padding: '4px 8px',
                              background: themeToken.colorFillQuaternary,
                              borderRadius: 4,
                              fontSize: 12,
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
          size="large"
          placeholder="输入关于小说的问题..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onPressEnter={handleSend}
          disabled={sending}
        />
        <Button
          type="primary"
          size="large"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={sending}
        >
          发送
        </Button>
      </Space.Compact>
    </div>
  );
};

export default QATab;
