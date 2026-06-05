import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout, Menu } from 'antd';
import { BookOutlined, ApartmentOutlined, UserOutlined, SettingOutlined, ThunderboltOutlined, CloudUploadOutlined } from '@ant-design/icons';
import Home from './pages/Home';
import Graph from './pages/Graph';
import Character from './pages/Character';
import Continue from './pages/Continue';
import Task from './pages/Task';
import Settings from './pages/Settings';

const { Header, Content } = Layout;

const App: React.FC = () => {
  const [current, setCurrent] = React.useState('home');

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ color: '#fff', fontSize: 18, fontWeight: 'bold', marginRight: 40 }}>
          AI 小说角色图谱
        </div>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[current]}
          onClick={(e) => setCurrent(e.key)}
          items={[
            { key: 'home', icon: <CloudUploadOutlined />, label: '首页' },
            { key: 'graph', icon: <ApartmentOutlined />, label: '图谱' },
            { key: 'character', icon: <UserOutlined />, label: '角色' },
            { key: 'continue', icon: <BookOutlined />, label: '续建' },
            { key: 'task', icon: <ThunderboltOutlined />, label: '任务' },
            { key: 'settings', icon: <SettingOutlined />, label: '设置' },
          ]}
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
