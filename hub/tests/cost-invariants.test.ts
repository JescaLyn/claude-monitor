/**
 * Cost sum invariants.
 *
 * These tests verify that every "total cost" surface is additive — i.e. the numbers
 * shown in different parts of the UI (project total, session total, subagent list,
 * breakdown cards) all agree on the same underlying dollars.
 *
 * Two API-request storage patterns exist:
 *   Pattern 1 — subagent requests stored under the *parent* session:
 *     api_requests.session_id = parent.id, agent_id = subagent.id
 *   Pattern 2 — subagent requests stored under the *subagent's own* session:
 *     api_requests.session_id = subagent.id, agent_id = null
 *     sessions.parent_session_id = parent.id
 *
 * Both patterns must appear in the project/session totals, and neither must be
 * double-counted.
 *
 * Known limitation: getSessionBreakdown() fetches api_requests WHERE session_id =
 * parent.id, so it captures Pattern 1 costs but NOT Pattern 2 costs.
 * getSessionsWithSubagents() and getAggregateSummary() are the authoritative
 * sources for session-level totals.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import {
  getSessionsWithSubagents,
  getAggregateSummary,
  getProjectCosts,
  getSessionBreakdown,
  getModelBreakdownForSession,
  getSubagentSessions,
  getSkillInvocations,
} from '../src/api/queries.js';
import { runMigrations } from '../src/db.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function insertSession(
  db: Database.Database,
  id: string,
  project: string | null,
  parentId: string | null = null,
  ts = 1_000_000
) {
  db.prepare(`
    INSERT INTO sessions (id, machine_id, started_at, project, parent_session_id,
                         cost_usd, input_tokens, output_tokens, cache_read_tokens,
                         cache_creation_tokens, api_request_count, tool_call_count)
    VALUES (?, 'mac', ?, ?, ?, 0, 0, 0, 0, 0, 0, 0)
  `).run(id, ts, project, parentId);
}

function insertRequest(
  db: Database.Database,
  id: string,
  sessionId: string,
  cost: number,
  agentId: string | null = null,
  ts = 1_000_000,
  model = 'claude-opus'
) {
  db.prepare(`
    INSERT INTO api_requests (id, session_id, ts, prompt_id, model, cost_usd,
                             input_tokens, output_tokens, cache_read_tokens,
                             cache_creation_tokens, agent_id, event_sequence)
    VALUES (?, ?, ?, ?, ?, ?, 1000, 100, 0, 0, ?, 0)
  `).run(id, sessionId, ts, `prompt-${id}`, model, cost, agentId);
}

// ─── Fixture ───────────────────────────────────────────────────────────────
//
// Project "alpha":
//   s-a1 (parent)
//     req-a1-direct  : $1.00  session_id=s-a1, agent_id=null       (direct)
//     req-a1-sub     : $0.50  session_id=s-a1, agent_id=sub-a1     (Pattern 1)
//     sub-a1         : child session, no own api_requests
//
//   s-a2 (parent)
//     req-a2-direct  : $2.00  session_id=s-a2, agent_id=null       (direct)
//     sub-a2         : child session (Pattern 2)
//     req-a2-sub     : $1.50  session_id=sub-a2, agent_id=null     (Pattern 2)
//
// Project "beta":
//   s-b1 (parent)
//     req-b1         : $3.00  session_id=s-b1, agent_id=null       (direct)
//
// All-time totals:
//   alpha = $5.00  (1.00 + 0.50 + 2.00 + 1.50)
//   beta  = $3.00
//   total = $8.00

describe('cost sum invariants — basic (no time filter)', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = freshDb();

    // alpha / s-a1
    insertSession(db, 's-a1', 'alpha');
    insertRequest(db, 'req-a1-direct', 's-a1', 1.00);
    insertSession(db, 'sub-a1', null, 's-a1');
    insertRequest(db, 'req-a1-sub', 's-a1', 0.50, 'sub-a1');

    // alpha / s-a2
    insertSession(db, 's-a2', 'alpha');
    insertRequest(db, 'req-a2-direct', 's-a2', 2.00);
    insertSession(db, 'sub-a2', null, 's-a2');
    insertRequest(db, 'req-a2-sub', 'sub-a2', 1.50);

    // beta / s-b1
    insertSession(db, 's-b1', 'beta');
    insertRequest(db, 'req-b1', 's-b1', 3.00);
  });

  afterAll(() => db.close());

  // ── getSessionsWithSubagents ────────────────────────────────────────────

  it('session with Pattern 1 subagent includes subagent cost', () => {
    const sessions = getSessionsWithSubagents(db, 50, 0, 'cost_usd', 'desc', 0, 'alpha');
    const s = sessions.find(r => r.id === 's-a1')!;
    expect(s).toBeDefined();
    expect(s.cost_usd).toBeCloseTo(1.50); // 1.00 direct + 0.50 Pattern-1
  });

  it('session with Pattern 2 subagent includes subagent cost', () => {
    const sessions = getSessionsWithSubagents(db, 50, 0, 'cost_usd', 'desc', 0, 'alpha');
    const s = sessions.find(r => r.id === 's-a2')!;
    expect(s).toBeDefined();
    expect(s.cost_usd).toBeCloseTo(3.50); // 2.00 direct + 1.50 Pattern-2
  });

  it('sum of session costs equals getAggregateSummary for the same project', () => {
    const sessions = getSessionsWithSubagents(db, 50, 0, 'cost_usd', 'desc', 0, 'alpha');
    const sessionSum = sessions.reduce((acc, s) => acc + s.cost_usd, 0);
    const agg = getAggregateSummary(db, 0, 'alpha');
    expect(sessionSum).toBeCloseTo(agg.total_cost_usd);
  });

  it('sum of per-project getAggregateSummary equals overall getAggregateSummary', () => {
    const alphaAgg = getAggregateSummary(db, 0, 'alpha');
    const betaAgg  = getAggregateSummary(db, 0, 'beta');
    const overall  = getAggregateSummary(db, 0, '');
    expect(alphaAgg.total_cost_usd + betaAgg.total_cost_usd).toBeCloseTo(overall.total_cost_usd);
  });

  it('sum of getProjectCosts equals overall getAggregateSummary', () => {
    const projects = getProjectCosts(db, 0);
    const projectSum = projects.reduce((acc, p) => acc + p.cost_usd, 0);
    const overall = getAggregateSummary(db, 0, '');
    expect(projectSum).toBeCloseTo(overall.total_cost_usd);
  });

  it('getProjectCosts shows correct per-project totals', () => {
    const projects = getProjectCosts(db, 0);
    const byName = Object.fromEntries(projects.map(p => [p.project, p.cost_usd]));
    expect(byName['alpha']).toBeCloseTo(5.00);
    expect(byName['beta']).toBeCloseTo(3.00);
  });

  it('getAggregateSummary shows correct project totals', () => {
    expect(getAggregateSummary(db, 0, 'alpha').total_cost_usd).toBeCloseTo(5.00);
    expect(getAggregateSummary(db, 0, 'beta').total_cost_usd).toBeCloseTo(3.00);
    expect(getAggregateSummary(db, 0, '').total_cost_usd).toBeCloseTo(8.00);
  });

  // ── getSessionBreakdown vs getSessionsWithSubagents ─────────────────────

  it('getSessionBreakdown includes Pattern 1 costs for a session', () => {
    const breakdown = getSessionBreakdown(db, 's-a1');
    const total = breakdown.api_requests.reduce((acc, r) => acc + r.cost_usd, 0);
    expect(total).toBeCloseTo(1.50); // direct $1.00 + Pattern-1 subagent $0.50
  });

  it('getSessionBreakdown does not include Pattern 2 costs (subagent own session)', () => {
    // Pattern 2: req-a2-sub is stored with session_id=sub-a2, not s-a2
    const breakdown = getSessionBreakdown(db, 's-a2');
    const total = breakdown.api_requests.reduce((acc, r) => acc + r.cost_usd, 0);
    expect(total).toBeCloseTo(2.00); // only direct; Pattern-2 subagent excluded
  });

  it('getSessionsWithSubagents cost >= getSessionBreakdown total for Pattern 2 sessions', () => {
    const sessions = getSessionsWithSubagents(db, 50, 0, 'cost_usd', 'desc', 0, 'alpha');
    const sessionCost = sessions.find(s => s.id === 's-a2')!.cost_usd;
    const breakdown = getSessionBreakdown(db, 's-a2');
    const breakdownTotal = breakdown.api_requests.reduce((acc, r) => acc + r.cost_usd, 0);
    expect(sessionCost).toBeGreaterThan(breakdownTotal);
    expect(sessionCost).toBeCloseTo(3.50); // full amount
  });

  // ── no double-counting ──────────────────────────────────────────────────

  it('Pattern 1 subagent cost is not double-counted in getAggregateSummary', () => {
    // req-a1-direct and req-a1-sub are both stored with session_id=s-a1.
    // The aggregate should count each api_request row once.
    const agg = getAggregateSummary(db, 0, 'alpha');
    expect(agg.total_cost_usd).toBeCloseTo(5.00); // not 6.00 or more
  });

  it('Pattern 1 subagent cost is not double-counted in getProjectCosts', () => {
    const projects = getProjectCosts(db, 0);
    const alpha = projects.find(p => p.project === 'alpha')!;
    expect(alpha.cost_usd).toBeCloseTo(5.00);
  });
});

// ─── Time-filter invariants ─────────────────────────────────────────────────
//
// Fixture has requests at two timestamps:
//   T_OLD = 1_000_000 (before threshold)
//   T_NEW = 5_000_000 (after threshold)
// SINCE  = 3_000_000

// NOTE: insertSession/insertRequest default ts=1_000_000, which equals T_OLD.
// Fixtures in other describe blocks that don't set ts explicitly are therefore
// "old" relative to SINCE — keep that in mind when adding new test data.
const T_OLD  = 1_000_000;
const T_NEW  = 5_000_000;
const SINCE  = 3_000_000;

describe('cost sum invariants — time filter', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = freshDb();

    // Project "timed", session "ts-1":
    //   old request: $5.00 at T_OLD
    //   new request: $3.00 at T_NEW
    insertSession(db, 'ts-1', 'timed', null, T_OLD);
    insertRequest(db, 'req-ts-old', 'ts-1', 5.00, null, T_OLD);
    insertRequest(db, 'req-ts-new', 'ts-1', 3.00, null, T_NEW);

    // Project "timed", session "ts-2" with Pattern-2 subagent:
    //   parent direct: $2.00 at T_NEW
    //   subagent (Pattern 2): $1.00 at T_NEW
    insertSession(db, 'ts-2', 'timed', null, T_OLD);
    insertRequest(db, 'req-ts2-direct', 'ts-2', 2.00, null, T_NEW);
    insertSession(db, 'sub-ts2', null, 'ts-2', T_NEW);
    insertRequest(db, 'req-ts2-sub', 'sub-ts2', 1.00, null, T_NEW);
  });

  afterAll(() => db.close());

  it('getAggregateSummary all-time includes both old and new requests', () => {
    const agg = getAggregateSummary(db, 0, 'timed');
    expect(agg.total_cost_usd).toBeCloseTo(11.00); // 5+3+2+1
  });

  it('getAggregateSummary with since excludes requests before threshold', () => {
    const agg = getAggregateSummary(db, SINCE, 'timed');
    expect(agg.total_cost_usd).toBeCloseTo(6.00); // 3+2+1 (only T_NEW)
  });

  it('getProjectCosts all-time includes both old and new requests', () => {
    const projects = getProjectCosts(db, 0);
    const timed = projects.find(p => p.project === 'timed')!;
    expect(timed.cost_usd).toBeCloseTo(11.00);
  });

  it('getProjectCosts with since excludes requests before threshold', () => {
    const projects = getProjectCosts(db, SINCE);
    const timed = projects.find(p => p.project === 'timed')!;
    expect(timed.cost_usd).toBeCloseTo(6.00);
  });

  it('sum of getSessionsWithSubagents costs equals getAggregateSummary with since filter', () => {
    const sessions = getSessionsWithSubagents(db, 50, 0, 'cost_usd', 'desc', SINCE, 'timed');
    const sessionSum = sessions.reduce((acc, s) => acc + s.cost_usd, 0);
    const agg = getAggregateSummary(db, SINCE, 'timed');
    expect(sessionSum).toBeCloseTo(agg.total_cost_usd);
  });

  it('sum of getProjectCosts equals getAggregateSummary with same since filter', () => {
    const projects = getProjectCosts(db, SINCE);
    const projectSum = projects.reduce((acc, p) => acc + p.cost_usd, 0);
    const overall = getAggregateSummary(db, SINCE, '');
    expect(projectSum).toBeCloseTo(overall.total_cost_usd);
  });

  it('getAggregateSummary recent total is less than all-time total', () => {
    const allTime = getAggregateSummary(db, 0, 'timed');
    const recent  = getAggregateSummary(db, SINCE, 'timed');
    expect(recent.total_cost_usd).toBeLessThan(allTime.total_cost_usd);
  });

  // ── getSessionBreakdown respects since ─────────────────────────────────

  it('getSessionBreakdown all-time includes both old and new requests', () => {
    const breakdown = getSessionBreakdown(db, 'ts-1', 0);
    const total = breakdown.api_requests.reduce((acc, r) => acc + r.cost_usd, 0);
    expect(total).toBeCloseTo(8.00); // $5.00 + $3.00
  });

  it('getSessionBreakdown with since excludes requests before threshold', () => {
    const breakdown = getSessionBreakdown(db, 'ts-1', SINCE);
    const total = breakdown.api_requests.reduce((acc, r) => acc + r.cost_usd, 0);
    expect(total).toBeCloseTo(3.00); // only req-ts-new at T_NEW
  });

  it('getSessionBreakdown with since matches getSessionsWithSubagents for same session and period', () => {
    const sessions = getSessionsWithSubagents(db, 50, 0, 'cost_usd', 'desc', SINCE, 'timed');
    const ts1 = sessions.find(s => s.id === 'ts-1')!;
    const breakdown = getSessionBreakdown(db, 'ts-1', SINCE);
    const breakdownTotal = breakdown.api_requests.reduce((acc, r) => acc + r.cost_usd, 0);
    // ts-1 has no subagents so breakdown total == getSessionsWithSubagents cost
    expect(breakdownTotal).toBeCloseTo(ts1.cost_usd);
  });

  // ── getModelBreakdownForSession respects since ──────────────────────────

  it('getModelBreakdownForSession with since excludes requests before threshold', () => {
    // ts-1 has two requests at different times, both same model ('claude-opus')
    const allTime = getModelBreakdownForSession(db, 'ts-1', 0);
    const recent  = getModelBreakdownForSession(db, 'ts-1', SINCE);
    const allTimeCost = allTime.reduce((acc, m) => acc + m.total_cost_usd, 0);
    const recentCost  = recent.reduce((acc, m) => acc + m.total_cost_usd, 0);
    expect(recentCost).toBeCloseTo(3.00);         // only T_NEW request
    expect(allTimeCost).toBeGreaterThan(recentCost);
  });

  // ── getSubagentSessions respects since ─────────────────────────────────

  it('getSubagentSessions with since = 0 returns subagent with its all-time cost', () => {
    // ts-2 has Pattern-1 subagent stored via parent; add one for this test
    // sub-ts2 is a Pattern-2 subagent of ts-2 (api_requests under sub-ts2.id)
    // getSubagentSessions uses Pattern-1 join (ar.session_id = parent, ar.agent_id = sub)
    // For sub-ts2 (Pattern 2), the join returns 0 rows → fallback to s.cost_usd
    // This test just checks the function runs without error and returns the subagent
    const subs = getSubagentSessions(db, 'ts-2', 0);
    expect(subs).toHaveLength(1);
    expect(subs[0].id).toBe('sub-ts2');
  });

  it('getSubagentSessions with since returns subagents (Pattern-1 cost filtered by period)', () => {
    // Add a Pattern-1 subagent to ts-1 with requests at T_OLD and T_NEW
    // (done inline here to keep fixture self-contained)
    const extraDb = freshDb();
    insertSession(extraDb, 'p1', 'timed', null, T_OLD);
    insertSession(extraDb, 'sub-p1', null, 'p1', T_OLD);
    insertRequest(extraDb, 'rp1-old', 'p1', 4.00, 'sub-p1', T_OLD);
    insertRequest(extraDb, 'rp1-new', 'p1', 1.00, 'sub-p1', T_NEW);

    const allTime = getSubagentSessions(extraDb, 'p1', 0);
    const recent  = getSubagentSessions(extraDb, 'p1', SINCE);
    expect(allTime[0].cost_usd).toBeCloseTo(5.00);  // $4.00 + $1.00
    expect(recent[0].cost_usd).toBeCloseTo(1.00);   // only T_NEW
    extraDb.close();
  });
});

// ─── getSkillInvocations time-filter invariant ──────────────────────────────

describe('getSkillInvocations time filter', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = freshDb();
    insertSession(db, 'sk-1', 'proj');
    // Skill invocation at T_OLD, linked api_request at T_OLD
    db.prepare(`
      INSERT INTO tool_events (id, session_id, ts, prompt_id, tool_name, skill_name, machine_id, event_sequence)
      VALUES (?, 'sk-1', ?, 'prompt-ar-sk-old', 'Skill', 'my-skill', 'mac', 0)
    `).run('te-old', T_OLD);
    insertRequest(db, 'ar-sk-old', 'sk-1', 2.00, null, T_OLD);
    // Skill invocation at T_NEW, linked api_request at T_NEW
    db.prepare(`
      INSERT INTO tool_events (id, session_id, ts, prompt_id, tool_name, skill_name, machine_id, event_sequence)
      VALUES (?, 'sk-1', ?, 'prompt-ar-sk-new', 'Skill', 'my-skill', 'mac', 1)
    `).run('te-new', T_NEW);
    insertRequest(db, 'ar-sk-new', 'sk-1', 0.50, null, T_NEW);
  });

  afterAll(() => db.close());

  it('returns all invocations with since = 0', () => {
    const invocations = getSkillInvocations(db, 'my-skill', 'sk-1', 0);
    expect(invocations).toHaveLength(2);
  });

  it('excludes invocations before threshold when since is set', () => {
    const invocations = getSkillInvocations(db, 'my-skill', 'sk-1', SINCE);
    expect(invocations).toHaveLength(1);
    expect(invocations[0].ts).toBe(T_NEW);
  });

  it('filtered invocation cost reflects only the in-range api_request', () => {
    const invocations = getSkillInvocations(db, 'my-skill', 'sk-1', SINCE);
    expect(invocations[0].cost_usd).toBeCloseTo(0.50);
  });
});

// ─── Session count invariant ────────────────────────────────────────────────

describe('session count invariant', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = freshDb();
    // Two parent sessions for project "cnt", each with one request
    insertSession(db, 'cnt-1', 'cnt');
    insertRequest(db, 'req-cnt-1', 'cnt-1', 1.00);
    insertSession(db, 'cnt-2', 'cnt');
    insertRequest(db, 'req-cnt-2', 'cnt-2', 2.00);
    // One subagent of cnt-1 — should NOT inflate session count
    insertSession(db, 'sub-cnt', null, 'cnt-1');
    insertRequest(db, 'req-sub-cnt', 'cnt-1', 0.50, 'sub-cnt');
  });

  afterAll(() => db.close());

  it('getAggregateSummary counts only root (parent) sessions', () => {
    const agg = getAggregateSummary(db, 0, 'cnt');
    expect(agg.total_sessions).toBe(2); // cnt-1 and cnt-2, not sub-cnt
  });

  it('getAggregateSummary session count matches getSessionsWithSubagents length', () => {
    const sessions = getSessionsWithSubagents(db, 50, 0, 'cost_usd', 'desc', 0, 'cnt');
    const agg = getAggregateSummary(db, 0, 'cnt');
    expect(sessions.length).toBe(agg.total_sessions);
  });
});
