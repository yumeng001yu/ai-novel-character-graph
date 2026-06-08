import React, { useState } from 'react';
import { Input, Button, Descriptions, Timeline, Tag, Table, Space, message, theme } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { searchCharacters, getCharacterTimeline } from '../../services/api';

interface Props {
  novelId: string;
}

const CharacterTab: React.FC<Props> = ({ novelId }) => {
  const { token: themeToken } = theme.useToken();
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [selectedChar, setSelectedChar] = useState<any>(null);
  const [timeline, setTimeline] = useState<any>(null);

  const handleSearch = async () => {
    if (!novelId || !keyword) return message.warning('请输入关键词');
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
      <div style={{ flex: 1 }}>
        <Space style={{ marginBottom: 16, width: '100%' }} wrap>
          <Input placeholder="角色名/别名" value={keyword} onChange={e => setKeyword(e.target.value)} onPressEnter={handleSearch} style={{ width: 200 }} />
          <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>搜索</Button>
        </Space>
        <Table columns={[
          { title: '名字', dataIndex: 'name' },
          { title: '别名', dataIndex: 'aliases', render: (v: string[]) => v?.map(a => <Tag key={a}>{a}</Tag>) },
          { title: '身份', dataIndex: 'identity' },
          { title: '主角', dataIndex: 'isProtagonist', render: (v: boolean) => v ? <Tag color="red">主角</Tag> : null },
        ]} dataSource={results} rowKey="id" onRow={(record) => ({ onClick: () => handleSelect(record), style: { cursor: 'pointer' } })} />
      </div>

      {selectedChar && (
        <div style={{ flex: 1 }} className="character-detail-card">
          <h3>{selectedChar.name}</h3>
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
                    <div key={i} style={{ marginBottom: 8, padding: 8, background: themeToken.colorInfoBg, borderRadius: 4 }}>
                      <div>{inf.content} <Tag color="blue">推断</Tag></div>
                      <div style={{ fontSize: 12, color: themeToken.colorTextSecondary }}>依据：{inf.basis}</div>
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
        </div>
      )}
    </div>
  );
};

export default CharacterTab;
