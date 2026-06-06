import React, { useState, useEffect } from 'react';
import { Card, Input, Button, Descriptions, Timeline, Tag, Table, Space, message, Select } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { searchCharacters, getCharacterTimeline, getNovels } from '../../services/api';

const Character: React.FC = () => {
  const [novels, setNovels] = useState<any[]>([]);
  const [novelId, setNovelId] = useState<string>('');
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [selectedChar, setSelectedChar] = useState<any>(null);
  const [timeline, setTimeline] = useState<any>(null);

  useEffect(() => {
    loadNovels();
  }, []);

  const loadNovels = async () => {
    try {
      const res = await getNovels();
      setNovels(res.data || []);
    } catch (err) {
      message.error('加载小说列表失败');
    }
  };

  const handleSearch = async () => {
    if (!novelId || !keyword) return message.warning('请选择小说并输入关键词');
    try {
      const res = await searchCharacters(novelId, keyword);
      setResults(res.data || []);
    } catch (err) {
      message.error('搜索失败');
    }
  };

  const handleSelect = async (char: any) => {
    setSelectedChar(char);
    try {
      const res = await getCharacterTimeline(char.id);
      setTimeline(res.data);
    } catch (err) {
      message.error('加载角色时间线失败');
    }
  };

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <Card title="角色搜索" style={{ flex: 1 }}>
        <Space style={{ marginBottom: 16, width: '100%' }} wrap>
          <Select style={{ width: 200 }} placeholder="选择小说" value={novelId || undefined}
            onChange={setNovelId}
            options={novels.map((n: any) => ({ label: n.name, value: n.id }))} />
          <Input placeholder="角色名/别名" value={keyword} onChange={e => setKeyword(e.target.value)} onPressEnter={handleSearch} style={{ width: 200 }} />
          <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>搜索</Button>
        </Space>
        <Table columns={[
          { title: '名字', dataIndex: 'name' },
          { title: '别名', dataIndex: 'aliases', render: (v: string[]) => v?.map(a => <Tag key={a}>{a}</Tag>) },
          { title: '身份', dataIndex: 'identity' },
          { title: '主角', dataIndex: 'isProtagonist', render: (v: boolean) => v ? <Tag color="red">主角</Tag> : null },
        ]} dataSource={results} rowKey="id" onRow={(record) => ({ onClick: () => handleSelect(record), style: { cursor: 'pointer' } })} />
      </Card>

      {selectedChar && (
        <Card title={selectedChar.name} className="character-detail-card" style={{ flex: 1 }}>
          <Descriptions column={1} size="small">
            <Descriptions.Item label="别名">{selectedChar.aliases?.join('、')}</Descriptions.Item>
            <Descriptions.Item label="性别">{selectedChar.gender}</Descriptions.Item>
            <Descriptions.Item label="阵营">{selectedChar.faction}</Descriptions.Item>
            <Descriptions.Item label="身份">{selectedChar.identity}</Descriptions.Item>
            <Descriptions.Item label="首次出场">第{selectedChar.firstAppearChapter}章</Descriptions.Item>
          </Descriptions>

          {timeline?.personalAnalysis && (
            <>
              <h4 style={{ marginTop: 16 }}>个人解析</h4>
              <p><b>角色弧线：</b>{timeline.personalAnalysis.characterArc}</p>
              <p><b>性格特征：</b>{timeline.personalAnalysis.personality}</p>
              <p><b>核心动机：</b>{timeline.personalAnalysis.motivation}</p>

              {timeline.personalAnalysis.inferences?.length > 0 && (
                <>
                  <h4>推断 <Tag color="blue">推断</Tag></h4>
                  {timeline.personalAnalysis.inferences.map((inf: any, i: number) => (
                    <div key={i} style={{ marginBottom: 8, padding: 8, background: '#e6f7ff', borderRadius: 4 }}>
                      <div>{inf.content} <Tag color="blue">推断</Tag></div>
                      <div style={{ fontSize: 12, color: '#666' }}>依据：{inf.basis}</div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {timeline?.experienceTimeline?.length > 0 && (
            <>
              <h4 style={{ marginTop: 16 }}>经历时间线</h4>
              <Timeline items={timeline.experienceTimeline.map((e: any) => ({
                children: <div>第{e.chapter}章：{e.event} <Tag>{e.type}</Tag></div>,
              }))} />
            </>
          )}
        </Card>
      )}
    </div>
  );
};

export default Character;
