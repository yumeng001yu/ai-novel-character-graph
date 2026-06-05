import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const config = getConfig();
  const keyPath = path.resolve(config.encryption.key_file);

  if (fs.existsSync(keyPath)) {
    return Buffer.from(fs.readFileSync(keyPath, 'utf-8').trim(), 'hex');
  }

  // 自动生成密钥
  const key = crypto.randomBytes(32);
  const dir = path.dirname(keyPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
  return key;
}

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (!cachedKey) cachedKey = getEncryptionKey();
  return cachedKey;
}

export function encrypt(text: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
}

export function decrypt(encryptedText: string): string {
  const key = getKey();
  const parts = encryptedText.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');

  return decrypted;
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return '***';
  return apiKey.substring(0, 3) + '***' + apiKey.substring(apiKey.length - 4);
}
