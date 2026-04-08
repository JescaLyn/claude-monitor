import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { resolveSessionName, clearSessionNameCache } from '../src/session-names.js';

const FIXTURES_DIR = join(fileURLToPath(import.meta.url), '..', 'fixtures', 'claude-projects');

describe('resolveSessionName', () => {
  beforeEach(() => {
    clearSessionNameCache();
  });

  it('returns slug for a known session', () => {
    const result = resolveSessionName('test-session-id', FIXTURES_DIR);
    expect(result).toBe('jazzy-swimming-rocket');
  });

  it('returns null for unknown session', () => {
    const result = resolveSessionName('unknown-session-id', FIXTURES_DIR);
    expect(result).toBeNull();
  });

  it('caches the result on second call', () => {
    resolveSessionName('test-session-id', FIXTURES_DIR);
    const result = resolveSessionName('test-session-id', FIXTURES_DIR);
    expect(result).toBe('jazzy-swimming-rocket');
  });

  it('caches null result', () => {
    resolveSessionName('unknown-session-id', FIXTURES_DIR);
    const result = resolveSessionName('unknown-session-id', FIXTURES_DIR);
    expect(result).toBeNull();
  });
});
