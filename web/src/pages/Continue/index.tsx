import React, { useState, useEffect } from 'react';
import { Card, Upload, Input, Button, message, Alert, Select, Space, theme } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { continueUpload, continuePaste, continueCheck, getNovels } from '../../services/api';

const { TextArea } = Input;
const { Dragger } = Upload;

const Continue: React.FC = () => {
  const { token: themeToken } = theme.useToken();
  const [novels, setNovels] = useState<any[]>([]);
  const [novelId, setNovelId] = useState<string>('');
  const [pasteContent, setPasteContent] = useState('');
  const [checkResult, setCheckResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadNovels();
  }, []);

  const loadNovels = async () => {
    try {
      const res = await getNovels();
      setNovels(res.data?.novels || res.data || []);
    } catch (err) {
      message.error('加载小说列表失败');
    }
  };

  const handleCheck = async () => {
    if (!novelId) return message.warning('请选择小说');
    try {
      const res = await continueCheck(novelId);
      setCheckResult(res.data);
    } catch (err: any) {
      message.error(err.response?.data?.error || '检查失败');
    }
  };

  const handleUpload = async (file: File) => {
    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await continueUpload(novelId, formData);
      message.success('续建分析完成');
      setCheckResult(res.data);
    } catch (err: any) {
      message.error(err.response?.data?.error || '上传失败');
    }
    setLoading(false);
    return false;
  };

  const handlePaste = async () => {
    if (!novelId || !pasteContent) return message.warning('请选择小说并输入内容');
    setLoading(true);
    try {
      const res = await continuePaste(novelId, pasteContent);
      message.success('续建分析完成');
      setCheckResult(res.data);
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    }
    setLoading(false);
  };

  return (
    <div>
      <Card title="继承续建" style={{ marginBottom: 24 }}>
        <Space>
          <Select style={{ width: 250 }} placeholder="选择小说" value={novelId || undefined}
            onChange={setNovelId}
            options={novels.map((n: any) => ({ label: n.name, value: n.id }))} />
          <Button type="primary" onClick={handleCheck} disabled={!novelId}>检查</Button>
        </Space>
      </Card>

      <Card title="上传续建文件" style={{ marginBottom: 24 }}>
        <Dragger accept=".txt" showUploadList={false} beforeUpload={(file) => { handleUpload(file); return false; }} disabled={!novelId || loading}>
          <p><InboxOutlined style={{ fontSize: 48, color: themeToken.colorPrimary }} /></p>
          <p>拖拽或点击上传续建文件</p>
        </Dragger>
      </Card>

      <Card title="粘贴续建文本">
        <TextArea rows={6} placeholder="粘贴续建文本" value={pasteContent} onChange={e => setPasteContent(e.target.value)} />
        <Button type="primary" onClick={handlePaste} loading={loading} style={{ marginTop: 12 }}>提交</Button>
      </Card>

      {checkResult && (
        <Card title="重复检测结果" style={{ marginTop: 24 }}>
          {checkResult.matchRatio > 0 ? (
            <Alert type="info" message={`检测到 ${(checkResult.matchRatio * 100).toFixed(1)}% 的重复内容`} description={`重复结束位置：第 ${checkResult.duplicateEndOffset} 字符，新内容从此处开始`} />
          ) : (
            <Alert type="success" message="未检测到重复内容，将作为全新内容续建" />
          )}
        </Card>
      )}
    </div>
  );
};

export default Continue;
