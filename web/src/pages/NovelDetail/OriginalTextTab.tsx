import React, { useState, useEffect } from 'react';
import { Select, Spin, Empty, message, theme, Typography } from 'antd';
import { getNovelText, getNovelChapters } from '../../services/api';

const { Paragraph } = Typography;

interface Props {
  novelId: string;
}

const OriginalTextTab: React.FC<Props> = ({ novelId }) => {
  const { token: themeToken } = theme.useToken();
  const [chapters, setChapters] = useState<any[]>([]);
  const [selectedChapter, setSelectedChapter] = useState<number | undefined>();
  const [text, setText] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    loadChapters();
  }, [novelId]);

  const loadChapters = async () => {
    try {
      const res = await getNovelChapters(novelId);
      const list = res.data || [];
      setChapters(list);
      if (list.length > 0) {
        setSelectedChapter(list[0].index ?? list[0].chapter ?? 1);
      }
    } catch (err: any) {
      if (err.response?.status === 404) {
        setSupported(false);
      } else {
        // 尝试直接加载全文
        loadText();
      }
    }
  };

  const loadText = async (chapter?: number) => {
    setLoading(true);
    try {
      const params: any = {};
      if (chapter !== undefined) params.chapter = chapter;
      const res = await getNovelText(novelId);
      setText(res.data?.text || res.data?.content || (typeof res.data === 'string' ? res.data : ''));
    } catch (err: any) {
      if (err.response?.status === 404) {
        setSupported(false);
      } else {
        message.error('加载原文失败');
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    if (selectedChapter !== undefined) {
      loadText(selectedChapter);
    }
  }, [selectedChapter]);

  if (!supported) {
    return <Empty description="原文查看需要后端支持" />;
  }

  return (
    <div>
      {chapters.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Select
            style={{ width: 300 }}
            placeholder="选择章节"
            value={selectedChapter}
            onChange={setSelectedChapter}
            options={chapters.map((c: any) => ({
              label: c.title || c.name || `第${c.index ?? c.chapter}章`,
              value: c.index ?? c.chapter,
            }))}
          />
        </div>
      )}
      <Spin spinning={loading}>
        {text ? (
          <div style={{
            background: themeToken.colorBgContainer,
            padding: 24,
            borderRadius: 8,
            border: `1px solid ${themeToken.colorBorder}`,
            maxHeight: '70vh',
            overflowY: 'auto',
          }}>
            <Paragraph style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, fontSize: 15 }}>
              {text}
            </Paragraph>
          </div>
        ) : (
          <Empty description="暂无原文内容" />
        )}
      </Spin>
    </div>
  );
};

export default OriginalTextTab;
