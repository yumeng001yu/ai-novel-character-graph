import React from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu } from 'antd';
import { BookOutlined, ApartmentOutlined, UserOutlined, SettingOutlined, ThunderboltOutlined, CloudUploadOutlined } from '@ant-design/icons';
import Home from './pages/Home';
import Graph from './pages/Graph';
import Character from './pages/Character';
import Continue from './pages/Continue';
import Task from './pages/Task';
import Settings from './pages/Settings';

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

const App: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentKey = pathToKey[location.pathname] || 'home';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ color: '#fff', fontSize: 18, fontWeight: 'bold', marginRight: 40 }}>
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
        />
      </Header>
      <Content style={{ padding: '24px', background: '#f5f5f5' }}>
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
