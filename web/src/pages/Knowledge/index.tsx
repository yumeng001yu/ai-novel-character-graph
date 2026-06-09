import React, { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Input, Tag, Popconfirm, Button, Empty, Spin, message, theme } from 'antd';
import { SearchOutlined, DeleteOutlined, BookOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getKnowledgeBase, searchKnowledgeBase, deleteNovel } from '../../services/api';

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

const Knowledge: React.FC = () => {
  const { token: themeToken } = theme.useToken();
  const navigate = useNavigate();
  const [novels, setNovels] = useState<NovelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

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

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
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
        {novels.length === 0 && !loading ? (
          <Empty description={searchQuery ? '未找到匹配的小说' : '知识库为空，请先导入小说'} />
        ) : (
          <Row gutter={[16, 16]}>
            {novels.map(novel => (
              <Col key={novel.id} xs={24} sm={12} md={8} lg={6}>
                <Card
                  hoverable
                  onClick={() => navigate(`/novel/${novel.id}`)}
                  style={{ height: '100%', position: 'relative' }}
                  styles={{ body: { padding: 20 } }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

                  <div style={{ marginBottom: 8 }}>
                    {getGraphStatusTag(novel)}
                  </div>

                  <div style={{ fontSize: 13, color: themeToken.colorTextSecondary }}>
                    <div>总字数：{formatChars(novel.totalChars)}</div>
                    {novel.buildStatus === 'completed' && (
                      <>
                        <div>角色数：{novel.characterCount ?? '-'}</div>
                        <div>关系数：{novel.relationCount ?? '-'}</div>
                        <div>Token 用量：{novel.totalTokens?.toLocaleString() ?? '-'}</div>
                      </>
                    )}
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Spin>
    </div>
  );
};

export default Knowledge;
