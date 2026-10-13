import { createWriteStream, createReadStream, existsSync, renameSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';

const [url, target, expected] = process.argv.slice(2);
if (!url || !target) throw new Error('Usage: node download.mjs URL FILE [SHA256]');
async function checksum(file) {
  const hash = createHash('sha256');
  for await (const part of createReadStream(file)) hash.update(part);
  return hash.digest('hex');
}
if (existsSync(target) && expected && await checksum(target) === expected.toLowerCase()) {
  console.log('Verified cached archive.');
} else {
  const response = await fetch(url, { signal: AbortSignal.timeout(600000) });
  if (!response.ok || !response.body) throw new Error(`Download HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target + '.partial'));
  if (expected && await checksum(target + '.partial') !== expected.toLowerCase()) throw new Error('SHA256 mismatch');
  renameSync(target + '.partial', target);
  console.log('Download complete' + (expected ? '; SHA256 verified.' : '.'));
}
