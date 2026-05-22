import { Router } from 'express';
import express from 'express';
import type Database from 'better-sqlite3';
import {
  getOverview, getSessions, getSession, getToolStats, getSkillStats,
  getCostByDay, getCostByModel, getCostByMachine, setSessionName,
  getSkillCostsWithRequests, getSubagentCostsWithRequests,
  getApiRequests, getSessionBreakdown, getModelBreakdownForSession,
  insertRateLimitSnapshots, getLatestRateLimits, getRateLimitsByMachine, getTotalPollingCost,
  getSubagentSessions, getSkillInvocations, getSessionsWithSubagents, getCostRangeSummary,
} from './queries.js';
import { resolveSessionName } from '../session-names.js';
import type { SessionRow, RateLimitSnapshot } from './queries.js';

// Enrich a session with dynamically-resolved name
function enrichSessionWithName(session: SessionRow): SessionRow {
  if (!session.name) {
    // Only resolve if not already set (allows user overrides via PUT to persist)
    const resolvedName = resolveSessionName(session.id);
    // Use resolved name if found, otherwise fall back to session ID
    if (resolvedName) {
      return { ...session, name: resolvedName };
    } else {
      return { ...session, name: session.id };
    }
  }
  return session;
}

const VALID_SORT_FIELDS = new Set(['started_at', 'last_event_ts', 'cost_usd', 'machine_id', 'tool_call_count', 'api_request_count']);
const VALID_ORDERS = new Set(['asc', 'desc']);

export function createApiRouter(db: Database.Database): Router {
  const router = Router();
  router.use(express.json());

  router.get('/summary', (_req, res) => {
    res.json(getOverview(db));
  });

  router.get('/sessions', (req, res) => {
    const rawLimit  = parseInt(String(req.query.limit  ?? '50'), 10);
    const rawOffset = parseInt(String(req.query.offset ?? '0'),  10);
    const limit  = Math.min(isNaN(rawLimit)  ? 50  : rawLimit,  200);
    const offset = Math.max(isNaN(rawOffset) ? 0   : rawOffset, 0);
    const sort  = String(req.query.sort  ?? 'last_event_ts');
    const order = String(req.query.order ?? 'desc');
    if (!VALID_SORT_FIELDS.has(sort))  { res.status(400).json({ error: 'Invalid sort field' }); return; }
    if (!VALID_ORDERS.has(order))      { res.status(400).json({ error: 'Invalid order' }); return; }
    const sessions = getSessions(db, limit, offset, sort, order);
    res.json(sessions.map(enrichSessionWithName));
  });

  router.get('/sessions/with-subagents', (req, res) => {
    const rawLimit  = parseInt(String(req.query.limit  ?? '50'), 10);
    const rawOffset = parseInt(String(req.query.offset ?? '0'),  10);
    const limit  = Math.min(isNaN(rawLimit)  ? 50  : rawLimit,  200);
    const offset = Math.max(isNaN(rawOffset) ? 0   : rawOffset, 0);
    const sort  = String(req.query.sort  ?? 'last_event_ts');
    const order = String(req.query.order ?? 'desc');
    const since = parseInt(String(req.query.since ?? '0'), 10);
    if (!VALID_SORT_FIELDS.has(sort))  { res.status(400).json({ error: 'Invalid sort field' }); return; }
    if (!VALID_ORDERS.has(order))      { res.status(400).json({ error: 'Invalid order' }); return; }
    try {
      const sessions = getSessionsWithSubagents(db, limit, offset, sort, order, isNaN(since) ? 0 : since);
      res.json(sessions.map(enrichSessionWithName));
    } catch (err) {
      const error = err as any;
      console.error('[api] Error fetching sessions with subagents:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch sessions' });
    }
  });

  router.get('/sessions/:id', (req, res) => {
    const session = getSession(db, req.params.id);
    if (!session) { res.status(404).json({ error: 'not found' }); return; }
    res.json(enrichSessionWithName(session));
  });

  router.put('/sessions/:id', (req, res) => {
    const { name } = req.body;
    if (typeof name !== 'string') {
      res.status(400).json({ error: 'name must be a string' });
      return;
    }
    const ok = setSessionName(db, req.params.id, name.trim().slice(0, 200));
    if (!ok) { res.status(404).json({ error: 'not found' }); return; }
    res.json({ ok: true });
  });

  router.get('/tools', (_req, res) => {
    res.json(getToolStats(db));
  });

  router.get('/skills', (_req, res) => {
    res.json(getSkillStats(db));
  });

  router.get('/cost/by-day', (req, res) => {
    const rawDays = parseInt(String(req.query.days ?? '30'), 10);
    const days = Math.min(isNaN(rawDays) ? 30 : rawDays, 365);
    res.json(getCostByDay(db, days));
  });

  router.get('/cost/range-summary', (req, res) => {
    const rawDays = parseInt(String(req.query.days ?? '30'), 10);
    const days = Math.min(isNaN(rawDays) ? 30 : rawDays, 365);
    res.json(getCostRangeSummary(db, days));
  });

  router.get('/cost/by-model', (_req, res) => {
    res.json(getCostByModel(db));
  });

  router.get('/cost/by-machine', (_req, res) => {
    res.json(getCostByMachine(db));
  });

  router.get('/skills/costs', (_req, res) => {
    const costs = getSkillCostsWithRequests(db);
    res.json(costs);
  });

  router.get('/subagents/costs', (_req, res) => {
    const costs = getSubagentCostsWithRequests(db);
    res.json(costs);
  });

  router.get('/requests', (req, res) => {
    const filters = {
      model: req.query.model ? String(req.query.model) : undefined,
      sessionId: req.query.sessionId ? String(req.query.sessionId) : undefined,
      minCost: req.query.minCost ? parseFloat(String(req.query.minCost)) : 0,
      maxCost: req.query.maxCost ? parseFloat(String(req.query.maxCost)) : Infinity,
      minDate: req.query.minDate ? parseInt(String(req.query.minDate), 10) : 0,
      maxDate: req.query.maxDate ? parseInt(String(req.query.maxDate), 10) : Infinity,
      isFastMode: req.query.isFastMode ? parseInt(String(req.query.isFastMode), 10) : undefined,
      limit: req.query.limit ? parseInt(String(req.query.limit), 10) : 100,
      offset: req.query.offset ? parseInt(String(req.query.offset), 10) : 0,
    };
    const requests = getApiRequests(db, filters);
    res.json(requests);
  });

  router.get('/sessions/:id/breakdown', (req, res) => {
    const sessionId = req.params.id;
    const session = getSession(db, sessionId);

    // If this is a subagent session, query the parent with agent_id filtering
    if (session?.parent_session_id) {
      const parentId = session.parent_session_id;

      // For subagents, we skip skill breakdown (tool_events.prompt_id doesn't match api_requests.prompt_id)
      // Just return API requests and basic counts
      const apiRequestCount = db.prepare(`
        SELECT COUNT(*) as count FROM api_requests ar
        WHERE ar.session_id = ? AND ar.agent_id = ?
      `).get(parentId, sessionId) as any;

      const agentResult = db.prepare(`
        SELECT
          COUNT(*) AS api_request_count,
          COALESCE(SUM(ar.cost_usd), 0) AS total_cost_usd
        FROM api_requests ar
        WHERE ar.session_id = ? AND ar.agent_id = ?
      `).get(parentId, sessionId) as any;

      const apiRequests = db.prepare(`
        SELECT ar.id, ar.ts, ar.session_id, ar.model, ar.input_tokens,
               ar.cache_read_tokens, ar.cache_creation_tokens, ar.output_tokens, ar.cost_usd, ar.duration_ms, ar.is_fast_mode
        FROM api_requests ar
        WHERE ar.session_id = ? AND ar.agent_id = ?
        ORDER BY ar.ts DESC
      `).all(parentId, sessionId) as any[];

      if (apiRequests.length === 0) {
        res.status(404).json({ error: 'session not found' });
        return;
      }

      const totalContextTokens = apiRequests.reduce((sum, r) => sum + (r.input_tokens || 0), 0);
      const totalCost = apiRequests.reduce((sum, r) => sum + (r.cost_usd || 0), 0);
      res.json({
        skill_costs: [],  // Skill breakdown not available for subagents (prompt_id mismatch)
        subagent_costs: {
          invocation_count: 0,
          api_request_count: apiRequestCount?.count || 0,
          total_cost_usd: agentResult?.total_cost_usd || 0
        },
        api_requests: apiRequests,
        total_context_tokens: totalContextTokens,
        context_token_ratio: totalContextTokens > 0 ? totalContextTokens / (apiRequestCount?.count || 1) : 0,
      });
      return;
    }

    const breakdown = getSessionBreakdown(db, sessionId);
    if (!breakdown.api_requests || breakdown.api_requests.length === 0) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    res.json(breakdown);
  });

  router.get('/sessions/:id/models', (req, res) => {
    const sessionId = req.params.id;
    const session = getSession(db, sessionId);

    // If this is a subagent session, query the parent with agent_id filtering
    if (session?.parent_session_id) {
      const models = db.prepare(`
        SELECT
          model,
          COUNT(*) AS api_request_count,
          COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
          COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens
        FROM api_requests
        WHERE session_id = ? AND agent_id = ? AND model != '<synthetic>'
        GROUP BY model
        ORDER BY total_cost_usd DESC
      `).all(session.parent_session_id, sessionId) as any;
      res.json(models);
      return;
    }

    const models = getModelBreakdownForSession(db, sessionId);
    res.json(models);
  });

  // Rate limit polling endpoints
  router.post('/rate-limits', (req, res) => {
    const snapshots = req.body;
    if (!Array.isArray(snapshots)) {
      res.status(400).json({ error: 'Expected array of rate limit snapshots' });
      return;
    }
    if (snapshots.length === 0) {
      res.status(400).json({ error: 'Expected at least one snapshot' });
      return;
    }
    if (snapshots.length > 1000) {
      res.status(400).json({ error: 'Too many snapshots (max 1000)' });
      return;
    }
    // Validate required fields on first snapshot as a spot check
    const first = snapshots[0] as any;
    if (!first.id || !first.machine_id || typeof first.ts !== 'number' || !first.model) {
      res.status(400).json({ error: 'Missing required fields: id, machine_id, ts, model' });
      return;
    }
    try {
      insertRateLimitSnapshots(db, snapshots as RateLimitSnapshot[]);
      res.json({ ok: true, count: snapshots.length });
    } catch (err) {
      console.error('[api] Error inserting rate limit snapshots:', err);
      res.status(500).json({ error: 'Failed to insert snapshots' });
    }
  });

  router.get('/rate-limits', (req, res) => {
    const rawLimit = parseInt(String(req.query.limit ?? '100'), 10);
    const limit = Math.min(isNaN(rawLimit) ? 100 : rawLimit, 500);
    const snapshots = getLatestRateLimits(db, limit);
    res.json(snapshots);
  });

  router.get('/rate-limits/machine/:machineId', (req, res) => {
    const rawLimit = parseInt(String(req.query.limit ?? '100'), 10);
    const limit = Math.min(isNaN(rawLimit) ? 100 : rawLimit, 500);
    const snapshots = getRateLimitsByMachine(db, req.params.machineId, limit);
    res.json(snapshots);
  });

  router.get('/rate-limits/polling-cost', (req, res) => {
    const rawDays = parseInt(String(req.query.days ?? '30'), 10);
    const days = Math.min(isNaN(rawDays) ? 30 : rawDays, 365);
    const totalCost = getTotalPollingCost(db, days);
    res.json({ total_polling_cost_usd: totalCost, days });
  });

  // Subagent session endpoints
  router.get('/sessions/:id/subagents', (req, res) => {
    const subagents = getSubagentSessions(db, req.params.id);
    res.json(subagents);
  });

  // Skill invocations endpoint
  router.get('/sessions/:sessionId/skills/:skillName/invocations', (req, res) => {
    const { sessionId, skillName } = req.params;
    const invocations = getSkillInvocations(db, decodeURIComponent(skillName), sessionId);
    res.json(invocations);
  });

  router.get('/sessions/:id/tools', (req, res) => {
    const sessionId = req.params.id;
    const tools = db.prepare(`
      SELECT
        te.tool_name,
        COUNT(*) as invocation_count,
        COUNT(DISTINCT ar.id) as api_request_count,
        COALESCE(SUM(ar.cost_usd), 0) as total_cost_usd,
        ROUND(AVG(te.duration_ms)) as avg_duration_ms,
        SUM(CASE WHEN te.success = 1 THEN 1 ELSE 0 END) as success_count,
        COUNT(*) as total_count
      FROM tool_events te
      LEFT JOIN api_requests ar ON (
        ar.session_id = te.session_id
        AND ar.prompt_id = te.prompt_id
      )
      WHERE te.session_id = ?
      GROUP BY te.tool_name
      ORDER BY total_cost_usd DESC
    `).all(sessionId) as any[];
    res.json(tools);
  });

  return router;
}
