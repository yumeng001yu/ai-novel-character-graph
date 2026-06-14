/**
 * 自动化测试基准：评估图谱构建质量
 *
 * 用法: npx ts-node scripts/benchmark.ts [novelId]
 *
 * 评估指标：
 * 1. 角色识别完整性（已知角色 vs 识别角色）
 * 2. 关系覆盖率（已知关系 vs 识别关系）
 * 3. Profile 覆盖率（有 profile/keyTraits 的角色比例）
 * 4. 关系置信度分布
 * 5. GraphRAG 回答质量（基于预设问答对）
 * 6. 向量搜索召回率
 */

import axios from 'axios';

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';

interface BenchmarkConfig {
  novelId: string;
  /** 已知角色列表（用于评估识别完整性） */
  expectedCharacters: string[];
  /** 已知关系对（用于评估关系覆盖率） */
  expectedRelations: Array<{ source: string; target: string; type: string }>;
  /** 预设问答对（用于评估 GraphRAG 回答质量） */
  testQuestions: Array<{ question: string; expectedKeywords: string[] }>;
}

// 红楼梦前5回测试基准
const HONGLOUMENG_5CH_BENCHMARK: BenchmarkConfig = {
  novelId: '',
  expectedCharacters: [
    '贾宝玉', '林黛玉', '薛宝钗', '王熙凤', '贾母',
    '贾政', '贾赦', '邢夫人', '王夫人', '贾雨村',
    '甄士隐', '冷子兴', '袭人', '晴雯', '贾琏',
    '刘姥姥', '薛姨妈', '香菱', '贾珍', '贾蓉',
  ],
  expectedRelations: [
    { source: '贾宝玉', target: '林黛玉', type: '表兄妹' },
    { source: '贾宝玉', target: '贾政', type: '父子' },
    { source: '贾宝玉', target: '贾母', type: '祖孙' },
    { source: '贾政', target: '王夫人', type: '夫妻' },
    { source: '贾赦', target: '邢夫人', type: '夫妻' },
    { source: '贾琏', target: '王熙凤', type: '夫妻' },
    { source: '林黛玉', target: '贾母', type: '外祖孙' },
    { source: '薛宝钗', target: '薛姨妈', type: '母女' },
    { source: '贾雨村', target: '贾政', type: '同宗' },
    { source: '甄士隐', target: '贾雨村', type: '资助' },
  ],
  testQuestions: [
    { question: '王熙凤是什么样的人？', expectedKeywords: ['精明', '能干', '泼辣', '贾府', '管家'] },
    { question: '什么是护官符？', expectedKeywords: ['四大家族', '贾', '史', '王', '薛'] },
    { question: '贾宝玉和林黛玉是什么关系？', expectedKeywords: ['表兄妹', '贾母', '林如海'] },
    { question: '贾雨村的经历是什么？', expectedKeywords: ['进士', '知府', '革职', '贾政'] },
  ],
};

interface BenchmarkResult {
  characterRecall: { found: number; total: number; rate: number; missing: string[] };
  relationRecall: { found: number; total: number; rate: number; missing: Array<{ source: string; target: string; type: string }> };
  profileCoverage: { withProfile: number; withKeyTraits: number; total: number; rate: number };
  confidenceStats: { avg: number; high: number; medium: number; low: number; total: number };
  graphragQuality: Array<{ question: string; keywordHitRate: number; hitKeywords: string[]; missedKeywords: string[] }>;
  overallScore: number;
}

async function runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResult> {
  const novelId = config.novelId;

  // 1. 获取图谱数据
  const graphResp = await axios.get(`${API_BASE}/novels/${novelId}/graph`);
  const { nodes, edges } = graphResp.data;

  // 2. 获取统计数据
  const statsResp = await axios.get(`${API_BASE}/novels/${novelId}/stats`);
  const stats = statsResp.data;

  // 3. 角色识别完整性
  const foundChars: string[] = [];
  const missingChars: string[] = [];
  for (const expected of config.expectedCharacters) {
    const found = nodes.some((n: any) =>
      n.name === expected || n.aliases?.some((a: string) => a === expected)
    );
    if (found) foundChars.push(expected);
    else missingChars.push(expected);
  }

  // 4. 关系覆盖率
  const foundRels: Array<{ source: string; target: string; type: string }> = [];
  const missingRels: Array<{ source: string; target: string; type: string }> = [];
  for (const expected of config.expectedRelations) {
    const found = edges.some((e: any) => {
      const srcName = e.sourceName || '';
      const tgtName = e.targetName || '';
      const rtype = e.relationType || '';
      return (
        (srcName === expected.source && tgtName === expected.target) ||
        (srcName === expected.target && tgtName === expected.source)
      ) && (rtype.includes(expected.type) || expected.type.includes(rtype));
    });
    if (found) foundRels.push(expected);
    else missingRels.push(expected);
  }

  // 5. Profile 覆盖率
  const withProfile = nodes.filter((n: any) => n.profile).length;
  const withKeyTraits = nodes.filter((n: any) => n.keyTraits?.length > 0).length;

  // 6. 关系置信度统计
  const confStats = stats.relationStats || {};

  // 7. GraphRAG 回答质量
  const graphragResults: Array<{ question: string; keywordHitRate: number; hitKeywords: string[]; missedKeywords: string[] }> = [];
  for (const q of config.testQuestions) {
    try {
      const resp = await axios.post(`${API_BASE}/graphrag/${novelId}/query`, {
        question: q.question,
      });
      const answer = resp.data.answer || '';
      const hitKeywords: string[] = [];
      const missedKeywords: string[] = [];
      for (const kw of q.expectedKeywords) {
        if (answer.includes(kw)) hitKeywords.push(kw);
        else missedKeywords.push(kw);
      }
      graphragResults.push({
        question: q.question,
        keywordHitRate: hitKeywords.length / q.expectedKeywords.length,
        hitKeywords,
        missedKeywords,
      });
    } catch (err: any) {
      graphragResults.push({
        question: q.question,
        keywordHitRate: 0,
        hitKeywords: [],
        missedKeywords: q.expectedKeywords,
      });
    }
  }

  // 8. 计算综合评分
  const charScore = foundChars.length / config.expectedCharacters.length * 25;
  const relScore = foundRels.length / config.expectedRelations.length * 25;
  const profileScore = (withProfile / Math.max(nodes.length, 1)) * 25;
  const graphragScore = graphragResults.reduce((sum, r) => sum + r.keywordHitRate, 0) /
    Math.max(graphragResults.length, 1) * 25;
  const overallScore = Math.round(charScore + relScore + profileScore + graphragScore);

  return {
    characterRecall: {
      found: foundChars.length,
      total: config.expectedCharacters.length,
      rate: foundChars.length / config.expectedCharacters.length,
      missing: missingChars,
    },
    relationRecall: {
      found: foundRels.length,
      total: config.expectedRelations.length,
      rate: foundRels.length / config.expectedRelations.length,
      missing: missingRels,
    },
    profileCoverage: {
      withProfile,
      withKeyTraits,
      total: nodes.length,
      rate: withProfile / Math.max(nodes.length, 1),
    },
    confidenceStats: {
      avg: confStats.avgConfidence || 0,
      high: confStats.confidenceDistribution?.high || 0,
      medium: confStats.confidenceDistribution?.medium || 0,
      low: confStats.confidenceDistribution?.low || 0,
      total: edges.length,
    },
    graphragQuality: graphragResults,
    overallScore,
  };
}

function printResult(result: BenchmarkResult): void {
  console.log('\n' + '='.repeat(60));
  console.log('  图谱构建质量评估报告');
  console.log('='.repeat(60));

  // 角色识别
  console.log('\n【角色识别完整性】');
  console.log(`  识别率: ${result.characterRecall.found}/${result.characterRecall.total} (${(result.characterRecall.rate * 100).toFixed(1)}%)`);
  if (result.characterRecall.missing.length > 0) {
    console.log(`  缺失角色: ${result.characterRecall.missing.join('、')}`);
  }

  // 关系覆盖
  console.log('\n【关系覆盖率】');
  console.log(`  覆盖率: ${result.relationRecall.found}/${result.relationRecall.total} (${(result.relationRecall.rate * 100).toFixed(1)}%)`);
  if (result.relationRecall.missing.length > 0) {
    console.log(`  缺失关系:`);
    for (const r of result.relationRecall.missing) {
      console.log(`    ${r.source} → ${r.target} (${r.type})`);
    }
  }

  // Profile 覆盖
  console.log('\n【Profile 覆盖率】');
  console.log(`  有 Profile: ${result.profileCoverage.withProfile}/${result.profileCoverage.total} (${(result.profileCoverage.rate * 100).toFixed(1)}%)`);
  console.log(`  有 KeyTraits: ${result.profileCoverage.withKeyTraits}/${result.profileCoverage.total}`);

  // 置信度
  console.log('\n【关系置信度分布】');
  console.log(`  平均置信度: ${result.confidenceStats.avg.toFixed(3)}`);
  console.log(`  高(>0.9): ${result.confidenceStats.high}  中(0.7-0.9): ${result.confidenceStats.medium}  低(<0.7): ${result.confidenceStats.low}`);
  console.log(`  总关系数: ${result.confidenceStats.total}`);

  // GraphRAG
  console.log('\n【GraphRAG 回答质量】');
  for (const r of result.graphragQuality) {
    const status = r.keywordHitRate >= 0.6 ? '✓' : '✗';
    console.log(`  ${status} "${r.question}"`);
    console.log(`    关键词命中: ${r.hitKeywords.length}/${r.hitKeywords.length + r.missedKeywords.length} (${(r.keywordHitRate * 100).toFixed(0)}%)`);
    if (r.hitKeywords.length > 0) console.log(`    命中: ${r.hitKeywords.join('、')}`);
    if (r.missedKeywords.length > 0) console.log(`    缺失: ${r.missedKeywords.join('、')}`);
  }

  // 综合评分
  console.log('\n' + '-'.repeat(60));
  const grade = result.overallScore >= 90 ? 'A' : result.overallScore >= 75 ? 'B' : result.overallScore >= 60 ? 'C' : 'D';
  console.log(`  综合评分: ${result.overallScore}/100 (等级: ${grade})`);
  console.log('='.repeat(60) + '\n');
}

// 主函数
async function main() {
  const novelId = process.argv[2];
  if (!novelId) {
    console.error('用法: npx ts-node scripts/benchmark.ts <novelId>');
    console.error('  或: API_BASE=http://host:port npx ts-node scripts/benchmark.ts <novelId>');
    process.exit(1);
  }

  const config: BenchmarkConfig = {
    ...HONGLOUMENG_5CH_BENCHMARK,
    novelId,
  };

  console.log(`正在评估小说 ${novelId} 的图谱构建质量...`);
  console.log(`API 地址: ${API_BASE}`);

  try {
    const result = await runBenchmark(config);
    printResult(result);

    // 输出 JSON 格式结果（可被其他工具解析）
    const jsonPath = `/tmp/benchmark_${novelId.substring(0, 8)}.json`;
    const fs = await import('fs');
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
    console.log(`详细结果已保存到: ${jsonPath}`);
  } catch (err: any) {
    console.error('评估失败:', err.message);
    process.exit(1);
  }
}

main();
