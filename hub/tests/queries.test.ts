import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { getSessionsWithSubagents } from '../src/api/queries.js';
import { runMigrations } from '../src/db.js';

describe('getSessionsWithSubagents', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(':memory:');
    runMigrations(db);

    // Insert parent session
    db.prepare(`
      INSERT INTO sessions (id, machine_id, started_at, cost_usd, input_tokens,
                           output_tokens, cache_read_tokens, cache_creation_tokens,
                           api_request_count, tool_call_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('parent-1', 'macbook', 1000000, 0.50, 10000, 1000, 0, 0, 10, 5);

    // Insert API request for parent
    db.prepare(`
      INSERT INTO api_requests (id, session_id, ts, prompt_id, model, cost_usd,
                               input_tokens, output_tokens, cache_read_tokens,
                               cache_creation_tokens, agent_id, event_sequence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('req-1', 'parent-1', 1000000, 'prompt-1', 'claude-opus', 0.50, 10000, 1000, 0, 0, null, 0);

    // Insert subagent session
    db.prepare(`
      INSERT INTO sessions (id, machine_id, model, started_at, parent_session_id,
                           cost_usd, input_tokens, output_tokens, cache_read_tokens,
                           cache_creation_tokens, api_request_count, tool_call_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('subagent-a', 'macbook', 'subagent-a', 1000000, 'parent-1', 0.30, 5000, 500, 0, 0, 5, 2);

    // Insert API request for subagent
    db.prepare(`
      INSERT INTO api_requests (id, session_id, ts, prompt_id, model, cost_usd,
                               input_tokens, output_tokens, cache_read_tokens,
                               cache_creation_tokens, agent_id, event_sequence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('req-2', 'parent-1', 1000000, 'prompt-2', 'claude-sonnet', 0.30, 5000, 500, 0, 0, 'subagent-a', 0);
  });

  afterAll(() => {
    db.close();
  });

  it('returns parent session with aggregated costs', () => {
    const result = getSessionsWithSubagents(db, 50, 0, 'cost_usd', 'desc');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('parent-1');
    expect(result[0].cost_usd).toBe(0.80);  // 0.50 parent + 0.30 subagent
    expect(result[0].input_tokens).toBe(15000);  // 10000 + 5000
  });

  it('includes subagents array with individual metrics', () => {
    const result = getSessionsWithSubagents(db, 50, 0, 'cost_usd', 'desc');
    expect(result[0].subagents).toHaveLength(1);
    expect(result[0].subagents[0].id).toBe('subagent-a');
    expect(result[0].subagents[0].cost_usd).toBe(0.30);
    expect(result[0].subagents[0].input_tokens).toBe(5000);
  });

  it('sorts by parent total cost descending', () => {
    // Insert second parent with lower cost
    db.prepare(`
      INSERT INTO sessions (id, machine_id, started_at, cost_usd, input_tokens,
                           output_tokens, cache_read_tokens, cache_creation_tokens,
                           api_request_count, tool_call_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('parent-2', 'zima', 1000100, 0.10, 2000, 200, 0, 0, 2, 1);

    db.prepare(`
      INSERT INTO api_requests (id, session_id, ts, prompt_id, model, cost_usd,
                               input_tokens, output_tokens, cache_read_tokens,
                               cache_creation_tokens, agent_id, event_sequence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('req-3', 'parent-2', 1000100, 'prompt-3', 'claude-haiku', 0.10, 2000, 200, 0, 0, null, 0);

    const result = getSessionsWithSubagents(db, 50, 0, 'cost_usd', 'desc');
    expect(result[0].id).toBe('parent-1');  // 0.80 cost
    expect(result[1].id).toBe('parent-2');  // 0.10 cost
  });

  it('returns empty subagents array for parent with no subagents', () => {
    // Insert parent with no subagents
    db.prepare(`
      INSERT INTO sessions (id, machine_id, started_at, cost_usd, input_tokens,
                           output_tokens, cache_read_tokens, cache_creation_tokens,
                           api_request_count, tool_call_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('parent-3', 'macbook', 1000200, 0.05, 1000, 100, 0, 0, 1, 0);

    db.prepare(`
      INSERT INTO api_requests (id, session_id, ts, prompt_id, model, cost_usd,
                               input_tokens, output_tokens, cache_read_tokens,
                               cache_creation_tokens, agent_id, event_sequence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('req-4', 'parent-3', 1000200, 'prompt-4', 'claude-haiku', 0.05, 1000, 100, 0, 0, null, 0);

    const result = getSessionsWithSubagents(db, 50, 0, 'cost_usd', 'desc');
    const parent3 = result.find(r => r.id === 'parent-3');
    expect(parent3).toBeDefined();
    expect(parent3!.subagents).toHaveLength(0);
  });
});
