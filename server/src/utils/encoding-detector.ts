import fs from 'fs';
import iconv from 'iconv-lite';
import { getLogger } from './logger';

const logger = getLogger();

export function detectAndDecode(buffer: Buffer): string {
  // 先尝试 UTF-8
  try {
    const text = buffer.toString('utf-8');
    // 检查是否有乱码（简单检测：UTF-8 解码后是否包含替换字符）
    if (!text.includes('\ufffd')) {
      return text;
    }
  } catch {
    // UTF-8 解码失败
  }

  // 尝试检测编码
  let detectedEncoding = 'utf-8';
  try {
    // 使用 jschardet 检测
    const jschardet = require('jschardet');
    const result = jschardet.detect(buffer);
    if (result.encoding && result.encoding !== 'ascii') {
      detectedEncoding = result.encoding;
    }
  } catch {
    logger.warn('编码检测失败，尝试 GBK 解码');
  }

  // 如果检测到 GBK/GB2312/GB18030，用 iconv-lite 解码
  if (['gbk', 'gb2312', 'gb18030', 'big5'].includes(detectedEncoding.toLowerCase())) {
    try {
      const text = iconv.decode(buffer, detectedEncoding);
      logger.info(`文件编码检测为: ${detectedEncoding}`);
      return text;
    } catch (err) {
      logger.warn(`使用 ${detectedEncoding} 解码失败，回退到 UTF-8`);
    }
  }

  // 最后回退到 UTF-8
  return buffer.toString('utf-8');
}

export function readFileWithEncoding(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return detectAndDecode(buffer);
}
