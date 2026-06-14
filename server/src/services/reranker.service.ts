import axios from 'axios';
import { RerankerConfig, RerankerConfigPublic, SaveRerankerConfigRequest, RerankResult } from '../types';
import { encrypt, decrypt, maskApiKey } from '../utils/crypto';
import { getLogger } from '../utils/logger';

const logger = getLogger();

/** 获取代理配置 */
function getProxyAgent(): any {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (proxyUrl) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { HttpsProxyAgent } = require('https-proxy-agent');
    return new HttpsProxyAgent(proxyUrl);
  }
  return undefined;
}

function getRerankerSettingsPath(): string {
  const { getConfig } = require('../config');
  const config = getConfig();
  const path = require('path');
  return path.resolve(path.dirname(config.encryption.key_file), 'reranker-settings.json');
}

export class RerankerService {
  async getConfig(): Promise<RerankerConfigPublic | null> {
    const fs = require('fs');
    const filePath = getRerankerSettingsPath();
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RerankerConfig;
      return {
        apiUrl: data.apiUrl,
        apiKeyMasked: maskApiKey(decrypt(data.apiKeyEncrypted)),
        model: data.model,
        updatedAt: data.updatedAt,
      };
    } catch (err) {
      logger.error(err, '加载 Reranker 配置失败');
      return null;
    }
  }

  async saveConfig(req: SaveRerankerConfigRequest): Promise<void> {
    const fs = require('fs');
    const filePath = getRerankerSettingsPath();

    let apiKeyEncrypted: string;
    if (!req.apiKey || req.apiKey.includes('***')) {
      const existing = await this.loadRawConfig();
      if (!existing) throw new Error('首次配置必须提供 API Key');
      apiKeyEncrypted = existing.apiKeyEncrypted;
    } else {
      apiKeyEncrypted = encrypt(req.apiKey);
    }

    const config: RerankerConfig = {
      apiUrl: req.apiUrl,
      apiKeyEncrypted,
      model: req.model,
      updatedAt: new Date().toISOString(),
    };

    const dir = require('path').dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
    logger.info('Reranker 配置已保存');
  }

  private async loadRawConfig(): Promise<RerankerConfig | null> {
    const fs = require('fs');
    const filePath = getRerankerSettingsPath();
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RerankerConfig;
    } catch {
      return null;
    }
  }

  async isConfigured(): Promise<boolean> {
    const config = await this.loadRawConfig();
    return config !== null;
  }

  /**
   * 对文档列表进行重排序
   * @param query 查询文本
   * @param documents 文档列表
   * @param topN 返回前 N 个结果
   */
  async rerank(query: string, documents: string[], topN?: number): Promise<RerankResult[]> {
    const config = await this.loadRawConfig();
    if (!config) throw new Error('Reranker 未配置');

    const apiKey = decrypt(config.apiKeyEncrypted);
    const apiUrl = config.apiUrl.replace(/\/+$/, '');

    const response = await axios.post(
      `${apiUrl}/rerank`,
      {
        model: config.model,
        query,
        documents,
        top_n: topN || documents.length,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
        httpsAgent: getProxyAgent(),
      }
    );

    return response.data.results.map((r: any) => ({
      index: r.index,
      relevanceScore: r.relevance_score,
    }));
  }

  /**
   * 测试 Reranker 连接
   */
  async testConnection(apiUrl: string, apiKey: string, model: string): Promise<{ success: boolean; message: string }> {
    try {
      const url = apiUrl.replace(/\/+$/, '');
      await axios.post(
        `${url}/rerank`,
        {
          model,
          query: 'test',
          documents: ['test document'],
          top_n: 1,
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
          httpsAgent: getProxyAgent(),
        }
      );
      return { success: true, message: '连接成功' };
    } catch (err: any) {
      return { success: false, message: `连接失败: ${err.response?.data?.error?.message || err.message}` };
    }
  }
}

export const rerankerService = new RerankerService();
