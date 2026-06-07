import axios from 'axios';
import { EmbeddingConfigPublic, EmbeddingConfig, SaveEmbeddingConfigRequest } from '../types';
import { aiSettingsRepo } from '../repositories/file/ai-settings.repo';
import { encrypt, decrypt, maskApiKey } from '../utils/crypto';
import { getLogger } from '../utils/logger';

const logger = getLogger();

const EMBEDDING_SETTINGS_KEY = 'embedding-settings';

function getEmbeddingSettingsPath(): string {
  const { getConfig } = require('../config');
  const config = getConfig();
  const path = require('path');
  return path.resolve(path.dirname(config.encryption.key_file), 'embedding-settings.json');
}

export class EmbeddingService {
  async getConfig(): Promise<EmbeddingConfigPublic | null> {
    const fs = require('fs');
    const filePath = getEmbeddingSettingsPath();
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as EmbeddingConfig;
      return {
        apiUrl: data.apiUrl,
        apiKeyMasked: maskApiKey(decrypt(data.apiKeyEncrypted)),
        model: data.model,
        dimensions: data.dimensions,
        updatedAt: data.updatedAt,
      };
    } catch (err) {
      logger.error(err, '加载 Embedding 配置失败');
      return null;
    }
  }

  async saveConfig(req: SaveEmbeddingConfigRequest): Promise<void> {
    const fs = require('fs');
    const filePath = getEmbeddingSettingsPath();

    let apiKeyEncrypted: string;
    if (!req.apiKey || req.apiKey.includes('***')) {
      const existing = await this.loadRawConfig();
      if (!existing) throw new Error('首次配置必须提供 API Key');
      apiKeyEncrypted = existing.apiKeyEncrypted;
    } else {
      apiKeyEncrypted = encrypt(req.apiKey);
    }

    const config: EmbeddingConfig = {
      apiUrl: req.apiUrl,
      apiKeyEncrypted,
      model: req.model,
      dimensions: req.dimensions || 1536,
      updatedAt: new Date().toISOString(),
    };

    const dir = require('path').dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
    logger.info('Embedding 配置已保存');
  }

  private async loadRawConfig(): Promise<EmbeddingConfig | null> {
    const fs = require('fs');
    const filePath = getEmbeddingSettingsPath();
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as EmbeddingConfig;
    } catch {
      return null;
    }
  }

  async isConfigured(): Promise<boolean> {
    const config = await this.loadRawConfig();
    return config !== null;
  }

  /**
   * 生成文本的 embedding 向量
   */
  async embed(text: string): Promise<number[]> {
    const config = await this.loadRawConfig();
    if (!config) throw new Error('Embedding 未配置');

    const apiKey = decrypt(config.apiKeyEncrypted);
    const apiUrl = config.apiUrl.replace(/\/+$/, '');

    const body: any = {
      model: config.model,
      input: text,
    };
    if (config.dimensions) body.dimensions = config.dimensions;

    const response = await axios.post(
      `${apiUrl}/embeddings`,
      body,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    return response.data.data[0].embedding;
  }

  /**
   * 批量生成 embedding 向量
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const config = await this.loadRawConfig();
    if (!config) throw new Error('Embedding 未配置');

    const apiKey = decrypt(config.apiKeyEncrypted);
    const apiUrl = config.apiUrl.replace(/\/+$/, '');

    const body: any = {
      model: config.model,
      input: texts,
    };
    if (config.dimensions) body.dimensions = config.dimensions;

    const response = await axios.post(
      `${apiUrl}/embeddings`,
      body,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );

    // 按 index 排序确保顺序正确
    const sorted = response.data.data.sort((a: any, b: any) => a.index - b.index);
    return sorted.map((d: any) => d.embedding);
  }

  /**
   * 测试 Embedding 连接
   */
  async testConnection(apiUrl: string, apiKey: string, model: string): Promise<{ success: boolean; message: string; dimensions?: number }> {
    try {
      const url = apiUrl.replace(/\/+$/, '');
      const response = await axios.post(
        `${url}/embeddings`,
        {
          model,
          input: 'test',
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );
      const dim = response.data.data[0].embedding.length;
      return { success: true, message: `连接成功，向量维度: ${dim}`, dimensions: dim };
    } catch (err: any) {
      return { success: false, message: `连接失败: ${err.response?.data?.error?.message || err.message}` };
    }
  }

  /**
   * 获取可用 embedding 模型列表
   */
  async getModelList(apiUrl: string, apiKey: string): Promise<Array<{ id: string; name: string }>> {
    try {
      const url = apiUrl.replace(/\/+$/, '');
      const response = await axios.get(`${url}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        timeout: 10000,
      });
      return (response.data.data || [])
        .filter((m: any) => {
          const id = (m.id || '').toLowerCase();
          return id.includes('embed') || id.includes('e5') || id.includes('bge') || id.includes('vec');
        })
        .map((m: any) => ({ id: m.id, name: m.id }));
    } catch (err: any) {
      logger.warn(err, '获取 Embedding 模型列表失败');
      return [];
    }
  }
}

export const embeddingService = new EmbeddingService();
