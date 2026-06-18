import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, Select, InputNumber, Switch, message, Space, Alert, Tag } from 'antd';
import { getAiConfig, saveAiConfig, testAiConnection, getModels, getBuildConfig, saveBuildConfig, getEmbeddingConfig, saveEmbeddingConfig, testEmbeddingConnection, getEmbeddingModels, getRerankerConfig, saveRerankerConfig, testRerankerConnection } from '../../services/api';
import PromptPresetSettings from './PromptPresetSettings';

const Settings: React.FC = () => {
  const [aiForm] = Form.useForm();
  const [buildForm] = Form.useForm();
  const [models, setModels] = useState<any[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [configured, setConfigured] = useState(false);
  const [embForm] = Form.useForm();
  const [rerankerForm] = Form.useForm();
  const [embModels, setEmbModels] = useState<any[]>([]);
  const [loadingEmbModels, setLoadingEmbModels] = useState(false);
  const [embTestResult, setEmbTestResult] = useState<any>(null);
  const [embConfigured, setEmbConfigured] = useState(false);
  const [rerankerTestResult, setRerankerTestResult] = useState<any>(null);
  const [rerankerConfigured, setRerankerConfigured] = useState(false);

  useEffect(() => {
    loadAiConfig();
    loadBuildConfig();
    loadEmbeddingConfig();
    loadRerankerConfig();
  }, []);

  const loadAiConfig = async () => {
    try {
      const res = await getAiConfig();
      const config = res.data?.settings || res.data;
      if (config?.configured === false) {
        setConfigured(false);
        return;
      }
      setConfigured(true);
      aiForm.setFieldsValue({
        apiUrl: config.apiUrl,
        model: config.model,
        contextSize: config.contextSize,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      });
    } catch (err) {
      message.error('加载AI配置失败');
    }
  };

  const loadBuildConfig = async () => {
    try {
      const res = await getBuildConfig();
      const config = res.data?.settings || res.data;
      buildForm.setFieldsValue(config);
    } catch (err) {
      message.error('加载构建配置失败');
    }
  };

  const loadEmbeddingConfig = async () => {
    try {
      const res = await getEmbeddingConfig();
      const config = res.data?.settings || res.data;
      if (config?.configured === false) {
        setEmbConfigured(false);
        return;
      }
      setEmbConfigured(true);
      embForm.setFieldsValue({
        apiUrl: config.apiUrl,
        model: config.model,
        dimensions: config.dimensions,
      });
    } catch (err) {
      // ignore
    }
  };

  const loadRerankerConfig = async () => {
    try {
      const res = await getRerankerConfig();
      const config = res.data?.settings || res.data;
      if (config?.configured === false) {
        setRerankerConfigured(false);
        return;
      }
      setRerankerConfigured(true);
      rerankerForm.setFieldsValue({
        apiUrl: config.apiUrl,
        model: config.model,
      });
    } catch (err) {
      // ignore
    }
  };

  const handleGetModels = async () => {
    try {
      const values = await aiForm.validateFields(['apiUrl', 'apiKey']);
      setLoadingModels(true);
      try {
        const res = await getModels(values.apiUrl, values.apiKey);
        setModels(res.data.models || []);
        message.success(`发现 ${(res.data.models || []).length} 个模型`);
      } catch (err: any) {
        message.error('获取模型列表失败: ' + (err.response?.data?.error || err.message));
      }
      setLoadingModels(false);
    } catch (err) {
      // 表单验证失败
    }
  };

  const handleTest = async () => {
    try {
      const values = await aiForm.validateFields(['apiUrl', 'apiKey']);
      try {
        const res = await testAiConnection(values.apiUrl, values.apiKey);
        setTestResult(res.data);
      } catch (err: any) {
        setTestResult({ success: false, message: '连接失败: ' + (err.response?.data?.error || err.message) });
      }
    } catch (err) {
      // 表单验证失败
    }
  };

  const handleSaveAi = async () => {
    try {
      const values = await aiForm.validateFields();
      await saveAiConfig(values);
      message.success('AI 配置已保存');
      setConfigured(true);
    } catch (err: any) {
      if (err.response?.data?.error) {
        message.error(err.response.data.error);
      }
    }
  };

  const handleSaveBuild = async () => {
    try {
      const values = await buildForm.getFieldsValue();
      await saveBuildConfig(values);
      message.success('构建配置已保存');
    } catch (err: any) {
      message.error('保存构建配置失败');
    }
  };

  const handleGetEmbModels = async () => {
    try {
      const values = await embForm.validateFields(['apiUrl', 'apiKey']);
      setLoadingEmbModels(true);
      try {
        const res = await getEmbeddingModels(values.apiUrl, values.apiKey);
        setEmbModels(res.data.models || []);
        message.success(`发现 ${(res.data.models || []).length} 个 Embedding 模型`);
      } catch (err: any) {
        message.error('获取模型列表失败: ' + (err.response?.data?.error || err.message));
      }
      setLoadingEmbModels(false);
    } catch (err) {
      // form validation failed
    }
  };

  const handleTestEmbedding = async () => {
    try {
      const values = await embForm.validateFields(['apiUrl', 'apiKey', 'model']);
      try {
        const res = await testEmbeddingConnection(values.apiUrl, values.apiKey, values.model);
        setEmbTestResult(res.data);
        if (res.data.dimensions) {
          embForm.setFieldsValue({ dimensions: res.data.dimensions });
        }
      } catch (err: any) {
        setEmbTestResult({ success: false, message: '连接失败: ' + (err.response?.data?.error || err.message) });
      }
    } catch (err) {
      // form validation failed
    }
  };

  const handleSaveEmbedding = async () => {
    try {
      const values = await embForm.validateFields();
      await saveEmbeddingConfig(values);
      message.success('Embedding 配置已保存');
      setEmbConfigured(true);
    } catch (err: any) {
      if (err.response?.data?.error) message.error(err.response.data.error);
    }
  };

  const handleTestReranker = async () => {
    try {
      const values = await rerankerForm.validateFields(['apiUrl', 'apiKey', 'model']);
      try {
        const res = await testRerankerConnection(values.apiUrl, values.apiKey, values.model);
        setRerankerTestResult(res.data);
      } catch (err: any) {
        setRerankerTestResult({ success: false, message: '连接失败: ' + (err.response?.data?.error || err.message) });
      }
    } catch (err) {
      // form validation failed
    }
  };

  const handleSaveReranker = async () => {
    try {
      const values = await rerankerForm.validateFields();
      await saveRerankerConfig(values);
      message.success('Reranker 配置已保存');
      setRerankerConfigured(true);
    } catch (err: any) {
      if (err.response?.data?.error) message.error(err.response.data.error);
    }
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
          <Form.Item label="API Key" name="apiKey" rules={[{ required: !configured, message: '请输入API Key' }]}>
            <Input.Password placeholder={configured ? '留空则保持原有Key' : 'sk-...'} />
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
              label: <span>{m.name} {m.tags?.map((t: string) => <Tag key={t} color="blue">{t}</Tag>)}</span>,
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

      <PromptPresetSettings />

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

      <Card title="Embedding 模型配置（可选）" style={{ marginBottom: 24 }}
        extra={embConfigured ? <Tag color="green">已配置</Tag> : <Tag color="default">未配置</Tag>}>
        <Alert type="info" message="配置 Embedding 模型后，系统将支持向量语义搜索、角色消歧增强和隐含关系发现。未配置时不影响基本功能。" style={{ marginBottom: 16 }} />
        <Form form={embForm} layout="vertical">
          <Form.Item label="API 地址" name="apiUrl" rules={[{ required: true, message: '请输入API地址' }]}>
            <Input placeholder="如 https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item label="API Key" name="apiKey" rules={[{ required: !embConfigured, message: '请输入API Key' }]}>
            <Input.Password placeholder={embConfigured ? '留空则保持原有Key' : 'sk-...'} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button onClick={handleGetEmbModels} loading={loadingEmbModels}>获取模型列表</Button>
              <Button onClick={handleTestEmbedding}>测试连接</Button>
            </Space>
            {embTestResult && (
              <Alert type={embTestResult.success ? 'success' : 'error'} message={embTestResult.message} style={{ marginTop: 8 }} />
            )}
          </Form.Item>
          <Form.Item label="选择模型" name="model" rules={[{ required: true }]}>
            <Select placeholder="先获取模型列表或手动输入" showSearch options={embModels.map(m => ({
              label: m.name, value: m.id,
            }))} />
          </Form.Item>
          <Form.Item label="向量维度" name="dimensions" tooltip="测试连接时自动检测">
            <InputNumber min={128} max={8192} placeholder="1536" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" onClick={handleSaveEmbedding}>保存 Embedding 配置</Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title="Reranker 模型配置（可选）" style={{ marginBottom: 24 }}
        extra={rerankerConfigured ? <Tag color="green">已配置</Tag> : <Tag color="default">未配置</Tag>}>
        <Alert type="info" message="配置 Reranker 模型后，系统将在语义搜索和隐含关系发现中对候选结果进行精排，提高准确率。需要先配置 Embedding。" style={{ marginBottom: 16 }} />
        <Form form={rerankerForm} layout="vertical">
          <Form.Item label="API 地址" name="apiUrl" rules={[{ required: true, message: '请输入API地址' }]}>
            <Input placeholder="如 https://api.cohere.ai/v1" />
          </Form.Item>
          <Form.Item label="API Key" name="apiKey" rules={[{ required: !rerankerConfigured, message: '请输入API Key' }]}>
            <Input.Password placeholder={rerankerConfigured ? '留空则保持原有Key' : 'sk-...'} />
          </Form.Item>
          <Form.Item>
            <Button onClick={handleTestReranker}>测试连接</Button>
            {rerankerTestResult && (
              <Alert type={rerankerTestResult.success ? 'success' : 'error'} message={rerankerTestResult.message} style={{ marginTop: 8 }} />
            )}
          </Form.Item>
          <Form.Item label="模型名" name="model" rules={[{ required: true }]}>
            <Input placeholder="如 rerank-v3.5 或 bge-reranker-large" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" onClick={handleSaveReranker}>保存 Reranker 配置</Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default Settings;
