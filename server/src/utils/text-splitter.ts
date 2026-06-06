export function splitByParagraphs(text: string, maxChunkSize: number): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    // 处理超长段落：按句子拆分
    if (para.length > maxChunkSize) {
      // 先保存当前累积的 chunk
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      // 按句子拆分超长段落
      const sentences = para.split(/(?<=[。！？；.!?;])/);
      let subChunk = '';
      for (const sentence of sentences) {
        if (subChunk.length + sentence.length > maxChunkSize && subChunk.length > 0) {
          chunks.push(subChunk.trim());
          subChunk = sentence;
        } else {
          subChunk += sentence;
        }
      }
      if (subChunk.trim()) {
        currentChunk = subChunk;
      }
      continue;
    }

    if (currentChunk.length + para.length + 2 > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = para;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

export function countChars(text: string): number {
  return text.replace(/\s/g, '').length;
}
