export const CHAPTER_SPLIT_PROMPT = `分析以下小说文本，识别章节边界。支持以下格式：
- "第X章 标题"
- "Chapter X"
- 数字编号
- 空行分隔

返回JSON数组：[{"title": "章节标题", "startText": "章节开头几个字"}]`;
