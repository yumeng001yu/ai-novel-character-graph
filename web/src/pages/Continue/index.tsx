import React, { useState } from 'react';
import { Card, Upload, Input, Button, message, Descriptions, Alert } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { continueUpload, continuePaste, continueCheck } from '../../services/api';

const { TextArea } = Input;
const { Dragger } = Upload;

const Continue: React.FC = () => {
  const [novelId, setNovelId] = useState('');
  const [pasteContent, setPasteContent] = useState('');
  const [checkResult, setCheckResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleCheck = async () => {
    if (!novelId) return message.warning('请输入小说ID');
    const res = await continueCheck(novelId);
    setCheckResult(res.data);
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
    if (!novelId || !pasteContent) return message.warning('请填写小说ID和内容');
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
        <Input placeholder="输入小说ID" value={novelId} onChange={e => setNovelId(e.target.value)} style={{ width: 300, marginBottom: 16 }} />
        <Button type="primary" onClick={handleCheck} style={{ marginLeft: 8 }}>检查</Button>
      </Card>

      <Card title="上传续建文件" style={{ marginBottom: 24 }}>
        <Dragger accept=".txt" showUploadList={false} beforeUpload={(file) => { handleUpload(file); return false; }} disabled={!novelId || loading}>
          <p><InboxOutlined style={{ fontSize: 48, color: '#1890ff' }} /></p>
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
