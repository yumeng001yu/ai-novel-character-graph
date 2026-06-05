import fs from 'fs';
import { getLogger } from './logger';

const logger = getLogger();

/**
 * 自动检测文件编码并解码为 UTF-8 字符串
 * 支持常见中文编码：UTF-8、GBK、GB2312、GB18030、Big5
 */
export function detectAndDecode(buffer: Buffer): string {
  // 第一步：先尝试 UTF-8（最常见）
  const utf8Text = buffer.toString('utf-8');
  if (!utf8Text.includes('\ufffd')) {
    return utf8Text;
  }

  // 第二步：使用 jschardet 检测编码
  let detectedEncoding = 'utf-8';
  try {
    const jschardet = require('jschardet');
    const result = jschardet.detect(buffer);
    if (result.encoding && result.encoding !== 'ascii' && result.confidence > 0.7) {
      detectedEncoding = result.encoding;
      logger.info(`jschardet 检测编码: ${detectedEncoding}（置信度: ${(result.confidence * 100).toFixed(0)}%）`);
    }
  } catch {
    logger.warn('jschardet 检测失败，尝试 iconv-lite 解码');
  }

  // 第三步：使用 iconv-lite 解码检测到的编码
  try {
    const iconv = require('iconv-lite');
    if (iconv.encodingExists(detectedEncoding)) {
      const text = iconv.decode(buffer, detectedEncoding);
      // 验证解码结果是否合理（不包含大量替换字符）
      const replacementCount = (text.match(/\ufffd/g) || []).length;
      if (replacementCount < text.length * 0.01) {
        logger.info(`文件编码检测为: ${detectedEncoding}`);
        return text;
      }
      logger.warn(`${detectedEncoding} 解码后仍有较多乱码，继续尝试其他编码`);
    }
  } catch (err) {
    logger.warn(`iconv-lite ${detectedEncoding} 解码失败`);
  }

  // 第四步：依次尝试常见中文编码
  const fallbackEncodings = ['gbk', 'gb18030', 'gb2312', 'big5', 'euc-kr', 'shift_jis'];
  for (const encoding of fallbackEncodings) {
    try {
      const iconv = require('iconv-lite');
      if (!iconv.encodingExists(encoding)) continue;
      const text = iconv.decode(buffer, encoding);
      const replacementCount = (text.match(/\ufffd/g) || []).length;
      if (replacementCount < text.length * 0.01) {
        logger.info(`文件编码回退检测为: ${encoding}`);
        return text;
      }
    } catch {
      continue;
    }
  }

  // 最终回退到 UTF-8
  logger.warn('所有编码检测均失败，使用 UTF-8（可能存在乱码）');
  return utf8Text;
}

/**
 * 从文件路径读取并自动检测编码
 */
export function readFileWithEncoding(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return detectAndDecode(buffer);
}

/**
 * 从 Buffer 直接检测编码（用于上传文件场景）
 */
export function decodeBuffer(buffer: Buffer): string {
  return detectAndDecode(buffer);
}
