import React from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Dropdown, Button } from 'antd';
import { CloudUploadOutlined, DatabaseOutlined, ThunderboltOutlined, SettingOutlined, BgColorsOutlined } from '@ant-design/icons';
import Import from './pages/Import';
import Knowledge from './pages/Knowledge';
import NovelDetail from './pages/NovelDetail';
import Task from './pages/Task';
import Settings from './pages/Settings';
import { ThemeKey, themePresets } from './themes';

const { Header, Content } = Layout;

const menuItems = [
  { key: 'import', icon: <CloudUploadOutlined />, label: '导入', path: '/import' },
  { key: 'knowledge', icon: <DatabaseOutlined />, label: '知识库', path: '/knowledge' },
  { key: 'task', icon: <ThunderboltOutlined />, label: '构建', path: '/task' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置', path: '/settings' },
];

const pathToKey: Record<string, string> = {
  '/import': 'import',
  '/knowledge': 'knowledge',
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

  // 对于 /novel/:id 路径，高亮知识库菜单
  const currentKey = location.pathname.startsWith('/novel/')
    ? 'knowledge'
    : (pathToKey[location.pathname] || 'import');
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
          <Route path="/import" element={<Import />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/novel/:id" element={<NovelDetail />} />
          <Route path="/task" element={<Task />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/import" />} />
        </Routes>
      </Content>
    </Layout>
  );
};

export default App;
