import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import { parseLogsPayload } from '../src/parser/logs.js';
import { parseMetricsPayload } from '../src/parser/metrics.js';
import { ingestLogPayload, ingestMetricSnapshots } from '../src/ingest.js';
import { ingestJsonlEntries } from '../src/jsonl/ingest.js';
import type { OtelLogsPayload, OtelMetricsPayload } from '../src/types.js';
import type { JsonlEntry, AsyncAgentLaunch } from '../src/jsonl/parser.js';

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

  it('sets api_request_count on session after ingest', () => {
    ingestLogPayload(db, parseLogsPayload(LOG_SAMPLE, 'test-machine'));
    const session = db.prepare('SELECT api_request_count FROM sessions').get() as { api_request_count: number };
    expect(session.api_request_count).toBe(1);
  });

  it('sets tool_call_count on session after ingest', () => {
    ingestLogPayload(db, parseLogsPayload(LOG_SAMPLE, 'test-machine'));
    const session = db.prepare('SELECT tool_call_count FROM sessions').get() as { tool_call_count: number };
    expect(session.tool_call_count).toBe(1);
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

describe('ingestJsonlEntries with subagents', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('links subagent sessions to their correct parent sessionId', () => {
    const parentSessionId = 'parent-session-123';
    const agentId = 'agent-456';

    // Create JSONL entries with a parent session and a subagent indicator
    const entries: JsonlEntry[] = [
      {
        sessionId: parentSessionId,
        agentId: null,
        timestamp: '2026-04-23T12:00:00.000Z',
        cwd: '/test/project',
        costUSD: 0.01,
        message: {
          id: 'msg-1',
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 100, output_tokens: 50 }
        }
      } as JsonlEntry,
      {
        sessionId: parentSessionId,
        agentId: agentId,
        timestamp: '2026-04-23T12:00:01.000Z',
        cwd: '/test/project',
        costUSD: 0.005,
        message: {
          id: 'msg-2',
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 50, output_tokens: 25 }
        }
      } as JsonlEntry
    ];

    ingestJsonlEntries(db, entries, 'test-machine');

    // Verify parent session exists
    const parentSession = db.prepare('SELECT id FROM sessions WHERE id = ?')
      .get(parentSessionId) as Record<string, unknown> | undefined;
    expect(parentSession).toBeDefined();
    expect(parentSession?.id).toBe(parentSessionId);

    // Verify subagent session exists and is linked to the correct parent
    const subagentSession = db.prepare('SELECT id, parent_session_id FROM sessions WHERE id = ?')
      .get(agentId) as Record<string, unknown> | undefined;
    expect(subagentSession).toBeDefined();
    expect(subagentSession?.id).toBe(agentId);
    expect(subagentSession?.parent_session_id).toBe(parentSessionId);
  });

  it('stores agent_type on subagent session when provided', () => {
    const parentSessionId = 'parent-agent-type';
    const agentId = 'sub-explore';

    const entries: JsonlEntry[] = [{
      sessionId: parentSessionId,
      agentId,
      agentType: 'Explore',
      timestamp: '2026-04-23T12:00:00.000Z',
      cwd: '/test/project',
      costUSD: 0.01,
      message: { id: 'msg-at-1', model: 'claude-haiku', usage: { input_tokens: 50, output_tokens: 25 } }
    } as JsonlEntry];

    ingestJsonlEntries(db, entries, 'test-machine');

    const row = db.prepare('SELECT agent_type FROM sessions WHERE id = ?')
      .get(agentId) as Record<string, unknown> | undefined;
    expect(row?.agent_type).toBe('Explore');
  });

  it('applies sessionNames map to session name column', () => {
    const sessionId = 'named-session-1';
    const entries: JsonlEntry[] = [{
      sessionId,
      timestamp: '2026-04-23T12:00:00.000Z',
      cwd: '/test/project',
      costUSD: 0.01,
      message: { id: 'msg-sn-1', model: 'claude-sonnet', usage: { input_tokens: 100, output_tokens: 50 } }
    } as JsonlEntry];

    const sessionNames = new Map([[sessionId, 'My Named Session']]);
    ingestJsonlEntries(db, entries, 'test-machine', undefined, sessionNames);

    const row = db.prepare('SELECT name FROM sessions WHERE id = ?')
      .get(sessionId) as Record<string, unknown> | undefined;
    expect(row?.name).toBe('My Named Session');
  });

  it('uses asyncAgentLaunches to name async subagent sessions from parent JSONL', () => {
    const parentSessionId = 'parent-async-launch';
    const agentId = 'async-hex-abc123';

    // No entries needed — the launch itself creates the synthetic session
    const launches: AsyncAgentLaunch[] = [{
      agentId,
      description: 'Scan batch 1 (8 repos for security vulnerabilities)',
      parentSessionId,
    }];

    ingestJsonlEntries(db, [], 'test-machine', undefined, undefined, launches);

    const row = db.prepare('SELECT name, parent_session_id FROM sessions WHERE id = ?')
      .get(agentId) as Record<string, unknown> | undefined;
    expect(row?.name).toBe('Scan batch 1 (8 repos for security vulnerabilities)');
    expect(row?.parent_session_id).toBe(parentSessionId);
  });

  it('does not overwrite an existing non-empty session name', () => {
    const sessionId = 'pre-named-session';
    const entries: JsonlEntry[] = [{
      sessionId,
      timestamp: '2026-04-23T12:00:00.000Z',
      cwd: '/test/project',
      costUSD: 0.01,
      message: { id: 'msg-pre-1', model: 'claude-sonnet', usage: { input_tokens: 100, output_tokens: 50 } }
    } as JsonlEntry];

    // Set a name first
    ingestJsonlEntries(db, entries, 'test-machine');
    db.prepare('UPDATE sessions SET name = ? WHERE id = ?').run('Original Name', sessionId);

    // Try to overwrite via sessionNames
    ingestJsonlEntries(db, entries, 'test-machine', undefined, new Map([[sessionId, 'New Name']]));

    const row = db.prepare('SELECT name FROM sessions WHERE id = ?')
      .get(sessionId) as Record<string, unknown> | undefined;
    expect(row?.name).toBe('Original Name');
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
