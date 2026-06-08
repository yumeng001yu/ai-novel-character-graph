import React from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Dropdown, Button } from 'antd';
import { BookOutlined, ApartmentOutlined, UserOutlined, SettingOutlined, ThunderboltOutlined, CloudUploadOutlined, BgColorsOutlined } from '@ant-design/icons';
import Home from './pages/Home';
import Graph from './pages/Graph';
import Character from './pages/Character';
import Continue from './pages/Continue';
import Task from './pages/Task';
import Settings from './pages/Settings';
import { ThemeKey, themePresets } from './themes';

const { Header, Content } = Layout;

const menuItems = [
  { key: 'home', icon: <CloudUploadOutlined />, label: '首页', path: '/' },
  { key: 'graph', icon: <ApartmentOutlined />, label: '图谱', path: '/graph' },
  { key: 'character', icon: <UserOutlined />, label: '角色', path: '/character' },
  { key: 'continue', icon: <BookOutlined />, label: '续建', path: '/continue' },
  { key: 'task', icon: <ThunderboltOutlined />, label: '任务', path: '/task' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置', path: '/settings' },
];

const pathToKey: Record<string, string> = {
  '/': 'home',
  '/graph': 'graph',
  '/character': 'character',
  '/continue': 'continue',
  '/task': 'task',
  '/settings': 'settings',
};

interface AppProps {
  themeKey: ThemeKey;
  setThemeKey: (key: ThemeKey) => void;
}

const App: React.FC<AppProps> = ({ themeKey, setThemeKey }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentKey = pathToKey[location.pathname] || 'home';
  const preset = themePresets[themeKey];

  const themeMenuItems = Object.values(themePresets).map(t => ({
    key: t.key,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          display: 'inline-block',
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: t.color,
          border: t.key === themeKey ? '2px solid #fff' : '1px solid #666',
          boxShadow: t.key === themeKey ? `0 0 6px ${t.color}` : 'none',
        }} />
        <span>{t.label}</span>
        {t.key === themeKey && <span style={{ color: t.color, fontSize: 12 }}>✓</span>}
      </div>
    ),
  }));

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{
        display: 'flex',
        alignItems: 'center',
        background: preset.headerBg,
        padding: '0 24px',
      }}>
        <div style={{ color: preset.headerText, fontSize: 18, fontWeight: 'bold', marginRight: 32, whiteSpace: 'nowrap' }}>
          AI 小说角色图谱
        </div>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[currentKey]}
          onClick={(e) => {
            const item = menuItems.find(m => m.key === e.key);
            if (item) navigate(item.path);
          }}
          items={menuItems}
          style={{ flex: 1, background: 'transparent' }}
        />
        <Dropdown
          menu={{
            items: themeMenuItems,
            onClick: ({ key }) => setThemeKey(key as ThemeKey),
            selectedKeys: [themeKey],
          }}
          placement="bottomRight"
        >
          <Button
            type="text"
            icon={<BgColorsOutlined />}
            style={{ color: preset.headerText, fontSize: 18 }}
          />
        </Dropdown>
      </Header>
      <Content style={{ padding: '24px', background: preset.contentBg }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/graph" element={<Graph />} />
          <Route path="/character" element={<Character />} />
          <Route path="/continue" element={<Continue />} />
          <Route path="/task" element={<Task />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Content>
    </Layout>
  );
};

export default App;
