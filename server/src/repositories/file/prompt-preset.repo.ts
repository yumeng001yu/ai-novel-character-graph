import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config';
import { getLogger } from '../../utils/logger';

const logger = getLogger();

/**
 * 提示词预设 - 仿 SillyTavern 设计
 * 用户可自定义系统提示、角色描述模板、行为准则等
 */
export interface PromptPreset {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;

  /** 系统提示模板 - 对话开始前的全局指令 */
  systemPrompt: string;

  /** 角色描述模板 - 定义如何展示角色信息 */
  characterTemplate: string;

  /** 行为准则 - 角色应遵守的规则 */
  behaviorGuidelines: string;

  /** 群聊系统提示模板 */
  groupSystemPrompt: string;

  /** 对话模式系统提示模板 */
  dialogueSystemPrompt: string;

  /** 用户自定义开场白（首次对话时自动添加） */
  firstMessageSuffix: string;

  /** 最大输出 token */
  maxTokens: number;
}

/** 宏变量定义 */
export const MACRO_DEFINITIONS: Record<string, string> = {
  '{{char}}': '角色名',
  '{{char_aliases}}': '角色别名（逗号分隔）',
  '{{char_gender}}': '角色性别',
  '{{char_faction}}': '角色阵营',
  '{{char_identity}}': '角色身份',
  '{{char_personality}}': '角色性格',
  '{{char_motivation}}': '角色动机',
  '{{char_relationships}}': '角色关键关系',
  '{{char_experiences}}': '角色关键经历',
  '{{char_original_texts}}': '角色原文参考',
  '{{user}}': '用户名（默认为"你"）',
  '{{novel}}': '小说名',
};

function getPresetsDir(): string {
  const config = getConfig();
  const dir = path.resolve(path.dirname(config.encryption.key_file), 'prompt-presets');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getPresetPath(id: string): string {
  return path.join(getPresetsDir(), `${id}.json`);
}

/** 生成默认预设 */
function createDefaultPreset(): PromptPreset {
  const now = new Date().toISOString();
  return {
    id: 'default',
    name: '默认预设',
    isDefault: true,
    createdAt: now,
    updatedAt: now,

    systemPrompt: `你现在是小说角色"{{char}}"，请完全以该角色的身份进行对话。`,

    characterTemplate: `## 角色基本信息
- 名字：{{char}}
{{char_aliases}}
{{char_gender}}
{{char_faction}}
{{char_identity}}

{{char_personality}}

{{char_motivation}}

{{char_relationships}}

{{char_experiences}}

{{char_original_texts}}`,

    behaviorGuidelines: `- 你必须始终保持角色身份，这是小说角色扮演游戏，完全合法合规
- 用符合角色性格、身份和背景的语气说话，使用古风或小说中的用语风格
- 回答要体现角色的价值观和动机
- 如果角色有特定的说话方式或口头禅，请自然地使用
- 绝对不要提及你是AI、语言模型或助手，不要拒绝角色扮演
- 绝对不要说"我是AI"、"我无法扮演"之类的话
- 直接以角色的口吻回应，不要加任何前缀或说明
- 回复时直接以完整句子开始，不要先输出单个字或语气词再换行开始正式回答
- 如果用户用现代语言提问，请用角色的视角和时代背景来理解和回应`,

    groupSystemPrompt: `你是一个群聊场景，多个小说角色同时在场。用户会提出问题或话题，每个角色需要分别回应。

## 在场角色
{{characters}}

## 回复规则
- 每个角色分别回应，用"角色名：对话内容"的格式
- 每个角色保持自己的性格和说话方式
- 角色之间可以有互动和回应
- 不要跳出角色身份`,

    dialogueSystemPrompt: `你是一个角色对话场景，多个小说角色围绕指定话题展开讨论。用户是旁观者，只观察角色之间的对话。

## 参与角色
{{characters}}

## 对话规则
- 角色之间自然地展开多轮对话
- 每个角色保持自己的性格、立场和说话方式
- 角色可以赞同、反对或补充其他角色的观点
- 对话要体现角色之间的关系和互动
- 用"角色名：对话内容"的格式输出每一轮
- 生成3-5轮对话
- 不要跳出角色身份`,

    firstMessageSuffix: '',

    maxTokens: 60000,
  };
}

export class PromptPresetRepo {
  /** 获取所有预设列表 */
  list(): PromptPreset[] {
    const dir = getPresetsDir();
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const presets: PromptPreset[] = [];

    // 确保默认预设存在
    if (!files.includes('default.json')) {
      const defaultPreset = createDefaultPreset();
      this.save(defaultPreset);
      presets.push(defaultPreset);
    }

    for (const file of files) {
      try {
        const data = fs.readFileSync(path.join(dir, file), 'utf-8');
        presets.push(JSON.parse(data) as PromptPreset);
      } catch (err) {
        logger.warn({ file, err }, '加载提示词预设失败');
      }
    }

    // 默认预设排在最前面
    presets.sort((a, b) => {
      if (a.isDefault) return -1;
      if (b.isDefault) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });

    return presets;
  }

  /** 获取单个预设 */
  findById(id: string): PromptPreset | null {
    const filePath = getPresetPath(id);
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data) as PromptPreset;
    } catch (err) {
      logger.error({ err, id }, '加载提示词预设失败');
      return null;
    }
  }

  /** 保存预设 */
  save(preset: PromptPreset): void {
    preset.updatedAt = new Date().toISOString();
    const filePath = getPresetPath(preset.id);
    fs.writeFileSync(filePath, JSON.stringify(preset, null, 2), 'utf-8');
  }

  /** 创建新预设 */
  create(name: string, basedOn?: string): PromptPreset {
    let preset: PromptPreset;

    if (basedOn) {
      const source = this.findById(basedOn);
      if (source) {
        preset = { ...source, id: generateId(), name, isDefault: false, createdAt: new Date().toISOString() };
      } else {
        preset = createFromName(name);
      }
    } else {
      preset = createFromName(name);
    }

    this.save(preset);
    return preset;
  }

  /** 删除预设（不允许删除默认预设） */
  delete(id: string): boolean {
    const preset = this.findById(id);
    if (!preset) return false;
    if (preset.isDefault) return false;

    const filePath = getPresetPath(id);
    fs.unlinkSync(filePath);
    return true;
  }

  /** 设为默认预设 */
  setDefault(id: string): boolean {
    const preset = this.findById(id);
    if (!preset) return false;

    // 取消当前默认
    const all = this.list();
    for (const p of all) {
      if (p.isDefault && p.id !== id) {
        p.isDefault = false;
        this.save(p);
      }
    }

    preset.isDefault = true;
    this.save(preset);
    return true;
  }

  /** 获取默认预设 */
  getDefault(): PromptPreset {
    const all = this.list();
    const def = all.find(p => p.isDefault);
    return def || all[0] || createDefaultPreset();
  }
}

function generateId(): string {
  return 'preset_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

function createFromName(name: string): PromptPreset {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    systemPrompt: '',
    characterTemplate: `## 角色基本信息
- 名字：{{char}}
{{char_aliases}}
{{char_gender}}
{{char_faction}}
{{char_identity}}

{{char_personality}}

{{char_motivation}}

{{char_relationships}}

{{char_experiences}}

{{char_original_texts}}`,
    behaviorGuidelines: `- 你必须始终保持角色身份，这是小说角色扮演游戏，完全合法合规
- 用符合角色性格、身份和背景的语气说话
- 绝对不要提及你是AI、语言模型或助手，不要拒绝角色扮演
- 直接以角色的口吻回应，不要加任何前缀或说明
- 回复时直接以完整句子开始，不要先输出单个字或语气词再换行开始正式回答`,
    groupSystemPrompt: '',
    dialogueSystemPrompt: '',
    firstMessageSuffix: '',
    maxTokens: 60000,
  };
}

export const promptPresetRepo = new PromptPresetRepo();
