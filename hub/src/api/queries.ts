import type Database from 'better-sqlite3';
import type {
  SkillCostBreakdown,
  SubagentCostBreakdown,
  ApiRequestDetail,
  SessionToolBreakdown,
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
      COALESCE(SUM(cost_usd), 0)             AS total_cost_usd,
      COUNT(*)                                AS total_sessions,
      COALESCE(SUM(input_tokens), 0)          AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0)         AS total_output_tokens,
      COALESCE(SUM(cache_read_tokens), 0)     AS total_cache_read_tokens,
      COALESCE(SUM(cache_creation_tokens), 0) AS total_cache_creation_tokens,
      (SELECT COUNT(*) FROM api_requests)     AS total_api_requests
    FROM sessions
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
  return db.prepare(`
    SELECT
      s.id, s.machine_id, s.name, s.model, s.started_at, s.ended_at,
      s.cost_usd, s.input_tokens, s.output_tokens,
      s.cache_read_tokens, s.cache_creation_tokens,
      COUNT(DISTINCT ar.id) AS api_request_count,
      COUNT(DISTINCT te.id) AS tool_call_count,
      MAX(COALESCE(ar.ts, te.ts)) AS last_event_ts
    FROM sessions s
    LEFT JOIN api_requests ar ON ar.session_id = s.id
    LEFT JOIN tool_events   te ON te.session_id = s.id
    GROUP BY s.id
    ORDER BY ${sortExpr} ${order}
    LIMIT ? OFFSET ?
  `).all(limit, offset) as SessionRow[];
}

export function getSession(db: Database.Database, id: string): SessionRow | null {
  return db.prepare(`
    SELECT
      s.id, s.machine_id, s.name, s.model, s.started_at, s.ended_at,
      s.cost_usd, s.input_tokens, s.output_tokens,
      s.cache_read_tokens, s.cache_creation_tokens,
      COUNT(DISTINCT ar.id) AS api_request_count,
      COUNT(DISTINCT te.id) AS tool_call_count,
      MAX(COALESCE(ar.ts, te.ts)) AS last_event_ts
    FROM sessions s
    LEFT JOIN api_requests ar ON ar.session_id = s.id
    LEFT JOIN tool_events   te ON te.session_id = s.id
    WHERE s.id = ?
    GROUP BY s.id
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

function estimateContextTokens(inputTokens: number, promptLength?: number): number {
  if (!promptLength || promptLength <= 0) {
    // No prompt data; conservative estimate: all input is context
    return inputTokens;
  }
  // Estimate prompt tokens: ~1 token per 4 characters
  const estimatedPromptTokens = Math.ceil(promptLength / 4);
  return Math.max(0, inputTokens - estimatedPromptTokens);
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
    WHERE session_id = ?
    GROUP BY model
    ORDER BY total_cost_usd DESC
  `).all(sessionId) as ModelBreakdown[];
}
