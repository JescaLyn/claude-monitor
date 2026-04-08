import type Database from 'better-sqlite3';
import type { ParsedLogPayload, NormalizedMetricSnapshot } from './types.js';
import { resolveSessionName } from './session-names.js';

export function ingestLogPayload(db: Database.Database, parsed: ParsedLogPayload): void {
  const upsertMachine = db.prepare(`
    INSERT INTO machines (id, first_seen, last_seen) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen
  `);

  const upsertSession = db.prepare(`
    INSERT INTO sessions (id, machine_id, model, started_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      model      = COALESCE(sessions.model, excluded.model),
      started_at = MIN(sessions.started_at, excluded.started_at)
  `);

  const insertRequest = db.prepare(`
    INSERT OR IGNORE INTO api_requests
      (id, session_id, ts, prompt_id, model, cost_usd,
       input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
       duration_ms, is_fast_mode, event_sequence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTool = db.prepare(`
    INSERT OR IGNORE INTO tool_events
      (id, session_id, ts, prompt_id, tool_name, skill_name,
       duration_ms, success, machine_id, event_sequence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const refreshSession = db.prepare(`
    UPDATE sessions SET
      cost_usd              = (SELECT COALESCE(SUM(cost_usd), 0)              FROM api_requests WHERE session_id = ?),
      input_tokens          = (SELECT COALESCE(SUM(input_tokens), 0)          FROM api_requests WHERE session_id = ?),
      output_tokens         = (SELECT COALESCE(SUM(output_tokens), 0)         FROM api_requests WHERE session_id = ?),
      cache_read_tokens     = (SELECT COALESCE(SUM(cache_read_tokens), 0)     FROM api_requests WHERE session_id = ?),
      cache_creation_tokens = (SELECT COALESCE(SUM(cache_creation_tokens), 0) FROM api_requests WHERE session_id = ?)
    WHERE id = ?
  `);

  const now = Date.now() * 1000;

  const tx = db.transaction((parsed: ParsedLogPayload) => {
    const machineIds = new Set<string>(parsed.sessions.map(s => s.machineId));

    for (const machineId of machineIds) {
      upsertMachine.run(machineId, now, now);
    }

    const setAutoName = db.prepare('UPDATE sessions SET name = ? WHERE id = ? AND name IS NULL');

    for (const s of parsed.sessions) {
      upsertSession.run(s.id, s.machineId, s.model, s.startedAt);
      const autoName = resolveSessionName(s.id);
      if (autoName) {
        setAutoName.run(autoName, s.id);
      }
    }

    for (const req of parsed.apiRequests) {
      // id = session:sequence — guarantees per-session dedup
      const id = `${req.sessionId}:${req.eventSequence}`;
      insertRequest.run(
        id, req.sessionId, req.ts, req.promptId, req.model, req.costUsd,
        req.inputTokens, req.outputTokens, req.cacheReadTokens, req.cacheCreationTokens,
        req.durationMs, req.isFastMode, req.eventSequence
      );
    }

    for (const evt of parsed.toolEvents) {
      const id = `${evt.sessionId}:${evt.eventSequence}`;
      insertTool.run(
        id, evt.sessionId, evt.ts, evt.promptId, evt.toolName, evt.skillName,
        evt.durationMs, evt.success, evt.machineId, evt.eventSequence
      );
    }

    // Refresh aggregates for affected sessions
    const affected = new Set([
      ...parsed.sessions.map(s => s.id),
      ...parsed.apiRequests.map(r => r.sessionId),
    ]);
    for (const sid of affected) {
      refreshSession.run(sid, sid, sid, sid, sid, sid);
    }
  });

  tx(parsed);
}

export function ingestMetricSnapshots(
  db: Database.Database,
  snapshots: NormalizedMetricSnapshot[]
): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO metric_snapshots
      (session_id, metric_name, dimension_key, value, time_unix_nano, machine_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((snapshots: NormalizedMetricSnapshot[]) => {
    for (const s of snapshots) {
      insert.run(s.sessionId, s.metricName, s.dimensionKey, s.value, s.timeUnixNano, s.machineId);
    }
  });

  tx(snapshots);
}
