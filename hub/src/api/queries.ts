import type Database from 'better-sqlite3';

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

const VALID_SORT_FIELDS = new Set(['started_at', 'cost_usd', 'machine_id', 'tool_call_count', 'api_request_count']);
const VALID_ORDERS = new Set(['asc', 'desc']);

// Qualify table-column sorts with alias to avoid ambiguity in the JOIN query.
// Aggregate alias columns (tool_call_count, api_request_count) are referenced by alias.
const SORT_EXPR: Record<string, string> = {
  started_at:        's.started_at',
  cost_usd:          's.cost_usd',
  machine_id:        's.machine_id',
  tool_call_count:   'tool_call_count',
  api_request_count: 'api_request_count',
};

export function getSessions(
  db: Database.Database,
  limit = 50,
  offset = 0,
  sort = 'started_at',
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
      COUNT(DISTINCT te.id) AS tool_call_count
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
      COUNT(DISTINCT te.id) AS tool_call_count
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
