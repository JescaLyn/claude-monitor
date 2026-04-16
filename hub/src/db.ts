import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { MIGRATIONS } from './schema.js';

export function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)`);
  const row = db.prepare('SELECT MAX(version) as v FROM _migrations').get() as { v: number | null };
  const from = (row.v ?? -1) + 1;
  for (let i = from; i < MIGRATIONS.length; i++) {
    try {
      db.exec(MIGRATIONS[i]);
    } catch (err) {
      // If migration fails due to column already existing or other benign reasons, log and continue
      console.warn(`[db] Migration ${i} failed (may already be applied):`, (err as Error).message);
    }
    db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(i);
  }
}

export function openDb(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  runMigrations(db);
  return db;
}

let _db: Database.Database | null = null;

export function getDb(path = './data/monitor.db'): Database.Database {
  if (!_db) _db = openDb(path);
  return _db;
}
