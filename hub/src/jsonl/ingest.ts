import type Database from 'better-sqlite3';
import { JsonlEntry } from './parser.js';

export function ingestJsonlEntries(
  db: Database.Database,
  entries: JsonlEntry[],
  machineId: string
): void {
  const upsertMachine = db.prepare(`
    INSERT INTO machines (id, first_seen, last_seen) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen
  `);

  const upsertSession = db.prepare(`
    INSERT OR IGNORE INTO sessions (id, machine_id, model, started_at, project)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertRequest = db.prepare(`
    INSERT OR IGNORE INTO api_requests
      (id, session_id, ts, prompt_id, model, cost_usd,
       input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
       event_sequence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  const tx = db.transaction((entries: JsonlEntry[]) => {
    // Upsert machine
    upsertMachine.run(machineId, now, now);

    // Track affected sessions for aggregation refresh
    const affectedSessions = new Set<string>();

    for (const entry of entries) {
      const sessionId = entry.sessionId;
      affectedSessions.add(sessionId);

      // Upsert session
      const startedAtMs = new Date(entry.timestamp).getTime();
      const project = extractProject(entry.cwd);
      upsertSession.run(sessionId, machineId, entry.message?.model ?? 'unknown', startedAtMs, project);

      // Insert api_request
      if (entry.message) {
        const ts = startedAtMs * 1000; // Convert to microseconds
        const cacheCreationTokens = entry.message.usage?.cache_creation_input_tokens ?? 0;
        const cacheReadTokens = entry.message.usage?.cache_read_input_tokens ?? 0;

        // Columns: id, session_id, ts, prompt_id, model, cost_usd,
        //          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, event_sequence
        insertRequest.run(
          entry.message.id,                               // id
          sessionId,                                      // session_id
          ts,                                             // ts
          entry.message.id,                               // prompt_id
          entry.message.model,                            // model
          entry.costUSD,                                  // cost_usd
          entry.message.usage?.input_tokens ?? 0,        // input_tokens
          entry.message.usage?.output_tokens ?? 0,       // output_tokens
          cacheReadTokens,                                // cache_read_tokens
          cacheCreationTokens,                            // cache_creation_tokens
          0                                               // event_sequence
        );
      }
    }

    // Refresh aggregates for all affected sessions
    for (const sid of affectedSessions) {
      refreshSession.run(sid, sid, sid, sid, sid, sid);
    }
  });

  tx(entries);
}

/**
 * Extract project name from cwd if available.
 */
function extractProject(cwd?: string): string {
  if (!cwd) return '';
  // Return the last path component as the project name
  const parts = cwd.split('/');
  return parts[parts.length - 1] || '';
}
