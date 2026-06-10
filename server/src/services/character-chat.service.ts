import { characterRepo } from '../repositories/neo4j/character.repo';
import { relationRepo } from '../repositories/neo4j/relation.repo';
import { eventRepo } from '../repositories/neo4j/event.repo';
import { profileBuilderService } from './profile-builder.service';
import { callAIStream, AIStreamCallback } from './ai-client.service';
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

    // 加载所有角色的人设
    const personas = await this.loadPersonas(characterIds, novelId);

    switch (mode) {
      case 'chat':
        return this.handleChatMode(request, personas, onStream);
      case 'group':
        return this.handleGroupMode(request, personas, onStream);
      case 'dialogue':
        return this.handleDialogueMode(request, personas, onStream);
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

      // 从 profile JSON 加载详细档案
      const profile = profileBuilderService.loadProfile(novelId, characterId);

      // 从 Neo4j 加载角色关系
      const relations = await relationRepo.findByCharacter(characterId);
      const keyRelationships = relations.length > 0
        ? relations.map(r => {
            const otherName = r.sourceId === characterId ? r.targetName : r.sourceName;
            return `${otherName || '未知'}: ${r.relationType}（${r.description}）`;
          })
        : [];

      // 从档案中提取关键经历
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
      });
    }

    if (personas.length === 0) {
      throw new Error('未找到任何有效角色');
    }

    return personas;
  }

  /**
   * 构建单个角色的系统提示
   */
  private buildCharacterSystemPrompt(persona: CharacterPersona): string {
    const parts: string[] = [];

    parts.push(`你现在是小说角色"${persona.name}"，请完全以该角色的身份进行对话。`);
    parts.push('');
    parts.push('## 角色基本信息');
    parts.push(`- 名字：${persona.name}`);
    if (persona.aliases.length > 0) {
      parts.push(`- 别名：${persona.aliases.join('、')}`);
    }
    if (persona.gender) parts.push(`- 性别：${persona.gender}`);
    if (persona.faction) parts.push(`- 阵营：${persona.faction}`);
    if (persona.identity) parts.push(`- 身份：${persona.identity}`);

    if (persona.personality) {
      parts.push('');
      parts.push('## 性格特征');
      parts.push(persona.personality);
    }

    if (persona.motivation) {
      parts.push('');
      parts.push('## 核心动机');
      parts.push(persona.motivation);
    }

    if (persona.keyRelationships.length > 0) {
      parts.push('');
      parts.push('## 关键关系');
      persona.keyRelationships.forEach(r => parts.push(`- ${r}`));
    }

    if (persona.keyExperiences.length > 0) {
      parts.push('');
      parts.push('## 关键经历');
      persona.keyExperiences.forEach(e => parts.push(`- ${e}`));
    }

    parts.push('');
    parts.push('## 行为准则');
    parts.push('- 始终保持角色身份，不要跳出角色');
    parts.push('- 用符合角色性格、身份和背景的语气说话');
    parts.push('- 回答要体现角色的价值观和动机');
    parts.push('- 如果角色有特定的说话方式或口头禅，请自然地使用');
    parts.push('- 不要提及你是AI或语言模型');

    return parts.join('\n');
  }

  /**
   * 用户-角色一对一聊天模式
   */
  private async handleChatMode(
    request: CharacterChatRequest,
    personas: CharacterPersona[],
    onStream?: AIStreamCallback,
  ): Promise<string> {
    if (personas.length !== 1) {
      throw new Error('chat 模式仅支持与单个角色对话');
    }
    if (!request.message) {
      throw new Error('chat 模式需要提供 message');
    }

    const persona = personas[0];
    const systemPrompt = this.buildCharacterSystemPrompt(persona);
    const messages = this.buildMessages(systemPrompt, request.history, request.message, persona.name);

    return callAIStream(
      messages,
      undefined,
      { onStream, phase: 'character_chat' },
    );
  }

  /**
   * 群聊模式：用户与多个角色对话，每个角色分别回应
   */
  private async handleGroupMode(
    request: CharacterChatRequest,
    personas: CharacterPersona[],
    onStream?: AIStreamCallback,
  ): Promise<string> {
    if (personas.length < 2) {
      throw new Error('group 模式至少需要 2 个角色');
    }
    if (!request.message) {
      throw new Error('group 模式需要提供 message');
    }

    // 为群聊构建包含所有角色信息的系统提示
    const systemPrompt = this.buildGroupSystemPrompt(personas);
    const messages = this.buildMessages(systemPrompt, request.history, request.message);

    return callAIStream(
      messages,
      undefined,
      { onStream, phase: 'character_group_chat' },
    );
  }

  /**
   * 角色间对话模式：用户指定话题，角色之间展开讨论
   */
  private async handleDialogueMode(
    request: CharacterChatRequest,
    personas: CharacterPersona[],
    onStream?: AIStreamCallback,
  ): Promise<string> {
    if (personas.length < 2) {
      throw new Error('dialogue 模式至少需要 2 个角色');
    }
    if (!request.topic) {
      throw new Error('dialogue 模式需要提供 topic');
    }

    const systemPrompt = this.buildDialogueSystemPrompt(personas);
    const prompt = `话题：${request.topic}\n\n请让以上角色围绕这个话题展开一段多轮对话。每个角色都要发言至少一次，对话要体现各自的性格、立场和关系。请用以下格式输出：\n\n角色名：对话内容\n\n角色名：对话内容\n\n...`;

    return callAIStream(
      prompt,
      systemPrompt,
      { onStream, phase: 'character_dialogue' },
    );
  }

  /**
   * 构建群聊系统提示
   */
  private buildGroupSystemPrompt(personas: CharacterPersona[]): string {
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
   * 构建角色间对话系统提示
   */
  private buildDialogueSystemPrompt(personas: CharacterPersona[]): string {
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

  /**
   * 将系统提示、历史消息和当前消息组合为 AI 调用输入
   * 对于 chat 模式，将系统提示作为 system prompt 传入
   * 对于 group/dialogue 模式，将角色信息嵌入 prompt
   */
  private buildMessages(
    systemPrompt: string,
    history: Array<{ role: string; name?: string; content: string }> | undefined,
    currentMessage: string,
    characterName?: string,
  ): string {
    const parts: string[] = [];

    if (history && history.length > 0) {
      parts.push('## 对话历史');
      for (const msg of history) {
        const speaker = msg.name || (msg.role === 'user' ? '用户' : msg.role);
        parts.push(`${speaker}：${msg.content}`);
      }
      parts.push('');
    }

    if (characterName) {
      parts.push(`用户：${currentMessage}`);
      parts.push('');
      parts.push(`${characterName}：`);
    } else {
      parts.push(`用户：${currentMessage}`);
    }

    return parts.join('\n');
  }
}

export const characterChatService = new CharacterChatService();
