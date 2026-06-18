import { create } from 'zustand';

interface AppState {
  // 当前选中的小说
  currentNovelId: string | null;
  setCurrentNovelId: (id: string | null) => void;

  // 当前选中的角色
  selectedCharacterIds: string[];
  setSelectedCharacterIds: (ids: string[]) => void;

  // 侧边栏状态
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // AI 配置状态
  aiConfigured: boolean;
  setAiConfigured: (v: boolean) => void;

  // 当前提示词预设
  currentPresetId: string | null;
  setCurrentPresetId: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentNovelId: null,
  setCurrentNovelId: (id) => set({ currentNovelId: id }),
  selectedCharacterIds: [],
  setSelectedCharacterIds: (ids) => set({ selectedCharacterIds: ids }),
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  aiConfigured: false,
  setAiConfigured: (v) => set({ aiConfigured: v }),
  currentPresetId: null,
  setCurrentPresetId: (id) => set({ currentPresetId: id }),
}));
