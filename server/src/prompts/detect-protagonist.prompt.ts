export const DETECT_PROTAGONIST_PROMPT = `分析角色列表，判断哪些是小说的主角。判断依据：
1. 出场频率
2. 剧情推动力
3. 视角占比
4. 核心事件参与度

返回JSON数组，按重要性排序：[{"name": "角色名", "isProtagonist": true, "reason": "理由"}]`;
