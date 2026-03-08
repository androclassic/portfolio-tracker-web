import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ASSET_LOGO_KEY_MAP } from '../src/lib/assets';

const LOGO_DIR = path.join(process.cwd(), 'public', 'coin-logos');
const SOURCE_URLS = [
  (key: string) => `https://assets.coincap.io/assets/icons/${key}@2x.png`,
  (key: string) => `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${key}.png`,
  (key: string) => `https://cryptoicons.org/api/icon/${key}/200`,
];

type SyncOptions = {
  refreshAll: boolean;
  symbols: Set<string> | null;
};

function parseOptions(argv: string[]): SyncOptions {
  const refreshAll = argv.includes('--refresh-all');
  const symbolsArg = argv.find((arg) => arg.startsWith('--symbols='));
  const symbols = symbolsArg
    ? new Set(
        symbolsArg
          .replace('--symbols=', '')
          .split(',')
          .map((value) => value.trim().toUpperCase())
          .filter(Boolean),
      )
    : null;
  return { refreshAll, symbols };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadLogo(logoKey: string): Promise<Buffer | null> {
  for (const getUrl of SOURCE_URLS) {
    const url = getUrl(logoKey);
    try {
      const response = await fetchWithTimeout(url, 15000);
      if (!response.ok) {
        continue;
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        continue;
      }
      const bytes = await response.arrayBuffer();
      return Buffer.from(bytes);
    } catch {
      continue;
    }
  }
  return null;
}

async function main() {
  const { refreshAll, symbols } = parseOptions(process.argv.slice(2));
  await mkdir(LOGO_DIR, { recursive: true });

  const mapEntries = Object.entries(ASSET_LOGO_KEY_MAP);
  const filteredEntries = symbols
    ? mapEntries.filter(([symbol]) => symbols.has(symbol))
    : mapEntries;
  const logoKeys = Array.from(new Set(filteredEntries.map(([, key]) => key)));

  if (logoKeys.length === 0) {
    console.log('No symbols selected for sync. Nothing to do.');
    return;
  }

  let downloaded = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const logoKey of logoKeys) {
    const targetPath = path.join(LOGO_DIR, `${logoKey}.png`);
    const hasFile = await fileExists(targetPath);

    if (hasFile && !refreshAll) {
      skipped += 1;
      continue;
    }

    const image = await downloadLogo(logoKey);
    if (!image) {
      failed.push(logoKey);
      continue;
    }

    await writeFile(targetPath, image);
    downloaded += 1;
  }

  console.log(`Logo sync finished. downloaded=${downloaded}, skipped=${skipped}, failed=${failed.length}`);
  if (failed.length > 0) {
    console.log(`Failed keys: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

void main();
