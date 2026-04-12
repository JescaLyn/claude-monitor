import { Router } from 'express';
import express from 'express';
import type Database from 'better-sqlite3';
import {
  getOverview, getSessions, getSession, getToolStats, getSkillStats,
  getCostByDay, getCostByModel, getCostByMachine, setSessionName,
  getSkillCostsWithRequests, getSubagentCostsWithRequests,
  getApiRequests, getSessionBreakdown, getModelBreakdownForSession,
} from './queries.js';
import { resolveSessionName } from '../session-names.js';
import type { SessionRow } from './queries.js';

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
    const breakdown = getSessionBreakdown(db, req.params.id);
    if (!breakdown.api_requests || breakdown.api_requests.length === 0) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    res.json(breakdown);
  });

  router.get('/sessions/:id/models', (req, res) => {
    const models = getModelBreakdownForSession(db, req.params.id);
    res.json(models);
  });

  return router;
}
