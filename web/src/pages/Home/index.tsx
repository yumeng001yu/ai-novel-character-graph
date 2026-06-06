import React, { useState, useEffect } from 'react';
import { Card, Upload, Button, Input, Radio, Table, message, Modal } from 'antd';
import { InboxOutlined, FileTextOutlined } from '@ant-design/icons';
import { uploadNovel, textPaste, getNovels } from '../../services/api';

const { TextArea } = Input;
const { Dragger } = Upload;

const Home: React.FC = () => {
  const [novels, setNovels] = useState<any[]>([]);
  const [hasChapter, setHasChapter] = useState(true);
  const [pasteVisible, setPasteVisible] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [pasteName, setPasteName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadNovels(); }, []);

  const loadNovels = async () => {
    try {
      const res = await getNovels();
      setNovels(res.data || []);
    } catch (err) {
      message.error('加载小说列表失败');
    }
  };

  const handleUpload = async (file: File) => {
    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await uploadNovel(formData, hasChapter);
      message.success(`上传成功！识别到 ${res.data.chapters} 章，分为 ${res.data.steps} 步`);
      loadNovels();
    } catch (err: any) {
      message.error(err.response?.data?.error || '上传失败');
    }
    setLoading(false);
    return false;
  };

  const handlePaste = async () => {
    if (!pasteContent.trim()) return message.warning('请输入内容');
    setLoading(true);
    try {
      await textPaste({ content: pasteContent, novelName: pasteName });
      message.success(`创建成功！`);
      setPasteVisible(false);
      loadNovels();
    } catch (err: any) {
      message.error(err.response?.data?.error || '创建失败');
    }
    setLoading(false);
  };

  const columns = [
    { title: '小说名', dataIndex: 'name', key: 'name' },
    { title: '字数', dataIndex: 'totalChars', key: 'totalChars' },
    { title: 'Token数', dataIndex: 'totalTokens', key: 'totalTokens' },
    { title: '输入模式', dataIndex: 'inputMode', key: 'inputMode', render: (v: string) => ({
      file_chapter: '有章节TXT', file_no_chapter: '无章节TXT', text_paste: '文本粘贴'
    }[v] || v) },
    { title: '当前步', dataIndex: 'currentStep', key: 'currentStep' },
    { title: '总步数', dataIndex: 'totalSteps', key: 'totalSteps' },
  ];

  return (
    <div>
      <Card title="上传小说" style={{ marginBottom: 24 }}>
        <Radio.Group value={hasChapter} onChange={e => setHasChapter(e.target.value)} style={{ marginBottom: 16 }}>
          <Radio.Button value={true}>有章节 TXT</Radio.Button>
          <Radio.Button value={false}>无章节 TXT</Radio.Button>
        </Radio.Group>
        <Dragger
          accept=".txt"
          showUploadList={false}
          beforeUpload={(file) => { handleUpload(file); return false; }}
          disabled={loading}
        >
          <p><InboxOutlined style={{ fontSize: 48, color: '#1890ff' }} /></p>
          <p>点击或拖拽 TXT 文件到此处上传</p>
        </Dragger>
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Button type="link" onClick={() => setPasteVisible(true)}>
            <FileTextOutlined /> 或直接粘贴文本
          </Button>
        </div>
      </Card>

      <Card title="小说列表">
        <Table columns={columns} dataSource={novels} rowKey="id" />
      </Card>

      <Modal title="文本粘贴" open={pasteVisible} onOk={handlePaste} onCancel={() => setPasteVisible(false)} confirmLoading={loading}>
        <Input placeholder="小说名称（可选）" value={pasteName} onChange={e => setPasteName(e.target.value)} style={{ marginBottom: 12 }} />
        <TextArea rows={10} placeholder="粘贴小说文本（不超过5万字）" value={pasteContent} onChange={e => setPasteContent(e.target.value)} />
      </Modal>
    </div>
  );
};

export default Home;
