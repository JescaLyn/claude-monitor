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
    const limit  = Math.min(parseInt(String(req.query.limit  ?? '50'), 10), 200);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'),  10), 0);
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
    const days = Math.min(parseInt(String(req.query.days ?? '30'), 10), 365);
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
