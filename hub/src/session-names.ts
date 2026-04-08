import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const cache = new Map<string, string | null>();

export function resolveSessionName(
  sessionId: string,
  baseDir: string = join(homedir(), '.claude', 'projects'),
  sessionsDir: string = join(homedir(), '.claude', 'sessions')
): string | null {
  if (cache.has(sessionId)) return cache.get(sessionId) ?? null;

  // First, try to find user-set name in ~/.claude/sessions/*.json
  const userSetName = findUserSetName(sessionId, sessionsDir);
  if (userSetName) {
    cache.set(sessionId, userSetName);
    return userSetName;
  }

  // Fall back to auto-generated slug from JSONL
  const slug = findSlug(sessionId, baseDir);
  cache.set(sessionId, slug);
  return slug;
}

export function clearSessionNameCache(): void {
  cache.clear();
}

function findUserSetName(sessionId: string, sessionsDir: string): string | null {
  if (!existsSync(sessionsDir)) return null;
  let sessionFiles: string[];
  try {
    sessionFiles = readdirSync(sessionsDir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith('.json'))
      .map(e => join(sessionsDir, e.name));
  } catch {
    return null;
  }

  for (const filePath of sessionFiles) {
    try {
      const content = readFileSync(filePath, 'utf8');
      const record = JSON.parse(content) as Record<string, unknown>;
      if (record.sessionId === sessionId && typeof record.name === 'string' && record.name.length > 0) {
        return record.name;
      }
    } catch {
      // skip malformed files
    }
  }
  return null;
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
