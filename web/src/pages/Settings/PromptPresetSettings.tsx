import React, { useState, useEffect } from 'react';
import {
  Card, Button, Select, Input, Modal, message, Popconfirm, Tag, Space,
  Tabs, Tooltip, InputNumber, Alert,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, StarOutlined, StarFilled, CopyOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import {
  getPromptPresets, getPromptPreset, createPromptPreset, updatePromptPreset,
  deletePromptPreset, setDefaultPromptPreset, getPromptMacros,
} from '../../services/api';

const { TextArea } = Input;

interface PresetData {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  systemPrompt: string;
  characterTemplate: string;
  behaviorGuidelines: string;
  groupSystemPrompt: string;
  dialogueSystemPrompt: string;
  firstMessageSuffix: string;
  maxTokens: number;
}

const PromptPresetSettings: React.FC = () => {
  const [presets, setPresets] = useState<PresetData[]>([]);
  const [currentId, setCurrentId] = useState<string>('');
  const [current, setCurrent] = useState<PresetData | null>(null);
  const [macros, setMacros] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [activeTab, setActiveTab] = useState('system');

  useEffect(() => {
    loadPresets();
    loadMacros();
  }, []);

  const loadPresets = async () => {
    try {
      const res = await getPromptPresets();
      const list = res.data as PresetData[];
      setPresets(list);
      // 自动选中默认预设
      const def = list.find((p: PresetData) => p.isDefault) || list[0];
      if (def) {
        setCurrentId(def.id);
        loadPreset(def.id);
      }
    } catch (err) {
      message.error('加载预设列表失败');
    }
  };

  const loadPreset = async (id: string) => {
    try {
      const res = await getPromptPreset(id);
      setCurrent(res.data);
      setCurrentId(id);
    } catch (err) {
      message.error('加载预设失败');
    }
  };

  const loadMacros = async () => {
    try {
      const res = await getPromptMacros();
      setMacros(res.data);
    } catch (err) {
      // 非致命
    }
  };

  const handleSave = async () => {
    if (!current) return;
    try {
      setLoading(true);
      await updatePromptPreset(current.id, {
        systemPrompt: current.systemPrompt,
        characterTemplate: current.characterTemplate,
        behaviorGuidelines: current.behaviorGuidelines,
        groupSystemPrompt: current.groupSystemPrompt,
        dialogueSystemPrompt: current.dialogueSystemPrompt,
        firstMessageSuffix: current.firstMessageSuffix,
        maxTokens: current.maxTokens,
        name: current.name,
      });
      message.success('预设已保存');
      loadPresets();
    } catch (err) {
      message.error('保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) {
      message.warning('请输入预设名称');
      return;
    }
    try {
      const res = await createPromptPreset(newName.trim(), currentId || undefined);
      message.success('预设已创建');
      setCreateModalOpen(false);
      setNewName('');
      loadPresets();
      setCurrentId(res.data.id);
      loadPreset(res.data.id);
    } catch (err) {
      message.error('创建失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePromptPreset(id);
      message.success('已删除');
      loadPresets();
      if (id === currentId) {
        const remaining = presets.filter(p => p.id !== id);
        if (remaining.length > 0) {
          setCurrentId(remaining[0].id);
          loadPreset(remaining[0].id);
        } else {
          setCurrent(null);
        }
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await setDefaultPromptPreset(id);
      message.success('已设为默认');
      loadPresets();
    } catch (err) {
      message.error('设置失败');
    }
  };

  const updateField = (field: keyof PresetData, value: any) => {
    if (!current) return;
    setCurrent({ ...current, [field]: value });
  };

  const macroList = Object.entries(macros);

  const tabItems = [
    {
      key: 'system',
      label: '系统提示',
      children: (
        <div>
          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>对话开始前的全局指令，定义角色扮演的基本规则</span>
          </div>
          <TextArea
            rows={4}
            value={current?.systemPrompt || ''}
            onChange={e => updateField('systemPrompt', e.target.value)}
            placeholder="如：你现在是小说角色{{char}}，请完全以该角色的身份进行对话。"
          />
        </div>
      ),
    },
    {
      key: 'character',
      label: '角色描述模板',
      children: (
        <div>
          <div style={{ marginBottom: 8 }}>
            <span>定义如何展示角色信息，支持宏变量替换</span>
          </div>
          <TextArea
            rows={12}
            value={current?.characterTemplate || ''}
            onChange={e => updateField('characterTemplate', e.target.value)}
            placeholder="使用 {{char}}, {{char_personality}} 等宏变量构建角色描述..."
          />
        </div>
      ),
    },
    {
      key: 'behavior',
      label: '行为准则',
      children: (
        <div>
          <div style={{ marginBottom: 8 }}>
            <span>角色应遵守的规则，每行一条</span>
          </div>
          <TextArea
            rows={8}
            value={current?.behaviorGuidelines || ''}
            onChange={e => updateField('behaviorGuidelines', e.target.value)}
            placeholder="- 你必须始终保持角色身份&#10;- 绝对不要提及你是AI..."
          />
        </div>
      ),
    },
    {
      key: 'group',
      label: '群聊提示',
      children: (
        <div>
          <div style={{ marginBottom: 8 }}>
            <span>群聊模式的系统提示，可用 {'{{characters}}'} 插入所有角色描述</span>
          </div>
          <TextArea
            rows={8}
            value={current?.groupSystemPrompt || ''}
            onChange={e => updateField('groupSystemPrompt', e.target.value)}
            placeholder="群聊系统提示模板..."
          />
        </div>
      ),
    },
    {
      key: 'dialogue',
      label: '对话提示',
      children: (
        <div>
          <div style={{ marginBottom: 8 }}>
            <span>角色间对话模式的系统提示，可用 {'{{characters}}'} 插入所有角色描述</span>
          </div>
          <TextArea
            rows={8}
            value={current?.dialogueSystemPrompt || ''}
            onChange={e => updateField('dialogueSystemPrompt', e.target.value)}
            placeholder="对话系统提示模板..."
          />
        </div>
      ),
    },
    {
      key: 'advanced',
      label: '高级设置',
      children: (
        <div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>首次对话附加提示</div>
            <div style={{ marginBottom: 8, color: '#888', fontSize: 13 }}>
              用户发送第一条消息时，自动追加到消息末尾的提示（如引导角色自我介绍）
            </div>
            <TextArea
              rows={3}
              value={current?.firstMessageSuffix || ''}
              onChange={e => updateField('firstMessageSuffix', e.target.value)}
              placeholder="如：请先简要介绍自己的身份和背景。"
            />
          </div>
          <div>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>最大输出 Token</div>
            <InputNumber
              min={256}
              max={128000}
              value={current?.maxTokens || 60000}
              onChange={v => updateField('maxTokens', v || 60000)}
              style={{ width: 200 }}
            />
          </div>
        </div>
      ),
    },
  ];

  return (
    <Card
      title="提示词预设"
      extra={
        <Space>
          <Button icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
            新建预设
          </Button>
          <Button type="primary" onClick={handleSave} loading={loading}>
            保存修改
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        message={'仿 SillyTavern 设计，支持自定义提示词预设和宏变量替换。修改预设后点击「保存修改」生效。'}
        style={{ marginBottom: 16 }}
      />

      {/* 预设选择器 */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 500 }}>当前预设：</span>
        <Select
          value={currentId}
          onChange={id => loadPreset(id)}
          style={{ minWidth: 200 }}
          options={presets.map(p => ({
            label: (
              <span>
                {p.isDefault && <StarFilled style={{ color: '#faad14', marginRight: 4 }} />}
                {p.name}
              </span>
            ),
            value: p.id,
          }))}
        />
        {current && !current.isDefault && (
          <Popconfirm title="确定删除此预设？" onConfirm={() => handleDelete(current.id)}>
            <Button danger size="small" icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        )}
        {current && !current.isDefault && (
          <Tooltip title="设为默认">
            <Button size="small" icon={<StarOutlined />} onClick={() => handleSetDefault(current.id)} />
          </Tooltip>
        )}
        {current && (
          <Button size="small" icon={<CopyOutlined />} onClick={() => { setCreateModalOpen(true); }}>
            基于此创建
          </Button>
        )}
      </div>

      {/* 宏变量参考 */}
      <div style={{ marginBottom: 16, padding: '8px 12px', background: '#fafafa', borderRadius: 6, border: '1px solid #f0f0f0' }}>
        <div style={{ marginBottom: 4, fontWeight: 500, fontSize: 13 }}>
          <InfoCircleOutlined style={{ marginRight: 4 }} />可用宏变量
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {macroList.map(([key, desc]) => (
            <Tooltip key={key} title={desc}>
              <Tag color="blue" style={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: 12 }}>
                {key}
              </Tag>
            </Tooltip>
          ))}
        </div>
      </div>

      {/* 编辑区域 */}
      {current && (
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
      )}

      {/* 新建预设弹窗 */}
      <Modal
        title="新建提示词预设"
        open={createModalOpen}
        onOk={handleCreate}
        onCancel={() => { setCreateModalOpen(false); setNewName(''); }}
        okText="创建"
        cancelText="取消"
      >
        <div style={{ marginBottom: 8 }}>预设名称：</div>
        <Input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="输入预设名称"
          onPressEnter={handleCreate}
        />
        {currentId && (
          <div style={{ marginTop: 8, color: '#888', fontSize: 13 }}>
            将基于当前预设「{presets.find(p => p.id === currentId)?.name}」创建副本
          </div>
        )}
      </Modal>
    </Card>
  );
};

export default PromptPresetSettings;
