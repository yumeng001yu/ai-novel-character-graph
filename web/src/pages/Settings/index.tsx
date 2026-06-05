import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, Select, InputNumber, Switch, message, Space, Alert, Divider, Tag } from 'antd';
import { getAiConfig, saveAiConfig, testAiConnection, getModels, getBuildConfig, saveBuildConfig } from '../../services/api';

const Settings: React.FC = () => {
  const [aiForm] = Form.useForm();
  const [buildForm] = Form.useForm();
  const [models, setModels] = useState<any[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    loadAiConfig();
    loadBuildConfig();
  }, []);

  const loadAiConfig = async () => {
    const res = await getAiConfig();
    if (res.data.configured === false) {
      setConfigured(false);
      return;
    }
    setConfigured(true);
    aiForm.setFieldsValue(res.data);
  };

  const loadBuildConfig = async () => {
    const res = await getBuildConfig();
    buildForm.setFieldsValue(res.data);
  };

  const handleGetModels = async () => {
    const values = await aiForm.validateFields(['apiUrl', 'apiKey']);
    setLoadingModels(true);
    try {
      const res = await getModels(values.apiUrl, values.apiKey);
      setModels(res.data.models);
      message.success(`发现 ${res.data.models.length} 个模型`);
    } catch (err: any) {
      message.error('获取模型列表失败');
    }
    setLoadingModels(false);
  };

  const handleTest = async () => {
    const values = await aiForm.validateFields(['apiUrl', 'apiKey']);
    const res = await testAiConnection(values.apiUrl, values.apiKey);
    setTestResult(res.data);
  };

  const handleSaveAi = async () => {
    const values = await aiForm.validateFields();
    await saveAiConfig(values);
    message.success('AI 配置已保存');
    setConfigured(true);
  };

  const handleSaveBuild = async () => {
    const values = await buildForm.getFieldsValue();
    await saveBuildConfig(values);
    message.success('构建配置已保存');
  };

  return (
    <div>
      <Card title="AI 模型配置" style={{ marginBottom: 24 }}
        extra={configured ? <Tag color="green">已配置</Tag> : <Tag color="red">未配置</Tag>}>
        {!configured && <Alert type="warning" message="请先配置 AI 模型，否则无法构建图谱" style={{ marginBottom: 16 }} />}
        <Form form={aiForm} layout="vertical">
          <Form.Item label="API 地址" name="apiUrl" rules={[{ required: true, message: '请输入API地址' }]}>
            <Input placeholder="如 https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item label="API Key" name="apiKey" rules={[{ required: true, message: '请输入API Key' }]}>
            <Input.Password placeholder="sk-..." />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button onClick={handleGetModels} loading={loadingModels}>获取模型列表</Button>
              <Button onClick={handleTest}>测试连接</Button>
            </Space>
            {testResult && (
              <Alert type={testResult.success ? 'success' : 'error'} message={testResult.message} style={{ marginTop: 8 }} />
            )}
          </Form.Item>
          <Form.Item label="选择模型" name="model" rules={[{ required: true }]}>
            <Select placeholder="先获取模型列表" options={models.map(m => ({
              label: <span>{m.name} {m.tags.map((t: string) => <Tag key={t} color="blue">{t}</Tag>)}</span>,
              value: m.id,
            }))} />
          </Form.Item>
          <Form.Item label="模型上下文大小（Token）" name="contextSize" tooltip="不填默认200000">
            <InputNumber min={1000} max={1000000} placeholder="200000" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="Temperature" name="temperature">
            <InputNumber min={0} max={2} step={0.1} placeholder="0.3" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="Max Tokens" name="maxTokens">
            <InputNumber min={1} max={128000} placeholder="4096" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" onClick={handleSaveAi}>保存 AI 配置</Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title="构建配置">
        <Form form={buildForm} layout="vertical">
          <Form.Item label="AI 调用重试次数" name="maxRetries">
            <InputNumber min={0} max={10} placeholder="3" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="显示成本预估" name="showCostEstimate" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="最大并发AI调用数" name="maxConcurrentAiCalls">
            <InputNumber min={1} max={10} placeholder="3" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="启用推断" name="enableInference" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item>
            <Button type="primary" onClick={handleSaveBuild}>保存构建配置</Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default Settings;
