import { create } from 'zustand';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  characterName?: string;
  timestamp: number;
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  currentMode: 'chat' | 'group' | 'dialogue';
  presetId: string | null;

  addMessage: (msg: ChatMessage) => void;
  updateLastMessage: (content: string) => void;
  clearMessages: () => void;
  setIsStreaming: (v: boolean) => void;
  setMode: (mode: 'chat' | 'group' | 'dialogue') => void;
  setPresetId: (id: string | null) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isStreaming: false,
  currentMode: 'chat',
  presetId: null,

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  updateLastMessage: (content) => set((s) => ({
    messages: s.messages.map((m, i) =>
      i === s.messages.length - 1 ? { ...m, content } : m
    ),
  })),
  clearMessages: () => set({ messages: [] }),
  setIsStreaming: (v) => set({ isStreaming: v }),
  setMode: (mode) => set({ currentMode: mode }),
  setPresetId: (id) => set({ presetId: id }),
}));
