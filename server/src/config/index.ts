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

export function loadConfig(): AppConfig {
  if (config) return config;

  const configPath = process.env.CONFIG_PATH || path.resolve(__dirname, '../../config.yaml');
  const raw = fs.readFileSync(configPath, 'utf-8');
  config = yaml.load(raw) as AppConfig;
  return config;
}

export function getConfig(): AppConfig {
  if (!config) return loadConfig();
  return config;
}
