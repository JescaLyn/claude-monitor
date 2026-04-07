import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import { parseLogsPayload } from '../src/parser/logs.js';
import { parseMetricsPayload } from '../src/parser/metrics.js';
import { ingestLogPayload, ingestMetricSnapshots } from '../src/ingest.js';
import type { OtelLogsPayload, OtelMetricsPayload } from '../src/types.js';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const LOG_SAMPLE = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'logs/payload_020218_841952_v1_logs.json'), 'utf8')
) as OtelLogsPayload;
const METRICS_SAMPLE = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'docs/reference/real-payload-metrics-sample.json'), 'utf8')
) as OtelMetricsPayload;

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

describe('ingestLogPayload', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('inserts a session row', () => {
    ingestLogPayload(db, parseLogsPayload(LOG_SAMPLE, 'test-machine'));
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?')
      .get('bf9aefc7-1d4c-4385-b5df-bd161e0c1ded') as Record<string, unknown>;
    expect(session).toBeDefined();
    expect(session.machine_id).toBe('test-machine');
    expect(session.model).toBe('claude-sonnet-4-6');
  });

  it('inserts an api_request row with correct cost', () => {
    ingestLogPayload(db, parseLogsPayload(LOG_SAMPLE, 'test-machine'));
    const req = db.prepare('SELECT * FROM api_requests').get() as Record<string, unknown>;
    expect(req).toBeDefined();
    expect(req.cost_usd as number).toBeCloseTo(0.01267155);
    expect(req.cache_read_tokens).toBe(28591);
  });

  it('inserts a tool_event row', () => {
    ingestLogPayload(db, parseLogsPayload(LOG_SAMPLE, 'test-machine'));
    const evt = db.prepare('SELECT * FROM tool_events').get() as Record<string, unknown>;
    expect(evt).toBeDefined();
    expect(evt.tool_name).toBe('Bash');
    expect(evt.success).toBe(1);
  });

  it('updates session cost_usd aggregate', () => {
    ingestLogPayload(db, parseLogsPayload(LOG_SAMPLE, 'test-machine'));
    const session = db.prepare('SELECT cost_usd FROM sessions').get() as { cost_usd: number };
    expect(session.cost_usd).toBeCloseTo(0.01267155);
  });

  it('is idempotent — ingesting the same payload twice does not duplicate rows', () => {
    const parsed = parseLogsPayload(LOG_SAMPLE, 'test-machine');
    ingestLogPayload(db, parsed);
    ingestLogPayload(db, parsed);
    const reqCount = (db.prepare('SELECT COUNT(*) as c FROM api_requests').get() as { c: number }).c;
    const evtCount = (db.prepare('SELECT COUNT(*) as c FROM tool_events').get() as { c: number }).c;
    expect(reqCount).toBe(1);
    expect(evtCount).toBe(1);
  });
});

describe('ingestMetricSnapshots', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('inserts metric snapshots', () => {
    const snapshots = parseMetricsPayload(METRICS_SAMPLE, 'test-machine');
    ingestMetricSnapshots(db, snapshots);
    const count = (db.prepare('SELECT COUNT(*) as c FROM metric_snapshots').get() as { c: number }).c;
    expect(count).toBe(9);
  });

  it('is idempotent — same snapshots inserted twice stays at 9 rows', () => {
    const snapshots = parseMetricsPayload(METRICS_SAMPLE, 'test-machine');
    ingestMetricSnapshots(db, snapshots);
    ingestMetricSnapshots(db, snapshots);
    const count = (db.prepare('SELECT COUNT(*) as c FROM metric_snapshots').get() as { c: number }).c;
    expect(count).toBe(9);
  });
});
