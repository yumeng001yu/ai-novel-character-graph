// ===== 小说相关 =====
export type InputMode = 'file_chapter' | 'file_no_chapter' | 'text_paste';

export interface Novel {
  id: string;
  name: string;
  totalChars: number;
  totalTokens: number;
  inputMode: InputMode;
  currentStep: number;
  totalSteps: number;
  contextSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface Chapter {
  index: number;
  title: string;
  startOffset: number;
  charCount: number;
  tokenCount: number;
  novelId: string;
}

export interface Step {
  stepNumber: number;
  chaptersRange: string;
  totalTokens: number;
  totalChars: number;
  status: 'pending' | 'building' | 'completed' | 'canceled' | 'failed';
  novelId: string;
}

// ===== 角色相关 =====
export type DisambiguationStatus = 'confirmed' | 'pending_merge' | 'pending_split';

export interface Character {
  id: string;
  name: string;
  aliases: string[];
  gender?: string;
  faction?: string;
  identity?: string;
  firstAppearChapter: number;
  isProtagonist: boolean;
  protagonistOrder?: number;
  disambiguationStatus: DisambiguationStatus;
  novelId: string;
}

export interface CharacterProfile {
  id: string;
  characterId: string;
  basicInfo: {
    aliases: string[];
    gender?: string;
    faction?: string;
    identity?: string;
    firstAppear: string;
  };
  experienceTimeline: ExperienceEvent[];
  personalAnalysis: PersonalAnalysis;
  chaptersInvolved: number[];
}

export interface ExperienceEvent {
  chapter: number;
  event: string;
  type: '转折点' | '成长' | '危机' | '日常';
}

export interface PersonalAnalysis {
  characterArc: string;
  personality: string;
  motivation: string;
  keyRelationships: KeyRelationship[];
  inferences: Inference[];
}

export interface KeyRelationship {
  target: string;
  type: string;
  impact: string;
}

export interface Inference {
  content: string;
  basis: string;
  is_inference: true;
  chapter?: number;
}

// ===== 关系相关 =====
export interface Relation {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: string;
  sinceChapter: number;
  untilChapter: number | null;
  strength: number;
  isInference: boolean;
  inferenceBasis?: string;
  description: string;
  novelId: string;
}

// ===== 事件相关 =====
export interface Event {
  id: string;
  name: string;
  chapter: number;
  summary: string;
  eventType: string;
  participantIds: string[];
  novelId: string;
}

// ===== 文本指纹段 =====
export interface TextSegment {
  id: string;
  contentHash: string;
  startOffset: number;
  endOffset: number;
  stepCreated: number;
  novelId: string;
}

// ===== AI 配置 =====
export interface AiConfig {
  apiUrl: string;
  apiKeyEncrypted: string;
  model: string;
  contextSize: number;
  temperature: number;
  maxTokens: number;
  updatedAt: string;
}

export interface AiConfigPublic {
  apiUrl: string;
  apiKeyMasked: string;
  model: string;
  contextSize: number;
  temperature: number;
  maxTokens: number;
  updatedAt: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextLength?: number;
  tags: string[];
}

// ===== 构建配置 =====
export interface BuildConfig {
  maxRetries: number;
  showCostEstimate: boolean;
  maxConcurrentAiCalls: number;
  enableInference: boolean;
}

// ===== 任务相关 =====
export type TaskStatus = 'pending' | 'running' | 'canceling' | 'canceled' | 'completed' | 'failed';

export interface BuildTask {
  novelId: string;
  status: TaskStatus;
  currentStep: number;
  totalSteps: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface StepProgress {
  stepNumber: number;
  phase: 'extracting' | 'disambiguating' | 'merging' | 'conflict_detecting' | 'profile_updating' | 'snapshot_saving';
  message: string;
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
}

// ===== 成本预估 =====
export interface CostEstimate {
  estimatedCalls: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
}

// ===== 快照相关 =====
export interface Snapshot {
  step: number;
  chaptersCovered: number[];
  totalCharsCovered: number;
  totalTokensCovered: number;
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
  events: Event[];
  createdAt: string;
}

export interface SnapshotNode {
  id: string;
  name: string;
  aliases: string[];
  isProtagonist: boolean;
  firstAppearChapter: number;
}

export interface SnapshotEdge {
  source: string;
  target: string;
  relationType: string;
  sinceChapter: number;
  untilChapter: number | null;
  strength: number;
  isInference: boolean;
}

// ===== 冲突相关 =====
export interface Conflict {
  id: string;
  conflictType: 'attribute' | 'relation';
  characterId: string;
  chapters: number[];
  descriptions: string[];
  resolved: boolean;
  resolvedValue?: string;
}

// ===== 写操作日志 =====
export interface WriteLogEntry {
  action: 'create_node' | 'create_edge' | 'update_node' | 'update_edge' | 'delete_node' | 'delete_edge';
  label: string;
  id: string;
  field?: string;
  value?: any;
  added?: any;
}

// ===== API 请求/响应 =====
export interface UploadRequest {
  hasChapter: boolean;
}

export interface TextPasteRequest {
  content: string;
  novelName?: string;
}

export interface BuildRequest {
  contextSize?: number;
}

export interface RollbackRequest {
  targetStep: number;
}

export interface MergeCharactersRequest {
  characterIds: string[];
  primaryId: string;
}

export interface SplitCharacterRequest {
  characterId: string;
  splitInfo: { name: string; aliases: string[] }[];
}

export interface ResolveConflictRequest {
  resolvedValue: string;
}

export interface SaveAiConfigRequest {
  apiUrl: string;
  apiKey: string;
  model: string;
  contextSize?: number;
  temperature?: number;
  maxTokens?: number;
}

export interface SaveBuildConfigRequest {
  maxRetries?: number;
  showCostEstimate?: boolean;
  maxConcurrentAiCalls?: number;
  enableInference?: boolean;
}

export interface GraphQueryParams {
  center?: string;
  step?: number;
}
