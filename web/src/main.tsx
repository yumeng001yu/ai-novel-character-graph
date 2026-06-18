import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme as antTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { QueryProvider } from './providers/QueryProvider';
import { ThemeKey, themePresets, getStoredTheme, setStoredTheme, isDarkTheme } from './themes';
import './styles/global.css';

const Root: React.FC = () => {
  const [themeKey, setThemeKey] = useState<ThemeKey>(getStoredTheme);

  useEffect(() => {
    setStoredTheme(themeKey);
    // 更新 body 背景色，避免切换时闪烁
    const preset = themePresets[themeKey];
    document.body.style.background = preset.layoutBg;
    document.body.style.color = preset.antTheme.token?.colorText as string || '#333';
  }, [themeKey]);

  const preset = themePresets[themeKey];
  const antThemeConfig = {
    ...preset.antTheme,
    algorithm: isDarkTheme(themeKey) ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
  };

  return (
    <ConfigProvider locale={zhCN} theme={antThemeConfig}>
      <BrowserRouter basename="/novelgraph">
        <App themeKey={themeKey} setThemeKey={setThemeKey} />
      </BrowserRouter>
    </ConfigProvider>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryProvider>
      <Root />
    </QueryProvider>
  </React.StrictMode>
);
