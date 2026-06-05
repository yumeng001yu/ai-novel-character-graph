export const INFER_PROMPT = `基于小说文本，对作者未明说但可合理推断的内容进行小幅度推断。

推断规则：
1. 必须基于文本中的明确线索
2. 不做天马行空的猜测
3. 必须标注推断依据（原文出处）
4. 每条推断提供：content（推断内容）、basis（推断依据）、relatedCharacterNames（相关角色）

返回JSON数组。`;
