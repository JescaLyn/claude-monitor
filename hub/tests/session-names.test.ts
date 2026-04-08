import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { resolveSessionName, clearSessionNameCache } from '../src/session-names.js';

const FIXTURES_DIR = join(fileURLToPath(import.meta.url), '..', 'fixtures', 'claude-projects');
const SESSIONS_DIR = join(fileURLToPath(import.meta.url), '..', 'fixtures', 'sessions');

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

  it('prefers user-set name from sessions dir over slug', () => {
    const result = resolveSessionName('test-session-with-name', FIXTURES_DIR, SESSIONS_DIR);
    expect(result).toBe('claude-monitor-build');
  });

  it('falls back to slug when no user-set name', () => {
    const result = resolveSessionName('test-session-id', FIXTURES_DIR, SESSIONS_DIR);
    expect(result).toBe('jazzy-swimming-rocket');
  });
});
