import { characterRepo } from '../repositories/neo4j/character.repo';
import { relationRepo } from '../repositories/neo4j/relation.repo';
import { eventRepo } from '../repositories/neo4j/event.repo';
import { profileBuilderService } from './profile-builder.service';
import { vectorSearchService } from './vector-search.service';
import { embeddingService } from './embedding.service';
import { callAIStream, AIStreamCallback } from './ai-client.service';
import { promptPresetRepo, PromptPreset } from '../repositories/file/prompt-preset.repo';
import { getLogger } from '../utils/logger';
import { Character, CharacterProfile, AIContentRefusedError } from '../types';

const logger = getLogger();

export interface CharacterChatRequest {
  characterIds: string[];
  novelId: string;
  mode: 'chat' | 'group' | 'dialogue';
  message?: string;
  topic?: string;
  history?: Array<{ role: string; name?: string; content: string }>;
  /** 指定提示词预设ID，不传则使用默认预设 */
  presetId?: string;
}

interface CharacterPersona {
  characterId: string;
  name: string;
  aliases: string[];
  gender?: string;
  faction?: string;
  identity?: string;
  personality: string;
  motivation: string;
  keyRelationships: string[];
  keyExperiences: string[];
  originalTexts: string[];
}

/** 宏变量替换上下文 */
interface MacroContext {
  char: CharacterPersona;
  user: string;
  novel: string;
}

export class CharacterChatService {
  /**
   * 处理角色聊天请求，返回流式响应
   */
  async chat(
    request: CharacterChatRequest,
    onStream?: AIStreamCallback,
  ): Promise<string> {
    const { mode, characterIds, novelId } = request;

    if (!characterIds || characterIds.length === 0) {
      throw new Error('至少需要指定一个角色');
    }

    // 加载提示词预设
    const preset = request.presetId
      ? promptPresetRepo.findById(request.presetId)
      : promptPresetRepo.getDefault();
    if (!preset) {
      throw new Error('提示词预设未找到');
    }

    // 加载所有角色的人设
    const personas = await this.loadPersonas(characterIds, novelId);

    switch (mode) {
      case 'chat':
        return this.handleChatMode(request, personas, preset, onStream);
      case 'group':
        return this.handleGroupMode(request, personas, preset, onStream);
      case 'dialogue':
        return this.handleDialogueMode(request, personas, preset, onStream);
      default:
        throw new Error(`不支持的聊天模式: ${mode}`);
    }
  }

  /**
   * 加载多个角色的人设信息
   */
  private async loadPersonas(characterIds: string[], novelId: string): Promise<CharacterPersona[]> {
    const personas: CharacterPersona[] = [];

    for (const characterId of characterIds) {
      const character = await characterRepo.findById(characterId);
      if (!character) {
        logger.warn({ characterId }, '角色未找到，跳过');
        continue;
      }

      const profile = profileBuilderService.loadProfile(novelId, characterId);

      const relations = await relationRepo.findByCharacter(characterId);
      const keyRelationships = relations.length > 0
        ? relations.map(r => {
            const otherName = r.sourceId === characterId ? r.targetName : r.sourceName;
            return `${otherName || '未知'}: ${r.relationType}（${r.description}）`;
          })
        : [];

      const keyExperiences = profile?.experienceTimeline?.length
        ? profile.experienceTimeline
            .filter(e => e.importance >= 6)
            .map(e => `第${e.chapter}章 [${e.type}] ${e.event}`)
        : [];

      personas.push({
        characterId: character.id,
        name: character.name,
        aliases: character.aliases || [],
        gender: character.gender,
        faction: character.faction,
        identity: character.identity,
        personality: profile?.personalAnalysis?.personality || '',
        motivation: profile?.personalAnalysis?.motivation || '',
        keyRelationships,
        keyExperiences,
        originalTexts: [],
      });
    }

    if (await embeddingService.isConfigured()) {
      try {
        for (const persona of personas) {
          const textChunks = await vectorSearchService.searchTextChunks(novelId, persona.name, 3);
          persona.originalTexts = textChunks
            .filter(tc => tc.text && tc.text.length > 50)
            .map(tc => `[${tc.chapterRange}] ${tc.text.substring(0, 500)}`)
            .slice(0, 3);
        }
      } catch (err) {
        logger.warn({ err }, '角色对话原文检索失败（非致命）');
      }
    }

    if (personas.length === 0) {
      throw new Error('未找到任何有效角色');
    }

    return personas;
  }

  /**
   * 替换宏变量
   */
  private replaceMacros(template: string, ctx: MacroContext): string {
    let result = template;

    result = result.replace(/\{\{char\}\}/g, ctx.char.name);
    result = result.replace(/\{\{char_aliases\}\}/g,
      ctx.char.aliases.length > 0 ? `- 别名：${ctx.char.aliases.join('、')}` : '');
    result = result.replace(/\{\{char_gender\}\}/g,
      ctx.char.gender ? `- 性别：${ctx.char.gender}` : '');
    result = result.replace(/\{\{char_faction\}\}/g,
      ctx.char.faction ? `- 阵营：${ctx.char.faction}` : '');
    result = result.replace(/\{\{char_identity\}\}/g,
      ctx.char.identity ? `- 身份：${ctx.char.identity}` : '');
    result = result.replace(/\{\{char_personality\}\}/g,
      ctx.char.personality ? `## 性格特征\n${ctx.char.personality}` : '');
    result = result.replace(/\{\{char_motivation\}\}/g,
      ctx.char.motivation ? `## 核心动机\n${ctx.char.motivation}` : '');
    result = result.replace(/\{\{char_relationships\}\}/g,
      ctx.char.keyRelationships.length > 0
        ? `## 关键关系\n${ctx.char.keyRelationships.map(r => `- ${r}`).join('\n')}`
        : '');
    result = result.replace(/\{\{char_experiences\}\}/g,
      ctx.char.keyExperiences.length > 0
        ? `## 关键经历\n${ctx.char.keyExperiences.map(e => `- ${e}`).join('\n')}`
        : '');
    result = result.replace(/\{\{char_original_texts\}\}/g,
      ctx.char.originalTexts.length > 0
        ? `## 原文参考（请基于这些原文片段来模仿角色的说话风格和用词）\n${ctx.char.originalTexts.join('\n')}`
        : '');
    result = result.replace(/\{\{user\}\}/g, ctx.user);
    result = result.replace(/\{\{novel\}\}/g, ctx.novel);

    // 清理连续空行（宏替换后可能产生）
    result = result.replace(/\n{3,}/g, '\n\n').trim();

    return result;
  }

  /**
   * 使用预设构建单个角色的系统提示
   */
  private buildCharacterSystemPrompt(persona: CharacterPersona, preset: PromptPreset): string {
    const ctx: MacroContext = { char: persona, user: '你', novel: '' };
    const parts: string[] = [];

    // 系统提示
    if (preset.systemPrompt) {
      parts.push(this.replaceMacros(preset.systemPrompt, ctx));
    }

    // 角色描述模板
    if (preset.characterTemplate) {
      parts.push('');
      parts.push(this.replaceMacros(preset.characterTemplate, ctx));
    }

    // 行为准则
    if (preset.behaviorGuidelines) {
      parts.push('');
      parts.push('## 行为准则');
      parts.push(this.replaceMacros(preset.behaviorGuidelines, ctx));
    }

    return parts.join('\n');
  }

  /**
   * 使用预设构建群聊角色描述块
   */
  private buildCharacterBlock(persona: CharacterPersona, preset: PromptPreset): string {
    const ctx: MacroContext = { char: persona, user: '你', novel: '' };
    if (preset.characterTemplate) {
      return this.replaceMacros(preset.characterTemplate, ctx);
    }
    // 回退到简单格式
    const lines: string[] = [];
    lines.push(`### ${persona.name}`);
    if (persona.aliases.length > 0) lines.push(`别名：${persona.aliases.join('、')}`);
    if (persona.gender) lines.push(`性别：${persona.gender}`);
    if (persona.faction) lines.push(`阵营：${persona.faction}`);
    if (persona.identity) lines.push(`身份：${persona.identity}`);
    if (persona.personality) lines.push(`性格：${persona.personality}`);
    if (persona.motivation) lines.push(`动机：${persona.motivation}`);
    return lines.join('\n');
  }

  /**
   * 用户-角色一对一聊天模式
   */
  private async handleChatMode(
    request: CharacterChatRequest,
    personas: CharacterPersona[],
    preset: PromptPreset,
    onStream?: AIStreamCallback,
  ): Promise<string> {
    if (personas.length !== 1) {
      throw new Error('chat 模式仅支持与单个角色对话');
    }
    if (!request.message) {
      throw new Error('chat 模式需要提供 message');
    }

    const persona = personas[0];
    const systemPrompt = this.buildCharacterSystemPrompt(persona, preset);

    const messages: Array<{ role: string; content: string; name?: string }> = [];
    messages.push({ role: 'system', content: systemPrompt });

    if (request.history && request.history.length > 0) {
      for (const msg of request.history) {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
          ...(msg.name ? { name: msg.name } : {}),
        });
      }
    }

    // 首次对话添加开场白后缀
    let userMessage = request.message;
    if ((!request.history || request.history.length === 0) && preset.firstMessageSuffix) {
      const ctx: MacroContext = { char: persona, user: '你', novel: '' };
      userMessage += '\n' + this.replaceMacros(preset.firstMessageSuffix, ctx);
    }

    messages.push({ role: 'user', content: userMessage });

    return callAIStream(
      messages,
      undefined,
      { onStream, phase: 'character_chat', maxTokens: preset.maxTokens || 60000 },
    );
  }

  /**
   * 群聊模式
   */
  private async handleGroupMode(
    request: CharacterChatRequest,
    personas: CharacterPersona[],
    preset: PromptPreset,
    onStream?: AIStreamCallback,
  ): Promise<string> {
    if (personas.length < 2) {
      throw new Error('group 模式至少需要 2 个角色');
    }
    if (!request.message) {
      throw new Error('group 模式需要提供 message');
    }

    // 构建角色描述块
    const characterBlocks = personas.map(p => this.buildCharacterBlock(p, preset)).join('\n\n');

    // 使用预设的群聊系统提示
    let systemPrompt: string;
    if (preset.groupSystemPrompt) {
      const ctx: MacroContext = { char: personas[0], user: '你', novel: '' };
      systemPrompt = this.replaceMacros(preset.groupSystemPrompt, ctx);
      systemPrompt = systemPrompt.replace(/\{\{characters\}\}/g, characterBlocks);
    } else {
      systemPrompt = this.buildGroupSystemPromptFallback(personas);
    }

    // 添加行为准则
    if (preset.behaviorGuidelines) {
      const ctx: MacroContext = { char: personas[0], user: '你', novel: '' };
      systemPrompt += '\n\n## 行为准则\n' + this.replaceMacros(preset.behaviorGuidelines, ctx);
    }

    const messages: Array<{ role: string; content: string; name?: string }> = [];
    messages.push({ role: 'system', content: systemPrompt });

    if (request.history && request.history.length > 0) {
      for (const msg of request.history) {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
          ...(msg.name ? { name: msg.name } : {}),
        });
      }
    }

    messages.push({ role: 'user', content: request.message });

    return callAIStream(
      messages,
      undefined,
      { onStream, phase: 'character_group_chat', maxTokens: preset.maxTokens || 60000 },
    );
  }

  /**
   * 角色间对话模式
   */
  private async handleDialogueMode(
    request: CharacterChatRequest,
    personas: CharacterPersona[],
    preset: PromptPreset,
    onStream?: AIStreamCallback,
  ): Promise<string> {
    if (personas.length < 2) {
      throw new Error('dialogue 模式至少需要 2 个角色');
    }
    if (!request.topic) {
      throw new Error('dialogue 模式需要提供 topic');
    }

    const characterBlocks = personas.map(p => this.buildCharacterBlock(p, preset)).join('\n\n');

    let systemPrompt: string;
    if (preset.dialogueSystemPrompt) {
      const ctx: MacroContext = { char: personas[0], user: '你', novel: '' };
      systemPrompt = this.replaceMacros(preset.dialogueSystemPrompt, ctx);
      systemPrompt = systemPrompt.replace(/\{\{characters\}\}/g, characterBlocks);
    } else {
      systemPrompt = this.buildDialogueSystemPromptFallback(personas);
    }

    if (preset.behaviorGuidelines) {
      const ctx: MacroContext = { char: personas[0], user: '你', novel: '' };
      systemPrompt += '\n\n## 行为准则\n' + this.replaceMacros(preset.behaviorGuidelines, ctx);
    }

    const prompt = `话题：${request.topic}\n\n请让以上角色围绕这个话题展开一段多轮对话。每个角色都要发言至少一次，对话要体现各自的性格、立场和关系。请用以下格式输出：\n\n角色名：对话内容\n\n角色名：对话内容\n\n...`;

    return callAIStream(
      prompt,
      systemPrompt,
      { onStream, phase: 'character_dialogue', maxTokens: preset.maxTokens || 60000 },
    );
  }

  /**
   * 群聊系统提示回退（预设为空时使用）
   */
  private buildGroupSystemPromptFallback(personas: CharacterPersona[]): string {
    const parts: string[] = [];
    parts.push('你是一个群聊场景，多个小说角色同时在场。用户会提出问题或话题，每个角色需要分别回应。');
    parts.push('');
    parts.push('## 在场角色');
    for (const persona of personas) {
      parts.push('');
      parts.push(`### ${persona.name}`);
      if (persona.aliases.length > 0) parts.push(`别名：${persona.aliases.join('、')}`);
      if (persona.gender) parts.push(`性别：${persona.gender}`);
      if (persona.faction) parts.push(`阵营：${persona.faction}`);
      if (persona.identity) parts.push(`身份：${persona.identity}`);
      if (persona.personality) parts.push(`性格：${persona.personality}`);
      if (persona.motivation) parts.push(`动机：${persona.motivation}`);
      if (persona.keyRelationships.length > 0) {
        parts.push('关系：');
        persona.keyRelationships.forEach(r => parts.push(`  - ${r}`));
      }
      if (persona.keyExperiences.length > 0) {
        parts.push('关键经历：');
        persona.keyExperiences.forEach(e => parts.push(`  - ${e}`));
      }
      if (persona.originalTexts.length > 0) {
        parts.push('原文参考：');
        persona.originalTexts.forEach(t => parts.push(`  ${t}`));
      }
    }
    parts.push('');
    parts.push('## 回复规则');
    parts.push('- 每个角色分别回应，用"角色名：对话内容"的格式');
    parts.push('- 每个角色保持自己的性格和说话方式');
    parts.push('- 角色之间可以有互动和回应');
    parts.push('- 不要跳出角色身份');
    return parts.join('\n');
  }

  /**
   * 对话模式系统提示回退
   */
  private buildDialogueSystemPromptFallback(personas: CharacterPersona[]): string {
    const parts: string[] = [];
    parts.push('你是一个角色对话场景，多个小说角色围绕指定话题展开讨论。用户是旁观者，只观察角色之间的对话。');
    parts.push('');
    parts.push('## 参与角色');
    for (const persona of personas) {
      parts.push('');
      parts.push(`### ${persona.name}`);
      if (persona.aliases.length > 0) parts.push(`别名：${persona.aliases.join('、')}`);
      if (persona.gender) parts.push(`性别：${persona.gender}`);
      if (persona.faction) parts.push(`阵营：${persona.faction}`);
      if (persona.identity) parts.push(`身份：${persona.identity}`);
      if (persona.personality) parts.push(`性格：${persona.personality}`);
      if (persona.motivation) parts.push(`动机：${persona.motivation}`);
      if (persona.keyRelationships.length > 0) {
        parts.push('关系：');
        persona.keyRelationships.forEach(r => parts.push(`  - ${r}`));
      }
      if (persona.keyExperiences.length > 0) {
        parts.push('关键经历：');
        persona.keyExperiences.forEach(e => parts.push(`  - ${e}`));
      }
      if (persona.originalTexts.length > 0) {
        parts.push('原文参考：');
        persona.originalTexts.forEach(t => parts.push(`  ${t}`));
      }
    }
    parts.push('');
    parts.push('## 对话规则');
    parts.push('- 角色之间自然地展开多轮对话');
    parts.push('- 每个角色保持自己的性格、立场和说话方式');
    parts.push('- 角色可以赞同、反对或补充其他角色的观点');
    parts.push('- 对话要体现角色之间的关系和互动');
    parts.push('- 用"角色名：对话内容"的格式输出每一轮');
    parts.push('- 生成3-5轮对话');
    parts.push('- 不要跳出角色身份');
    return parts.join('\n');
  }
}

export const characterChatService = new CharacterChatService();
