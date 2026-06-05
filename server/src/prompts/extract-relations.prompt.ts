export const EXTRACT_RELATIONS_PROMPT = `从小说文本中提取人物间的关系。关系类型包括：
亲情、友情、敌对、恋爱、从属、师徒、同门、盟友等。

对每条关系提供：
- sourceName: 角色A
- targetName: 角色B
- relationType: 关系类型
- description: 关系描述
- isInference: 是否为推断
- inferenceBasis: 推断依据（如果isInference为true）

返回JSON数组。`;
