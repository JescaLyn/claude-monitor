import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';

function inMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

describe('schema migrations', () => {
  it('sessions table has a name column after migrations run', () => {
    const db = inMemoryDb();
    const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[];
    const columnNames = columns.map(c => c.name);
    expect(columnNames).toContain('name');
    db.close();
  });
});
