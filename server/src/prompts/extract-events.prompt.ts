export const EXTRACT_EVENTS_PROMPT = `从小说文本中提取关键事件。对每个事件提供：
- name: 事件名
- chapter: 所在章节
- summary: 事件摘要
- eventType: 事件类型（转折点/成长/危机/日常）
- participantNames: 参与者名字列表

返回JSON数组。`;
