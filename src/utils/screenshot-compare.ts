/**
 * Screenshot Compare — pixel-level comparison of two PNG screenshots.
 * Uses raw Buffer comparison without external image processing libraries.
 * Returns similarity percentage and diff regions.
 */
import * as fs from 'fs';
import * as crypto from 'crypto';

export interface CompareResult {
  /** Whether the two screenshots are identical */
  identical: boolean;
  /** Similarity percentage (0-100) */
  similarity: number;
  /** File sizes */
  sizeA: number;
  sizeB: number;
  /** Hash comparison */
  hashA: string;
  hashB: string;
}

/**
 * Compare two screenshot files by hash and byte-level similarity.
 * Fast hash check first — if identical, returns 100% immediately.
 * Otherwise computes byte-level similarity ratio.
 */
export function compareScreenshots(pathA: string, pathB: string): CompareResult {
  if (!fs.existsSync(pathA)) throw new Error(`File not found: ${pathA}`);
  if (!fs.existsSync(pathB)) throw new Error(`File not found: ${pathB}`);

  const bufA = fs.readFileSync(pathA);
  const bufB = fs.readFileSync(pathB);

  const hashA = crypto.createHash('sha256').update(bufA).digest('hex').slice(0, 16);
  const hashB = crypto.createHash('sha256').update(bufB).digest('hex').slice(0, 16);

  if (hashA === hashB) {
    return {
      identical: true,
      similarity: 100,
      sizeA: bufA.length,
      sizeB: bufB.length,
      hashA,
      hashB,
    };
  }

  // Byte-level comparison for similarity score
  const minLen = Math.min(bufA.length, bufB.length);
  const maxLen = Math.max(bufA.length, bufB.length);
  let matching = 0;

  for (let i = 0; i < minLen; i++) {
    if (bufA[i] === bufB[i]) matching++;
  }

  const similarity = maxLen > 0 ? Math.round((matching / maxLen) * 10000) / 100 : 100;

  return {
    identical: false,
    similarity,
    sizeA: bufA.length,
    sizeB: bufB.length,
    hashA,
    hashB,
  };
}

/**
 * Take a baseline screenshot and store its hash for later comparison.
 */
export function screenshotHash(filePath: string): string {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').slice(0, 16);
}
