import type Database from 'better-sqlite3';
import type {
  SkillCostBreakdown,
  SubagentCostBreakdown,
  ApiRequestDetail,
  SessionToolBreakdown,
  SkillInvocation,
} from '../types.js';

export interface OverviewStats {
  total_cost_usd: number;
  total_sessions: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_creation_tokens: number;
  total_api_requests: number;
}

export interface SessionRow {
  id: string;
  machine_id: string;
  name: string | null;
  model: string | null;
  started_at: number;
  ended_at: number | null;
  last_event_ts: number | null;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  api_request_count: number;
  tool_call_count: number;
  parent_session_id: string | null;
}

export interface SubagentRow {
  id: string;
  name: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  api_request_count: number;
}

export interface SessionWithSubagents extends SessionRow {
  subagents: SubagentRow[];
}

export interface ToolStat {
  tool_name: string;
  call_count: number;
  success_count: number;
  failure_count: number;
  avg_duration_ms: number | null;
}

export interface SkillStat {
  skill_name: string;
  call_count: number;
  success_count: number;
}

export interface CostByDay {
  day: string;
  cost_usd: number;
  api_request_count: number;
}

export interface CostByModel {
  model: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

export interface CostByMachine {
  machine_id: string;
  cost_usd: number;
  session_count: number;
}

export function getOverview(db: Database.Database): OverviewStats {
  return db.prepare(`
    SELECT
      (SELECT COALESCE(SUM(cost_usd), 0) FROM sessions) AS total_cost_usd,
      COUNT(*)                                AS total_sessions,
      (SELECT COALESCE(SUM(input_tokens), 0) FROM sessions)          AS total_input_tokens,
      (SELECT COALESCE(SUM(output_tokens), 0) FROM sessions)         AS total_output_tokens,
      (SELECT COALESCE(SUM(cache_read_tokens), 0) FROM sessions)     AS total_cache_read_tokens,
      (SELECT COALESCE(SUM(cache_creation_tokens), 0) FROM sessions) AS total_cache_creation_tokens,
      (SELECT COUNT(*) FROM api_requests)     AS total_api_requests
    FROM sessions
    WHERE parent_session_id IS NULL
  `).get() as OverviewStats;
}

const VALID_SORT_FIELDS = new Set(['started_at', 'last_event_ts', 'cost_usd', 'machine_id', 'tool_call_count', 'api_request_count']);
const VALID_ORDERS = new Set(['asc', 'desc']);

// Qualify table-column sorts with alias to avoid ambiguity in the JOIN query.
// Aggregate alias columns (tool_call_count, api_request_count, last_event_ts) are referenced by alias.
const SORT_EXPR: Record<string, string> = {
  started_at:        's.started_at',
  last_event_ts:     'last_event_ts',
  cost_usd:          's.cost_usd',
  machine_id:        's.machine_id',
  tool_call_count:   'tool_call_count',
  api_request_count: 'api_request_count',
};

export function getSessions(
  db: Database.Database,
  limit = 50,
  offset = 0,
  sort = 'last_event_ts',
  order = 'desc'
): SessionRow[] {
  if (!VALID_SORT_FIELDS.has(sort)) throw new Error(`Invalid sort field: ${sort}`);
  if (!VALID_ORDERS.has(order)) throw new Error(`Invalid order: ${order}`);
  const sortExpr = SORT_EXPR[sort];

  // Read pre-computed denormalized counts from the sessions table for fast query
  return db.prepare(`
    SELECT
      id, machine_id, name, model, started_at, ended_at,
      cost_usd, input_tokens, output_tokens,
      cache_read_tokens, cache_creation_tokens,
      parent_session_id,
      api_request_count, tool_call_count, last_event_ts
    FROM sessions
    WHERE parent_session_id IS NULL
    ORDER BY ${sortExpr} ${order}
    LIMIT ? OFFSET ?
  `).all(limit, offset) as SessionRow[];
}

export function getSessionsWithSubagents(
  db: Database.Database,
  limit = 50,
  offset = 0,
  sort = 'last_event_ts',
  order = 'desc'
): SessionWithSubagents[] {
  if (!VALID_SORT_FIELDS.has(sort)) throw new Error(`Invalid sort field: ${sort}`);
  if (!VALID_ORDERS.has(order)) throw new Error(`Invalid order: ${order}`);
  const sortExpr = SORT_EXPR[sort];

  // Fetch parent sessions (with aggregated totals including subagents)
  const parentSessions = db.prepare(`
    SELECT
      s.id, s.machine_id, s.name, s.model, s.started_at, s.ended_at,
      COALESCE(SUM(ar.cost_usd), 0) AS cost_usd,
      COALESCE(SUM(ar.input_tokens), 0) AS input_tokens,
      COALESCE(SUM(ar.output_tokens), 0) AS output_tokens,
      COALESCE(SUM(ar.cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(ar.cache_creation_tokens), 0) AS cache_creation_tokens,
      COUNT(DISTINCT ar.id) AS api_request_count,
      (SELECT COUNT(*) FROM tool_events WHERE session_id = s.id OR parent_session_id = s.id) AS tool_call_count,
      MAX(ar.ts) AS last_event_ts,
      s.parent_session_id
    FROM sessions s
    LEFT JOIN api_requests ar ON ar.session_id = s.id OR ar.session_id IN (
      SELECT id FROM sessions WHERE parent_session_id = s.id
    )
    WHERE s.parent_session_id IS NULL
    GROUP BY s.id
    ORDER BY ${sortExpr} ${order}
    LIMIT ? OFFSET ?
  `).all(limit, offset) as Omit<SessionWithSubagents, 'subagents'>[];

  // Fetch all subagents for all parents in one query (prevents N+1)
  const subagentsByParent: Record<string, SubagentRow[]> = {};
  const parentIds = parentSessions.map(p => p.id);

  if (parentIds.length > 0) {
    const allSubagents = db.prepare(`
      SELECT
        s.id, COALESCE(s.model, s.id) AS name,
        COALESCE(ROUND(
          (SELECT COALESCE(SUM(cost_usd), 0) FROM api_requests WHERE session_id = s.parent_session_id AND agent_id IS NULL) *
          COUNT(DISTINCT ar.id) /
          NULLIF((SELECT COUNT(*) FROM api_requests WHERE session_id = s.parent_session_id), 0),
          8), 0) AS cost_usd,
        COALESCE(SUM(ar.input_tokens), 0) AS input_tokens,
        COALESCE(SUM(ar.output_tokens), 0) AS output_tokens,
        COALESCE(SUM(ar.cache_read_tokens), 0) AS cache_read_tokens,
        COALESCE(SUM(ar.cache_creation_tokens), 0) AS cache_creation_tokens,
        COUNT(DISTINCT ar.id) AS api_request_count,
        s.parent_session_id
      FROM sessions s
      LEFT JOIN api_requests ar ON ar.session_id = s.parent_session_id AND ar.agent_id = s.id
      WHERE s.parent_session_id IN (${parentIds.map(() => '?').join(',')})
      GROUP BY s.id
    `).all(...parentIds) as (SubagentRow & { parent_session_id: string })[];

    // Group by parent_session_id
    for (const subagent of allSubagents) {
      const { parent_session_id, ...subagentRow } = subagent;
      if (!subagentsByParent[parent_session_id]) {
        subagentsByParent[parent_session_id] = [];
      }
      subagentsByParent[parent_session_id].push(subagentRow);
    }
  }

  // Map parents with their subagents
  return parentSessions.map(parent => ({
    ...parent,
    subagents: subagentsByParent[parent.id] || [],
  }));
}

export function getSession(db: Database.Database, id: string): SessionRow | null {
  // Read pre-computed denormalized counts from the sessions table
  return db.prepare(`
    SELECT
      id, machine_id, name, model, started_at, ended_at,
      cost_usd, input_tokens, output_tokens,
      cache_read_tokens, cache_creation_tokens,
      parent_session_id,
      api_request_count, tool_call_count, last_event_ts
    FROM sessions
    WHERE id = ?
  `).get(id) as SessionRow | null;
}

export function setSessionName(db: Database.Database, id: string, name: string): boolean {
  const stmt = db.prepare('UPDATE sessions SET name = ? WHERE id = ?');
  const result = stmt.run(name, id);
  return result.changes > 0;
}

export function getToolStats(db: Database.Database): ToolStat[] {
  return db.prepare(`
    SELECT
      tool_name,
      COUNT(*)                                        AS call_count,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END)   AS success_count,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END)   AS failure_count,
      AVG(duration_ms)                                AS avg_duration_ms
    FROM tool_events
    GROUP BY tool_name
    ORDER BY call_count DESC
  `).all() as ToolStat[];
}

export function getSkillStats(db: Database.Database): SkillStat[] {
  return db.prepare(`
    SELECT
      skill_name,
      COUNT(*)                                        AS call_count,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END)   AS success_count
    FROM tool_events
    WHERE skill_name IS NOT NULL
    GROUP BY skill_name
    ORDER BY call_count DESC
  `).all() as SkillStat[];
}

export function getSkillCostsWithRequests(db: Database.Database): SkillCostBreakdown[] {
  return db.prepare(`
    SELECT
      te.skill_name,
      COUNT(DISTINCT te.id) AS invocation_count,
      COUNT(DISTINCT ar.id) AS api_request_count,
      COALESCE(SUM(ar.cost_usd), 0) AS total_cost_usd,
      COALESCE(SUM(ar.input_tokens), 0) AS total_context_tokens,
      CASE
        WHEN SUM(ar.input_tokens) > 0
        THEN ROUND(SUM(ar.input_tokens) / CAST(SUM(ar.input_tokens) AS REAL), 4)
        ELSE 0
      END AS avg_context_token_ratio
    FROM tool_events te
    LEFT JOIN api_requests ar ON (
      ar.session_id = te.session_id
      AND ar.prompt_id = te.prompt_id
    )
    WHERE te.tool_name = 'Skill' AND te.skill_name IS NOT NULL
    GROUP BY te.skill_name
    ORDER BY total_cost_usd DESC
  `).all() as SkillCostBreakdown[];
}

export function getSubagentCostsWithRequests(db: Database.Database): SubagentCostBreakdown {
  const result = db.prepare(`
    SELECT
      COUNT(DISTINCT te.id) AS invocation_count,
      COUNT(DISTINCT ar.id) AS api_request_count,
      COALESCE(SUM(ar.cost_usd), 0) AS total_cost_usd
    FROM tool_events te
    LEFT JOIN api_requests ar ON (
      ar.session_id = te.session_id
      AND ar.prompt_id = te.prompt_id
    )
    WHERE te.tool_name = 'Agent'
  `).get() as SubagentCostBreakdown | undefined;

  return result || { invocation_count: 0, api_request_count: 0, total_cost_usd: 0 };
}

export function getSkillInvocations(db: Database.Database, skillName: string, sessionId: string): SkillInvocation[] {
  return db.prepare(`
    SELECT
      te.skill_name,
      te.id AS tool_event_id,
      te.ts,
      COALESCE(SUM(ar.cost_usd), 0) AS cost_usd,
      COUNT(DISTINCT ar.id) AS api_request_count,
      te.duration_ms,
      te.success
    FROM tool_events te
    LEFT JOIN api_requests ar ON (
      ar.session_id = te.session_id
      AND ar.prompt_id = te.prompt_id
    )
    WHERE te.tool_name = 'Skill' AND te.skill_name = ? AND te.session_id = ?
    GROUP BY te.id
    ORDER BY te.ts DESC
  `).all(skillName, sessionId) as SkillInvocation[];
}

export interface ApiRequestFilters {
  model?: string;
  sessionId?: string;
  minCost?: number;
  maxCost?: number;
  minDate?: number;
  maxDate?: number;
  isFastMode?: number;
  limit?: number;
  offset?: number;
}

export function getApiRequests(
  db: Database.Database,
  filters: ApiRequestFilters = {}
): ApiRequestDetail[] {
  const {
    model,
    sessionId,
    minCost = 0,
    maxCost = Infinity,
    minDate = 0,
    maxDate = Infinity,
    isFastMode,
    limit = 100,
    offset = 0,
  } = filters;

  let query = `
    SELECT
      ar.id,
      ar.ts,
      ar.session_id,
      ar.model,
      ar.input_tokens,
      ar.cache_read_tokens,
      ar.cache_creation_tokens,
      ar.output_tokens,
      ar.cost_usd,
      ar.duration_ms,
      ar.is_fast_mode
    FROM api_requests ar
    WHERE ar.cost_usd >= ? AND ar.cost_usd <= ?
      AND ar.ts >= ? AND ar.ts <= ?
  `;

  const params: (string | number)[] = [minCost, maxCost, minDate * 1000000, maxDate * 1000000];

  if (model) {
    query += ` AND ar.model = ?`;
    params.push(model);
  }
  if (sessionId) {
    query += ` AND ar.session_id = ?`;
    params.push(sessionId);
  }
  if (isFastMode !== undefined) {
    query += ` AND ar.is_fast_mode = ?`;
    params.push(isFastMode);
  }

  query += ` ORDER BY ar.ts DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return db.prepare(query).all(...params) as ApiRequestDetail[];
}

export function getSessionBreakdown(
  db: Database.Database,
  sessionId: string
): SessionToolBreakdown {
  // Get all skills in this session with their costs
  const skillCosts = db.prepare(`
    SELECT
      te.skill_name,
      COUNT(DISTINCT te.id) AS invocation_count,
      COUNT(DISTINCT ar.id) AS api_request_count,
      COALESCE(SUM(ar.cost_usd), 0) AS total_cost_usd,
      COALESCE(SUM(ar.input_tokens), 0) AS total_context_tokens,
      CASE
        WHEN SUM(ar.input_tokens) > 0
        THEN ROUND(SUM(ar.input_tokens) / CAST(SUM(ar.input_tokens) AS REAL), 4)
        ELSE 0
      END AS avg_context_token_ratio
    FROM tool_events te
    LEFT JOIN api_requests ar ON (
      ar.session_id = te.session_id
      AND ar.prompt_id = te.prompt_id
    )
    WHERE te.session_id = ? AND te.tool_name = 'Skill' AND te.skill_name IS NOT NULL
    GROUP BY te.skill_name
    ORDER BY total_cost_usd DESC
  `).all(sessionId) as SkillCostBreakdown[];

  // Get Agent costs in this session
  const agentResult = db.prepare(`
    SELECT
      COUNT(DISTINCT te.id) AS invocation_count,
      COUNT(DISTINCT ar.id) AS api_request_count,
      COALESCE(SUM(ar.cost_usd), 0) AS total_cost_usd
    FROM tool_events te
    LEFT JOIN api_requests ar ON (
      ar.session_id = te.session_id
      AND ar.prompt_id = te.prompt_id
    )
    WHERE te.session_id = ? AND te.tool_name = 'Agent'
  `).get(sessionId) as SubagentCostBreakdown | undefined;

  const subagentCosts = agentResult || { invocation_count: 0, api_request_count: 0, total_cost_usd: 0 };

  // Get all API requests in this session
  const apiRequests = db.prepare(`
    SELECT
      ar.id,
      ar.ts,
      ar.session_id,
      ar.model,
      ar.input_tokens,
      ar.cache_read_tokens,
      ar.cache_creation_tokens,
      ar.output_tokens,
      ar.cost_usd,
      ar.duration_ms,
      ar.is_fast_mode
    FROM api_requests ar
    WHERE ar.session_id = ?
    ORDER BY ar.ts DESC
  `).all(sessionId) as ApiRequestDetail[];

  // Calculate total context tokens and ratio for session
  const contextResult = db.prepare(`
    SELECT
      COALESCE(SUM(ar.input_tokens), 0) AS total_context_tokens,
      SUM(ar.input_tokens) AS total_input_tokens
    FROM api_requests ar
    WHERE ar.session_id = ?
  `).get(sessionId) as { total_context_tokens: number; total_input_tokens: number } | undefined;

  const totalContextTokens = contextResult?.total_context_tokens || 0;
  const totalInputTokens = contextResult?.total_input_tokens || 1;
  const contextTokenRatio = Math.round((totalContextTokens / totalInputTokens) * 10000) / 10000;

  return {
    skill_costs: skillCosts,
    subagent_costs: subagentCosts,
    api_requests: apiRequests,
    total_context_tokens: totalContextTokens,
    context_token_ratio: contextTokenRatio,
  };
}

export function getCostByDay(db: Database.Database, days = 30): CostByDay[] {
  return db.prepare(`
    SELECT
      date(ts / 1000000, 'unixepoch') AS day,
      SUM(cost_usd)                   AS cost_usd,
      COUNT(*)                        AS api_request_count
    FROM api_requests
    WHERE ts >= (strftime('%s', 'now') - ? * 86400) * 1000000
    GROUP BY day
    ORDER BY day ASC
  `).all(days) as CostByDay[];
}

export function getCostByModel(db: Database.Database): CostByModel[] {
  return db.prepare(`
    SELECT
      model,
      SUM(cost_usd)      AS cost_usd,
      SUM(input_tokens)  AS input_tokens,
      SUM(output_tokens) AS output_tokens
    FROM api_requests
    WHERE model != '<synthetic>'
    GROUP BY model
    ORDER BY cost_usd DESC
  `).all() as CostByModel[];
}

export function getCostByMachine(db: Database.Database): CostByMachine[] {
  return db.prepare(`
    SELECT
      machine_id,
      SUM(cost_usd) AS cost_usd,
      COUNT(*)      AS session_count
    FROM sessions
    GROUP BY machine_id
    ORDER BY cost_usd DESC
  `).all() as CostByMachine[];
}

export interface ModelBreakdown {
  model: string;
  api_request_count: number;
  total_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
}

export function getModelBreakdownForSession(db: Database.Database, sessionId: string): ModelBreakdown[] {
  return db.prepare(`
    SELECT
      model,
      COUNT(*) AS api_request_count,
      COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens
    FROM api_requests
    WHERE session_id = ? AND model != '<synthetic>'
    GROUP BY model
    ORDER BY total_cost_usd DESC
  `).all(sessionId) as ModelBreakdown[];
}

export interface RateLimitSnapshot {
  id: string;
  machine_id: string;
  ts: number;
  model: string;
  requests_limit: number | null;
  requests_remaining: number | null;
  requests_reset_at: string | null;
  input_tokens_limit: number | null;
  input_tokens_remaining: number | null;
  input_tokens_reset_at: string | null;
  output_tokens_limit: number | null;
  output_tokens_remaining: number | null;
  output_tokens_reset_at: string | null;
  polling_cost_usd: number;
}

export function insertRateLimitSnapshots(db: Database.Database, snapshots: RateLimitSnapshot[]): void {
  if (snapshots.length === 0) return;

  const insert = db.transaction((snaps: RateLimitSnapshot[]) => {
    const stmt = db.prepare(`
      INSERT INTO rate_limit_snapshots (
        id, machine_id, ts, model,
        requests_limit, requests_remaining, requests_reset_at,
        input_tokens_limit, input_tokens_remaining, input_tokens_reset_at,
        output_tokens_limit, output_tokens_remaining, output_tokens_reset_at,
        polling_cost_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const snap of snaps) {
      stmt.run(
        snap.id, snap.machine_id, snap.ts, snap.model,
        snap.requests_limit, snap.requests_remaining, snap.requests_reset_at,
        snap.input_tokens_limit, snap.input_tokens_remaining, snap.input_tokens_reset_at,
        snap.output_tokens_limit, snap.output_tokens_remaining, snap.output_tokens_reset_at,
        snap.polling_cost_usd
      );
    }
  });

  insert(snapshots);
}

export function getLatestRateLimits(db: Database.Database, limit = 100): RateLimitSnapshot[] {
  return db.prepare(`
    SELECT * FROM rate_limit_snapshots
    ORDER BY ts DESC
    LIMIT ?
  `).all(limit) as RateLimitSnapshot[];
}

export function getRateLimitsByMachine(db: Database.Database, machineId: string, limit = 100): RateLimitSnapshot[] {
  return db.prepare(`
    SELECT * FROM rate_limit_snapshots
    WHERE machine_id = ?
    ORDER BY ts DESC
    LIMIT ?
  `).all(machineId, limit) as RateLimitSnapshot[];
}

export function getTotalPollingCost(db: Database.Database, daysBack = 30): number {
  const result = db.prepare(`
    SELECT COALESCE(SUM(polling_cost_usd), 0) as total
    FROM rate_limit_snapshots
    WHERE ts >= strftime('%s', 'now', '-' || ? || ' days') * 1000000
  `).get(daysBack) as { total: number } | undefined;
  return result?.total ?? 0;
}

export interface SubagentSession {
  id: string;
  model: string | null;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  api_request_count: number;
}

/**
 * Get all subagent sessions spawned by a parent session.
 */
export function getSubagentSessions(
  db: Database.Database,
  parentSessionId: string
): SubagentSession[] {
  return db.prepare(`
    SELECT
      s.id, s.model,
      COALESCE(ROUND(
        (SELECT COALESCE(SUM(cost_usd), 0) FROM api_requests WHERE session_id = ?) *
        COUNT(DISTINCT ar.id) /
        NULLIF((SELECT COUNT(*) FROM api_requests WHERE session_id = ?), 0),
        8), 0) AS cost_usd,
      COALESCE(SUM(ar.input_tokens), 0) AS input_tokens,
      COALESCE(SUM(ar.output_tokens), 0) AS output_tokens,
      COUNT(DISTINCT ar.id) AS api_request_count
    FROM sessions s
    LEFT JOIN api_requests ar ON ar.session_id = ? AND ar.agent_id = s.id
    WHERE s.parent_session_id = ?
    GROUP BY s.id
    ORDER BY cost_usd DESC
  `).all(parentSessionId, parentSessionId, parentSessionId, parentSessionId) as SubagentSession[];
}

/**
 * Get cost breakdown of subagents for a parent session.
 * Returns total cost of all subagents.
 */
export function getSubagentTotalCost(db: Database.Database, parentSessionId: string): number {
  const result = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as total
    FROM sessions
    WHERE parent_session_id = ?
  `).get(parentSessionId) as { total: number } | undefined;
  return result?.total ?? 0;
}
