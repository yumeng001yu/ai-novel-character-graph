import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Row, Col, Input, Tag, Popconfirm, Button, Empty, Spin, message, theme, Typography, Space, Select, Modal, Avatar, Tooltip } from 'antd';
import { SearchOutlined, DeleteOutlined, BookOutlined, SendOutlined, UserOutlined, RobotOutlined, MessageOutlined, TeamOutlined, BulbOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getKnowledgeBase, searchKnowledgeBase, deleteNovel, getNovelCharacters } from '../../services/api';

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

interface CharacterOption {
  id: string;
  name: string;
  aliases: string[];
  identity: string;
  faction: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  name?: string;
  content: string;
  sources?: any;
  loading?: boolean;
}

type SidebarMode = 'none' | 'qa' | 'modeling';
type ChatMode = 'chat' | 'group' | 'dialogue';

const Knowledge: React.FC = () => {
  const { token: themeToken } = theme.useToken();
  const navigate = useNavigate();
  const [novels, setNovels] = useState<NovelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // 侧边栏模式
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('none');

  // 问答相关
  const [qaMessages, setQaMessages] = useState<ChatMessage[]>([]);
  const [qaInput, setQaInput] = useState('');
  const [qaSending, setQaSending] = useState(false);
  const qaContainerRef = useRef<HTMLDivElement>(null);

  // 建模相关
  const [selectedNovelId, setSelectedNovelId] = useState<string>('');
  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>([]);
  const [chatMode, setChatMode] = useState<ChatMode>('chat');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [topicInput, setTopicInput] = useState('');
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // 自动滚动
  useEffect(() => {
    const ref = sidebarMode === 'qa' ? qaContainerRef : chatContainerRef;
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [qaMessages, chatMessages, sidebarMode]);

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
    if (!q) { loadNovels(); return; }
    setLoading(true);
    try {
      const res = await searchKnowledgeBase(q);
      setNovels(res.data?.novels || []);
    } catch (err) { message.error('搜索失败'); }
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

  // 加载角色列表
  const loadCharacters = async (novelId: string) => {
    try {
      const res = await getNovelCharacters(novelId);
      setCharacters(res.data || []);
    } catch (err) {
      message.error('加载角色列表失败');
      setCharacters([]);
    }
  };

  const handleNovelSelect = (novelId: string) => {
    setSelectedNovelId(novelId);
    setSelectedCharIds([]);
    setChatMessages([]);
    if (novelId) loadCharacters(novelId);
  };

  const handleAddCharacter = (charId: string) => {
    if (!selectedCharIds.includes(charId)) {
      setSelectedCharIds([...selectedCharIds, charId]);
    }
  };

  const handleRemoveCharacter = (charId: string) => {
    setSelectedCharIds(selectedCharIds.filter(id => id !== charId));
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

  // ===== 问答发送 =====
  const handleQaSend = async () => {
    const question = qaInput.trim();
    if (!question || qaSending) return;

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: question };
    const assistantMsg: ChatMessage = { id: `a-${Date.now()}`, role: 'assistant', content: '', loading: true };

    setQaMessages(prev => [...prev, userMsg, assistantMsg]);
    setQaInput('');
    setQaSending(true);

    try {
      const response = await fetch('/novelgraph/api/graphrag/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, stream: true }),
      });
      if (!response.ok) throw new Error(`请求失败: ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('浏览器不支持流式读取');

      const decoder = new TextDecoder();
      let fullContent = '';
      let sources: any;
      let sseBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const eventBlocks = sseBuffer.split('\n\n');
        sseBuffer = eventBlocks.pop() || '';

        for (const block of eventBlocks) {
          for (const line of block.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6).trim());
              if (data.type === 'delta' && data.delta) {
                fullContent += data.delta;
                setQaMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: fullContent, loading: false } : m));
              }
              if (data.type === 'done') {
                if (data.sources) sources = data.sources;
                setQaMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: fullContent, sources, loading: false } : m));
              }
              if (data.type === 'error') {
                setQaMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: data.error || '请求失败', loading: false } : m));
              }
            } catch {}
          }
        }
      }
    } catch {
      setQaMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: '请求失败', loading: false } : m));
    }
    setQaSending(false);
  };

  // ===== 角色对话发送 =====
  const handleChatSend = async () => {
    if (chatSending) return;

    if (chatMode === 'dialogue') {
      // 角色间对话模式
      const topic = topicInput.trim();
      if (!topic || selectedCharIds.length < 2) {
        message.warning('请输入话题并选择至少2个角色');
        return;
      }
      await sendCharacterChat(topic, 'dialogue');
      setTopicInput('');
    } else {
      // 用户-角色对话模式
      const msg = chatInput.trim();
      if (!msg) return;
      const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: msg };
      setChatMessages(prev => [...prev, userMsg]);
      setChatInput('');
      await sendCharacterChat(msg, chatMode);
    }
  };

  const sendCharacterChat = async (content: string, mode: ChatMode) => {
    setChatSending(true);

    const assistantMsg: ChatMessage = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: '',
      loading: true,
    };
    setChatMessages(prev => [...prev, assistantMsg]);

    try {
      const body: any = {
        characterIds: selectedCharIds,
        novelId: selectedNovelId,
        mode,
        history: chatMessages.filter(m => !m.loading).map(m => ({
          role: m.role,
          name: m.name,
          content: m.content,
        })),
      };
      if (mode === 'dialogue') body.topic = content;
      else body.message = content;

      const response = await fetch('/novelgraph/api/character-chat/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`请求失败: ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('浏览器不支持流式读取');

      const decoder = new TextDecoder();
      let fullContent = '';
      let sseBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const eventBlocks = sseBuffer.split('\n\n');
        sseBuffer = eventBlocks.pop() || '';

        for (const block of eventBlocks) {
          for (const line of block.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6).trim());
              if (data.type === 'delta') {
                fullContent += data.delta || '';
                setChatMessages(prev => prev.map(m =>
                  m.id === assistantMsg.id ? { ...m, content: fullContent, loading: false, name: data.name } : m
                ));
              }
              if (data.type === 'done') {
                setChatMessages(prev => prev.map(m =>
                  m.id === assistantMsg.id ? { ...m, content: fullContent || '无回复', loading: false } : m
                ));
              }
              if (data.type === 'error') {
                setChatMessages(prev => prev.map(m =>
                  m.id === assistantMsg.id ? { ...m, content: data.error || '请求失败', loading: false } : m
                ));
              }
            } catch {}
          }
        }
      }
    } catch {
      setChatMessages(prev => prev.map(m =>
        m.id === assistantMsg.id ? { ...m, content: '请求失败', loading: false } : m
      ));
    }
    setChatSending(false);
  };

  // 已完成构建的小说
  const completedNovels = novels.filter(n => n.buildStatus === 'completed');

  // ===== 渲染聊天消息 =====
  const renderMessages = (messages: ChatMessage[], containerRef: React.RefObject<HTMLDivElement | null>) => (
    <div ref={containerRef} style={{
      flex: 1, overflowY: 'auto', padding: 12,
      background: themeToken.colorBgContainer, borderRadius: 8,
      border: `1px solid ${themeToken.colorBorder}`, marginBottom: 12,
    }}>
      {messages.length === 0 ? (
        <Empty description="开始对话吧" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        messages.map(msg => (
          <div key={msg.id} style={{
            display: 'flex',
            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            marginBottom: 12,
          }}>
            <div style={{ maxWidth: '85%', display: 'flex', gap: 8, flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
              <Tooltip title={msg.name || (msg.role === 'user' ? '你' : 'AI')}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: msg.role === 'user' ? themeToken.colorPrimary : themeToken.colorSuccess,
                  color: '#fff', flexShrink: 0, fontSize: 12,
                }}>
                  {msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                </div>
              </Tooltip>
              <div>
                {msg.name && <div style={{ fontSize: 11, color: themeToken.colorTextSecondary, marginBottom: 2 }}>{msg.name}</div>}
                <div style={{
                  padding: '8px 12px',
                  borderRadius: msg.role === 'user' ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
                  background: msg.role === 'user' ? themeToken.colorPrimaryBg : themeToken.colorBgLayout,
                  border: `1px solid ${msg.role === 'user' ? themeToken.colorPrimaryBorder : themeToken.colorBorder}`,
                  fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                }}>
                  {msg.loading ? <Spin size="small" /> : msg.content}
                </div>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)' }}>
      {/* 左侧侧边栏 */}
      <div style={{
        width: 64, flexShrink: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '16px 0', gap: 8,
        background: themeToken.colorBgContainer,
        borderRight: `1px solid ${themeToken.colorBorder}`,
        borderRadius: '8px 0 0 8px',
      }}>
        <Tooltip title="知识库问答" placement="right">
          <Button
            type={sidebarMode === 'qa' ? 'primary' : 'text'}
            icon={<MessageOutlined />}
            size="large"
            onClick={() => setSidebarMode(sidebarMode === 'qa' ? 'none' : 'qa')}
          />
        </Tooltip>
        <Tooltip title="角色建模" placement="right">
          <Button
            type={sidebarMode === 'modeling' ? 'primary' : 'text'}
            icon={<TeamOutlined />}
            size="large"
            onClick={() => setSidebarMode(sidebarMode === 'modeling' ? 'none' : 'modeling')}
          />
        </Tooltip>
      </div>

      {/* 侧边栏内容区 */}
      {sidebarMode !== 'none' && (
        <div style={{
          width: 420, flexShrink: 0,
          display: 'flex', flexDirection: 'column',
          borderRight: `1px solid ${themeToken.colorBorder}`,
          padding: 12,
          overflow: 'hidden',
        }}>
          {sidebarMode === 'qa' && (
            <>
              <div style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <MessageOutlined /> 知识库问答
              </div>
              {renderMessages(qaMessages, qaContainerRef)}
              <Space.Compact style={{ width: '100%' }}>
                <Input placeholder="输入关于小说的问题..." value={qaInput}
                  onChange={e => setQaInput(e.target.value)} onPressEnter={handleQaSend} disabled={qaSending} />
                <Button type="primary" icon={<SendOutlined />} onClick={handleQaSend} loading={qaSending}>发送</Button>
              </Space.Compact>
            </>
          )}

          {sidebarMode === 'modeling' && (
            <>
              <div style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <TeamOutlined /> 角色建模
              </div>

              {/* 选择小说 */}
              <Select
                placeholder="选择小说（需已构建图谱）"
                style={{ width: '100%', marginBottom: 8 }}
                value={selectedNovelId || undefined}
                onChange={handleNovelSelect}
                options={completedNovels.map(n => ({ label: n.name, value: n.id }))}
              />

              {/* 选择对话模式 */}
              <Select
                style={{ width: '100%', marginBottom: 8 }}
                value={chatMode}
                onChange={setChatMode}
                options={[
                  { label: '单角色对话', value: 'chat' },
                  { label: '多角色群聊', value: 'group' },
                  { label: '角色间对话', value: 'dialogue' },
                ]}
              />

              {/* 已选角色标签 */}
              {selectedCharIds.length > 0 && (
                <div style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {selectedCharIds.map(id => {
                    const ch = characters.find(c => c.id === id);
                    return ch ? (
                      <Tag key={id} closable onClose={() => handleRemoveCharacter(id)} color="blue">
                        {ch.name}
                      </Tag>
                    ) : null;
                  })}
                </div>
              )}

              {/* 添加角色 */}
              {selectedNovelId && characters.length > 0 && (
                <Select
                  placeholder="添加角色..."
                  style={{ width: '100%', marginBottom: 8 }}
                  value={undefined}
                  onChange={handleAddCharacter}
                  options={characters
                    .filter(c => !selectedCharIds.includes(c.id))
                    .map(c => ({ label: `${c.name}${c.identity ? ` (${c.identity})` : ''}`, value: c.id }))}
                />
              )}

              {/* 对话区域 */}
              {renderMessages(chatMessages, chatContainerRef)}

              {/* 输入区域 */}
              {chatMode === 'dialogue' ? (
                <Space.Compact style={{ width: '100%' }}>
                  <Input placeholder="输入话题，角色将围绕此话题讨论..." value={topicInput}
                    onChange={e => setTopicInput(e.target.value)}
                    onPressEnter={() => handleChatSend()}
                    disabled={chatSending || selectedCharIds.length < 2} />
                  <Button type="primary" icon={<BulbOutlined />} onClick={() => handleChatSend()}
                    loading={chatSending} disabled={selectedCharIds.length < 2}>开始讨论</Button>
                </Space.Compact>
              ) : (
                <Space.Compact style={{ width: '100%' }}>
                  <Input placeholder={`对${selectedCharIds.length > 1 ? '多个角色' : '角色'}说话...`}
                    value={chatInput} onChange={e => setChatInput(e.target.value)}
                    onPressEnter={handleChatSend} disabled={chatSending || selectedCharIds.length === 0} />
                  <Button type="primary" icon={<SendOutlined />} onClick={handleChatSend}
                    loading={chatSending} disabled={selectedCharIds.length === 0}>发送</Button>
                </Space.Compact>
              )}
            </>
          )}
        </div>
      )}

      {/* 右侧：小说列表 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0 16px' }}>
        <div style={{ marginBottom: 16 }}>
          <Input.Search
            placeholder="搜索小说名或角色名"
            allowClear enterButton={<><SearchOutlined /> 搜索</>}
            size="large" value={searchQuery}
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
                    <Card hoverable onClick={() => navigate(`/novel/${novel.id}`)}
                      style={{ height: '100%', position: 'relative' }}
                      styles={{ body: { padding: 16 } }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 'bold', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <BookOutlined style={{ marginRight: 6, color: themeToken.colorPrimary }} />
                            {novel.name}
                          </div>
                        </div>
                        <Popconfirm title={`确认删除「${novel.name}」？`} description="将删除该小说的所有数据，此操作不可撤销。"
                          onConfirm={(e) => { e?.stopPropagation(); handleDelete(novel.id, novel.name); }}
                          onCancel={(e) => e?.stopPropagation()}
                          okText="确认删除" cancelText="取消" okButtonProps={{ danger: true }}>
                          <Button type="text" danger icon={<DeleteOutlined />} size="small" onClick={(e) => e.stopPropagation()} />
                        </Popconfirm>
                      </div>
                      <div style={{ marginBottom: 6 }}>{getGraphStatusTag(novel)}</div>
                      <div style={{ fontSize: 12, color: themeToken.colorTextSecondary }}>
                        <div>总字数：{formatChars(novel.totalChars)}</div>
                        {novel.buildStatus === 'completed' && (
                          <>
                            <div>角色数：{novel.characterCount ?? '-'}</div>
                            <div>关系数：{novel.relationCount ?? '-'}</div>
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
