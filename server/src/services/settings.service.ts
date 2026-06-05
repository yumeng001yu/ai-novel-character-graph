import { aiSettingsRepo } from '../repositories/file/ai-settings.repo';
import { encrypt, decrypt, maskApiKey } from '../utils/crypto';
import { AiConfig, AiConfigPublic, SaveAiConfigRequest, BuildConfig, SaveBuildConfigRequest } from '../types';
import { getConfig } from '../config';
import { getLogger } from '../utils/logger';

const logger = getLogger();

// 构建配置存储在内存中（后续可持久化）
let buildConfig: BuildConfig = {
  maxRetries: getConfig().build.default_max_retries,
  showCostEstimate: true,
  maxConcurrentAiCalls: getConfig().build.max_concurrent_ai_calls,
  enableInference: getConfig().build.enable_inference,
};

export class SettingsService {
  async getAiConfig(): Promise<AiConfigPublic | null> {
    const config = await aiSettingsRepo.load();
    if (!config) return null;

    return {
      apiUrl: config.apiUrl,
      apiKeyMasked: maskApiKey(decrypt(config.apiKeyEncrypted)),
      model: config.model,
      contextSize: config.contextSize,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      updatedAt: config.updatedAt,
    };
  }

  async saveAiConfig(req: SaveAiConfigRequest): Promise<void> {
    const config: AiConfig = {
      apiUrl: req.apiUrl,
      apiKeyEncrypted: encrypt(req.apiKey),
      model: req.model,
      contextSize: req.contextSize || getConfig().build.default_context_size,
      temperature: req.temperature ?? 0.3,
      maxTokens: req.maxTokens ?? 4096,
      updatedAt: new Date().toISOString(),
    };
    await aiSettingsRepo.save(config);
    logger.info('AI 配置已保存');
  }

  async isAiConfigured(): Promise<boolean> {
    const config = await aiSettingsRepo.load();
    return config !== null;
  }

  getBuildConfig(): BuildConfig {
    return { ...buildConfig };
  }

  saveBuildConfig(req: SaveBuildConfigRequest): BuildConfig {
    if (req.maxRetries !== undefined) buildConfig.maxRetries = req.maxRetries;
    if (req.showCostEstimate !== undefined) buildConfig.showCostEstimate = req.showCostEstimate;
    if (req.maxConcurrentAiCalls !== undefined) buildConfig.maxConcurrentAiCalls = req.maxConcurrentAiCalls;
    if (req.enableInference !== undefined) buildConfig.enableInference = req.enableInference;
    return { ...buildConfig };
  }
}

export const settingsService = new SettingsService();
