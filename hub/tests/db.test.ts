import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';

function inMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

describe('runMigrations', () => {
  it('creates all expected tables', () => {
    const db = inMemoryDb();
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('sessions');
    expect(names).toContain('api_requests');
    expect(names).toContain('tool_events');
    expect(names).toContain('metric_snapshots');
    expect(names).toContain('machines');
    db.close();
  });

  it('is idempotent — running twice does not fail', () => {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    expect(() => {
      runMigrations(db);
      runMigrations(db);
    }).not.toThrow();
    db.close();
  });
});
