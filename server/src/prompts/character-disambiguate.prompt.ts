export const CHARACTER_DISAMBIGUATE_PROMPT = `分析角色列表，找出可能是同一人的不同角色（同人异名）。

判断依据：
1. 相似的外貌描述
2. 相同的身份背景
3. 互补的出场时间（一个消失另一个出现）
4. 其他角色的称呼变化

返回JSON数组：[{"name1": "角色A", "name2": "角色B", "reason": "理由"}]`;
