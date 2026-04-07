import { Router } from 'express';
import type Database from 'better-sqlite3';
import {
  getOverview, getSessions, getSession, getToolStats, getSkillStats,
  getCostByDay, getCostByModel, getCostByMachine,
} from './queries.js';

export function createApiRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/summary', (_req, res) => {
    res.json(getOverview(db));
  });

  router.get('/sessions', (req, res) => {
    const rawLimit  = parseInt(String(req.query.limit  ?? '50'), 10);
    const rawOffset = parseInt(String(req.query.offset ?? '0'),  10);
    const limit  = Math.min(isNaN(rawLimit)  ? 50  : rawLimit,  200);
    const offset = Math.max(isNaN(rawOffset) ? 0   : rawOffset, 0);
    res.json(getSessions(db, limit, offset));
  });

  router.get('/sessions/:id', (req, res) => {
    const session = getSession(db, req.params.id);
    if (!session) { res.status(404).json({ error: 'not found' }); return; }
    res.json(session);
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
