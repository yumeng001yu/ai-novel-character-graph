import crypto from 'crypto';

const SEGMENT_SIZE = 1000; // 每1000字取一段指纹

export function computeTextFingerprint(text: string): string[] {
  const fingerprints: string[] = [];

  for (let i = 0; i < text.length; i += SEGMENT_SIZE) {
    const segment = text.substring(i, i + SEGMENT_SIZE);
    const hash = crypto.createHash('md5').update(segment).digest('hex');
    fingerprints.push(hash);
  }

  return fingerprints;
}

export function findDuplicateBoundary(
  existingFingerprints: string[],
  newFingerprints: string[]
): { duplicateEndIndex: number; matchLength: number } {
  let matchLength = 0;

  for (let i = 0; i < Math.min(existingFingerprints.length, newFingerprints.length); i++) {
    if (existingFingerprints[i] === newFingerprints[i]) {
      matchLength = i + 1;
    } else {
      break;
    }
  }

  return {
    duplicateEndIndex: matchLength * SEGMENT_SIZE,
    matchLength,
  };
}
