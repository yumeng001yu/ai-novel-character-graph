import type { ThemeConfig } from 'antd';

export type ThemeKey = 'ink' | 'neon' | 'tech' | 'light' | 'dark';

export interface ThemePreset {
  key: ThemeKey;
  label: string;
  color: string; // 代表色，用于切换按钮展示
  antTheme: ThemeConfig;
  layoutBg: string;
  contentBg: string;
  headerBg: string;
  headerText: string;
  graphBg: string;
  inferenceBg: string;
  inferenceBorder: string;
  inferenceColor: string;
}

export const themePresets: Record<ThemeKey, ThemePreset> = {
  ink: {
    key: 'ink',
    label: '古墨',
    color: '#5b8c5a',
    antTheme: {
      token: {
        colorPrimary: '#5b8c5a',
        colorBgContainer: '#f7f4ef',
        colorBgLayout: '#ebe6db',
        colorBorder: '#c4b99a',
        colorText: '#3a3a2e',
        colorTextSecondary: '#7a7a6e',
        borderRadius: 4,
        fontFamily: '"Noto Serif SC", "SimSun", serif',
      },
      components: {
        Menu: { darkItemBg: '#3a3a2e', darkItemSelectedBg: '#5b8c5a' },
        Card: { colorBgContainer: '#f7f4ef' },
      },
    },
    layoutBg: '#ebe6db',
    contentBg: '#ebe6db',
    headerBg: '#3a3a2e',
    headerText: '#f7f4ef',
    graphBg: '#f7f4ef',
    inferenceBg: '#eef5ec',
    inferenceBorder: '#a3c9a0',
    inferenceColor: '#5b8c5a',
  },

  neon: {
    key: 'neon',
    label: '霓虹',
    color: '#ff2d78',
    antTheme: {
      token: {
        colorPrimary: '#ff2d78',
        colorBgContainer: '#1a1a2e',
        colorBgLayout: '#0f0f1a',
        colorBorder: '#333355',
        colorText: '#e0e0f0',
        colorTextSecondary: '#9999bb',
        borderRadius: 8,
      },
      components: {
        Menu: { darkItemBg: '#1a1a2e', darkItemSelectedBg: '#ff2d78' },
        Card: { colorBgContainer: '#1a1a2e', colorBorderSecondary: '#333355' },
        Input: { colorBgContainer: '#1a1a2e', colorBorder: '#333355' },
        Select: { colorBgContainer: '#1a1a2e', colorBorder: '#333355' },
        Button: { colorBgContainer: '#1a1a2e' },
      },
      algorithm: undefined, // will be set in component
    },
    layoutBg: '#0f0f1a',
    contentBg: '#0f0f1a',
    headerBg: '#0d0d18',
    headerText: '#ff2d78',
    graphBg: '#1a1a2e',
    inferenceBg: '#2a1a2e',
    inferenceBorder: '#ff2d78',
    inferenceColor: '#ff6fa8',
  },

  tech: {
    key: 'tech',
    label: '科技',
    color: '#00d4ff',
    antTheme: {
      token: {
        colorPrimary: '#00d4ff',
        colorBgContainer: '#141e30',
        colorBgLayout: '#0a1628',
        colorBorder: '#1e3a5f',
        colorText: '#c8e6ff',
        colorTextSecondary: '#6b9bc0',
        borderRadius: 6,
      },
      components: {
        Menu: { darkItemBg: '#141e30', darkItemSelectedBg: '#00d4ff' },
        Card: { colorBgContainer: '#141e30', colorBorderSecondary: '#1e3a5f' },
        Input: { colorBgContainer: '#141e30', colorBorder: '#1e3a5f' },
        Select: { colorBgContainer: '#141e30', colorBorder: '#1e3a5f' },
        Button: { colorBgContainer: '#141e30' },
      },
    },
    layoutBg: '#0a1628',
    contentBg: '#0a1628',
    headerBg: '#0a1220',
    headerText: '#00d4ff',
    graphBg: '#141e30',
    inferenceBg: '#0d2a3a',
    inferenceBorder: '#00d4ff',
    inferenceColor: '#00d4ff',
  },

  light: {
    key: 'light',
    label: '明亮',
    color: '#1677ff',
    antTheme: {
      token: {
        colorPrimary: '#1677ff',
        colorBgContainer: '#ffffff',
        colorBgLayout: '#f5f5f5',
        colorBorder: '#d9d9d9',
        colorText: '#333333',
        colorTextSecondary: '#888888',
        borderRadius: 6,
      },
      components: {
        Menu: { darkItemBg: '#001529', darkItemSelectedBg: '#1677ff' },
        Card: { colorBgContainer: '#ffffff' },
      },
    },
    layoutBg: '#f5f5f5',
    contentBg: '#f5f5f5',
    headerBg: '#001529',
    headerText: '#ffffff',
    graphBg: '#ffffff',
    inferenceBg: '#e6f7ff',
    inferenceBorder: '#91d5ff',
    inferenceColor: '#1677ff',
  },

  dark: {
    key: 'dark',
    label: '暗黑',
    color: '#8b8bff',
    antTheme: {
      token: {
        colorPrimary: '#8b8bff',
        colorBgContainer: '#1f1f1f',
        colorBgLayout: '#141414',
        colorBorder: '#434343',
        colorText: '#e0e0e0',
        colorTextSecondary: '#8c8c8c',
        borderRadius: 6,
      },
      components: {
        Menu: { darkItemBg: '#1f1f1f', darkItemSelectedBg: '#8b8bff' },
        Card: { colorBgContainer: '#1f1f1f', colorBorderSecondary: '#434343' },
        Input: { colorBgContainer: '#1f1f1f', colorBorder: '#434343' },
        Select: { colorBgContainer: '#1f1f1f', colorBorder: '#434343' },
        Button: { colorBgContainer: '#1f1f1f' },
      },
    },
    layoutBg: '#141414',
    contentBg: '#141414',
    headerBg: '#111111',
    headerText: '#e0e0e0',
    graphBg: '#1f1f1f',
    inferenceBg: '#2a2a3a',
    inferenceBorder: '#8b8bff',
    inferenceColor: '#b0b0ff',
  },
};

/** 暗色主题 key 列表，用于判断是否使用 dark algorithm */
export const darkThemeKeys: ThemeKey[] = ['neon', 'tech', 'dark'];

export function isDarkTheme(key: ThemeKey): boolean {
  return darkThemeKeys.includes(key);
}

const STORAGE_KEY = 'novelgraph-theme';

export function getStoredTheme(): ThemeKey {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && themePresets[stored as ThemeKey]) return stored as ThemeKey;
  } catch {}
  return 'light';
}

export function setStoredTheme(key: ThemeKey): void {
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {}
}
