import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export interface ServerConfig {
  port: number;
  host: string;
}

export interface Neo4jConfig {
  uri: string;
  username: string;
  password: string;
  database: string;
}

export interface RedisConfig {
  host: string;
  port: number;
  password: string;
  db: number;
}

export interface BuildConfigRaw {
  max_file_size_mb: number;
  snapshot_dir: string;
  enable_inference: boolean;
  default_context_size: number;
  default_max_retries: number;
  max_concurrent_ai_calls: number;
}

export interface EncryptionConfig {
  key_file: string;
}

export interface LogConfig {
  level: string;
  file: string;
}

export interface AppConfig {
  server: ServerConfig;
  neo4j: Neo4jConfig;
  redis: RedisConfig;
  build: BuildConfigRaw;
  encryption: EncryptionConfig;
  log: LogConfig;
}

let config: AppConfig | null = null;

/**
 * 深度合并两个对象，localConfig 的值覆盖 baseConfig
 */
function deepMerge<T extends Record<string, any>>(base: T, local: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(local) as Array<keyof T>) {
    if (
      local[key] !== null &&
      typeof local[key] === 'object' &&
      !Array.isArray(local[key]) &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(base[key], local[key] as any);
    } else {
      result[key] = local[key] as any;
    }
  }
  return result;
}

export function loadConfig(): AppConfig {
  if (config) return config;

  // 加载基础配置
  const configPath = process.env.CONFIG_PATH || path.resolve(__dirname, '../../config.yaml');
  const raw = fs.readFileSync(configPath, 'utf-8');
  const baseConfig = yaml.load(raw) as AppConfig;

  // 检查是否有本地覆盖配置（用于本地开发，不提交到 git）
  const localConfigPath = path.resolve(__dirname, '../../config.local.yaml');
  if (fs.existsSync(localConfigPath)) {
    const localRaw = fs.readFileSync(localConfigPath, 'utf-8');
    const localConfig = yaml.load(localRaw) as Partial<AppConfig>;
    config = deepMerge(baseConfig, localConfig);
  } else {
    config = baseConfig;
  }

  return config;
}

export function getConfig(): AppConfig {
  if (!config) return loadConfig();
  return config;
}
