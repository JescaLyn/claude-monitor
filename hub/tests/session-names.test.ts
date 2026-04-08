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

  it('returns null when no user-set name exists', () => {
    const result = resolveSessionName('test-session-id', FIXTURES_DIR);
    expect(result).toBeNull();
  });

  it('returns null for unknown session', () => {
    const result = resolveSessionName('unknown-session-id', FIXTURES_DIR);
    expect(result).toBeNull();
  });

  it('caches the null result on second call', () => {
    resolveSessionName('test-session-id', FIXTURES_DIR);
    const result = resolveSessionName('test-session-id', FIXTURES_DIR);
    expect(result).toBeNull();
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

  it('returns null when no user-set name in sessions dir', () => {
    const result = resolveSessionName('test-session-id', FIXTURES_DIR, SESSIONS_DIR);
    expect(result).toBeNull();
  });
});
