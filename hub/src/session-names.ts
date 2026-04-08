import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const cache = new Map<string, string | null>();

export function resolveSessionName(
  sessionId: string,
  baseDir: string = join(homedir(), '.claude', 'projects')
): string | null {
  if (cache.has(sessionId)) return cache.get(sessionId) ?? null;
  const result = findSlug(sessionId, baseDir);
  cache.set(sessionId, result);
  return result;
}

export function clearSessionNameCache(): void {
  cache.clear();
}

function findSlug(sessionId: string, baseDir: string): string | null {
  if (!existsSync(baseDir)) return null;
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(baseDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => join(baseDir, e.name));
  } catch {
    return null;
  }
  const target = `${sessionId}.jsonl`;
  for (const projectDir of projectDirs) {
    const filePath = join(projectDir, target);
    if (!existsSync(filePath)) continue;
    try {
      const content = readFileSync(filePath, 'utf8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line) as Record<string, unknown>;
          if (typeof record.slug === 'string' && record.slug.length > 0) {
            return record.slug;
          }
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // skip unreadable files
    }
  }
  return null;
}
