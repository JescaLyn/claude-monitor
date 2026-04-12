import { readdirSync, existsSync } from 'fs';
import { resolve, join, basename } from 'path';
import { homedir } from 'os';

/**
 * Find all .jsonl files in Claude Code project directories.
 * Checks both XDG (~/.config/claude) and legacy (~/.claude) locations.
 */
export function findJsonlFiles(): string[] {
  const projectDirs: string[] = [];
  const paths = [
    resolve(homedir(), '.config/claude/projects'),
    resolve(homedir(), '.claude/projects'),
  ];

  for (const projectPath of paths) {
    if (existsSync(projectPath)) {
      projectDirs.push(projectPath);
    }
  }

  const files = new Set<string>();

  for (const projectDir of projectDirs) {
    walkDir(projectDir, (filePath) => {
      if (filePath.endsWith('.jsonl')) {
        files.add(filePath);
      }
    });
  }

  return Array.from(files);
}

/**
 * Recursively walk a directory and call callback for each file.
 */
function walkDir(dir: string, callback: (path: string) => void): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath, callback);
      } else if (entry.isFile()) {
        callback(fullPath);
      }
    }
  } catch {
    // Ignore read errors (permission denied, etc.)
  }
}

/**
 * Extract project name from file path.
 * Converts path segment between projects/ and filename.
 * E.g. ~/.claude/projects/hashdir/sessionid.jsonl → no project name
 * E.g. path-encoded project names would be handled by the path segment
 *
 * For now, return empty string (will be populated from JSONL cwd field instead).
 */
export function extractProject(): string {
  // Project will be extracted from the JSONL's cwd field instead of path
  return '';
}
