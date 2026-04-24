import type Database from 'better-sqlite3';
import { JsonlEntry } from './parser.js';

export function ingestJsonlEntries(
  db: Database.Database,
  entries: JsonlEntry[],
  machineId: string,
  filePath?: string
): void {
  const upsertMachine = db.prepare(`
    INSERT INTO machines (id, first_seen, last_seen) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen
  `);

  const upsertSession = db.prepare(`
    INSERT OR IGNORE INTO sessions (id, machine_id, model, started_at, project, parent_session_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertRequest = db.prepare(`
    INSERT OR IGNORE INTO api_requests
      (id, session_id, ts, prompt_id, model, cost_usd,
       input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
       agent_id, event_sequence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const upsertSubagentSession = db.prepare(`
    INSERT OR IGNORE INTO sessions (id, machine_id, model, started_at, project, parent_session_id, api_request_count, tool_call_count, last_event_ts)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)
  `);

  const refreshSession = db.prepare(`
    UPDATE sessions SET
      cost_usd              = (SELECT COALESCE(SUM(cost_usd), 0)              FROM api_requests WHERE session_id = ? AND (agent_id IS NULL OR agent_id = ?)),
      input_tokens          = (SELECT COALESCE(SUM(input_tokens), 0)          FROM api_requests WHERE session_id = ? AND (agent_id IS NULL OR agent_id = ?)),
      output_tokens         = (SELECT COALESCE(SUM(output_tokens), 0)         FROM api_requests WHERE session_id = ? AND (agent_id IS NULL OR agent_id = ?)),
      cache_read_tokens     = (SELECT COALESCE(SUM(cache_read_tokens), 0)     FROM api_requests WHERE session_id = ? AND (agent_id IS NULL OR agent_id = ?)),
      cache_creation_tokens = (SELECT COALESCE(SUM(cache_creation_tokens), 0) FROM api_requests WHERE session_id = ? AND (agent_id IS NULL OR agent_id = ?)),
      api_request_count     = (SELECT COUNT(*) FROM api_requests WHERE session_id = ? AND (agent_id IS NULL OR agent_id = ?)),
      tool_call_count       = (SELECT COUNT(*) FROM tool_events WHERE session_id = ?),
      last_event_ts         = (SELECT MAX(ts) FROM (SELECT ts FROM api_requests WHERE session_id = ? AND (agent_id IS NULL OR agent_id = ?) UNION ALL SELECT ts FROM tool_events WHERE session_id = ?))
    WHERE id = ?
  `);

  const now = Date.now() * 1000;

  const tx = db.transaction((entries: JsonlEntry[]) => {
    // Upsert machine
    upsertMachine.run(machineId, now, now);

    // Track affected sessions for aggregation refresh
    const affectedSessions = new Set<string>();
    const subagentIds = new Set<string>();
    const subagentParents = new Map<string, string>(); // agentId -> sessionId (actual parent)

    // Extract metadata from first entry (all entries in a batch share the same project/parent)
    const project = entries.length > 0 ? extractProject(entries[0].cwd) : '';
    const parentSessionId = filePath ? extractParentSessionId(filePath) : null;

    // First pass: process api_requests and collect parent session/project info
    for (const entry of entries) {
      const sessionId = entry.sessionId;
      affectedSessions.add(sessionId);

      // Upsert session
      const startedAtMs = new Date(entry.timestamp).getTime();
      upsertSession.run(sessionId, machineId, entry.message?.model ?? 'unknown', startedAtMs, project, parentSessionId);

      // Insert api_request
      if (entry.message) {
        const ts = startedAtMs * 1000; // Convert to microseconds
        const cacheCreationTokens = entry.message.usage?.cache_creation_input_tokens ?? 0;
        const cacheReadTokens = entry.message.usage?.cache_read_input_tokens ?? 0;
        const agentId = entry.agentId || null;  // Extract agentId from entry

        // Columns: id, session_id, ts, prompt_id, model, cost_usd,
        //          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, agent_id, event_sequence
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
          agentId,                                        // agent_id
          0                                               // event_sequence
        );
      }

      // Collect subagent IDs and track their actual parent session
      if (entry.agentId) {
        subagentIds.add(entry.agentId);
        subagentParents.set(entry.agentId, sessionId); // Link agentId to its actual parent sessionId
      }
    }

    // Create synthetic subagent sessions from agentId entries
    for (const subagentId of subagentIds) {
      // Create subagent session if it doesn't exist
      // Link each subagent to the actual sessionId that spawned it, not the batch-level parentSessionId
      const actualParentSessionId = subagentParents.get(subagentId) ?? null;
      upsertSubagentSession.run(subagentId, machineId, null, now, project, actualParentSessionId, now);
      affectedSessions.add(subagentId);
    }

    // Refresh aggregates for all affected sessions (parent + subagents)
    for (const sid of affectedSessions) {
      const isSubagent = subagentIds.has(sid);
      const filterId = isSubagent ? sid : null;
      // refreshSession.run needs: cost_usd(sid, filterid), input_tokens(sid, filterid), output_tokens(sid, filterid),
      // cache_read_tokens(sid, filterid), cache_creation_tokens(sid, filterid), api_request_count(sid, filterid),
      // tool_call_count(sid), last_event_ts(sid, filterid, sid), where(id)
      refreshSession.run(
        sid, filterId, sid, filterId, sid, filterId, sid, filterId, sid, filterId,
        sid, filterId, sid, sid, filterId, sid, sid
      );
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

/**
 * Extract parent session ID from subagent file path.
 * Example: /path/to/PARENT_ID/subagents/agent-*.jsonl → PARENT_ID
 * Returns null if not a subagent session.
 */
function extractParentSessionId(filePath: string): string | null {
  const parts = filePath.split('/');
  const subagentsIndex = parts.indexOf('subagents');
  if (subagentsIndex > 0) {
    // Parent session ID is the directory before 'subagents'
    return parts[subagentsIndex - 1] || null;
  }
  return null;
}
