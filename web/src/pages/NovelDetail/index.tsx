import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Tabs, Card, Spin, message, Button, theme } from 'antd';
import { ArrowLeftOutlined, FileTextOutlined, ApartmentOutlined, UserOutlined, MessageOutlined } from '@ant-design/icons';
import { getNovelDetail } from '../../services/api';
import OriginalTextTab from './OriginalTextTab';
import GraphTab from './GraphTab';
import CharacterTab from './CharacterTab';
import QATab from './QATab';

const NovelDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token: themeToken } = theme.useToken();
  const [novel, setNovel] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const loadNovel = async () => {
      setLoading(true);
      try {
        const res = await getNovelDetail(id);
        setNovel(res.data);
      } catch (err) {
        message.error('加载小说信息失败');
      }
      setLoading(false);
    };
    loadNovel();
  }, [id]);

  if (loading) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  const tabItems = [
    {
      key: 'text',
      label: <span><FileTextOutlined /> 原文</span>,
      children: <OriginalTextTab novelId={id!} />,
    },
    {
      key: 'graph',
      label: <span><ApartmentOutlined /> 图谱</span>,
      children: <GraphTab novelId={id!} />,
    },
    {
      key: 'character',
      label: <span><UserOutlined /> 角色</span>,
      children: <CharacterTab novelId={id!} />,
    },
    {
      key: 'qa',
      label: <span><MessageOutlined /> 问答</span>,
      children: <QATab novelId={id!} />,
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/knowledge')}
        >
          返回知识库
        </Button>
        <span style={{ fontSize: 18, fontWeight: 'bold', color: themeToken.colorText }}>
          {novel?.name || '小说详情'}
        </span>
      </div>
      <Card>
        <Tabs defaultActiveKey="graph" items={tabItems} />
      </Card>
    </div>
  );
};

export default NovelDetail;
