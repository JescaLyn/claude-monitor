import { Router } from 'express';
import express from 'express';
import type Database from 'better-sqlite3';
import {
  getOverview, getSessions, getSession, getToolStats, getSkillStats,
  getCostByDay, getCostByModel, getCostByMachine, setSessionName,
} from './queries.js';

const VALID_SORT_FIELDS = new Set(['started_at', 'cost_usd', 'machine_id', 'tool_call_count', 'api_request_count']);
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
    const sort  = String(req.query.sort  ?? 'started_at');
    const order = String(req.query.order ?? 'desc');
    if (!VALID_SORT_FIELDS.has(sort))  { res.status(400).json({ error: 'Invalid sort field' }); return; }
    if (!VALID_ORDERS.has(order))      { res.status(400).json({ error: 'Invalid order' }); return; }
    res.json(getSessions(db, limit, offset, sort, order));
  });

  router.get('/sessions/:id', (req, res) => {
    const session = getSession(db, req.params.id);
    if (!session) { res.status(404).json({ error: 'not found' }); return; }
    res.json(session);
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

  return router;
}
