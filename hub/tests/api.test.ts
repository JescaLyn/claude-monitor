import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import supertest from 'supertest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import { parseLogsPayload } from '../src/parser/logs.js';
import { ingestLogPayload } from '../src/ingest.js';
import { createApiRouter } from '../src/api/router.js';
import type { OtelLogsPayload } from '../src/types.js';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const LOG_SAMPLE = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'logs/payload_020218_841952_v1_logs.json'), 'utf8')
) as OtelLogsPayload;

let db: Database.Database;
let app: ReturnType<typeof express>;

beforeAll(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  ingestLogPayload(db, parseLogsPayload(LOG_SAMPLE, 'test-machine'));
  app = express();
  app.use('/api', createApiRouter(db));
});

afterAll(() => db.close());

describe('GET /api/summary', () => {
  it('returns overview stats', async () => {
    const res = await supertest(app).get('/api/summary');
    expect(res.status).toBe(200);
    expect(res.body.total_sessions).toBe(1);
    expect(res.body.total_api_requests).toBe(1);
    expect(res.body.total_cost_usd).toBeCloseTo(0.01267155);
  });
});

describe('GET /api/sessions', () => {
  it('returns a list of sessions', async () => {
    const res = await supertest(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('bf9aefc7-1d4c-4385-b5df-bd161e0c1ded');
  });
});

describe('GET /api/sessions/:id', () => {
  it('returns the session by id', async () => {
    const res = await supertest(app).get('/api/sessions/bf9aefc7-1d4c-4385-b5df-bd161e0c1ded');
    expect(res.status).toBe(200);
    expect(res.body.cost_usd).toBeCloseTo(0.01267155);
    expect(res.body.api_request_count).toBe(1);
    expect(res.body.tool_call_count).toBe(1);
  });

  it('returns 404 for unknown session', async () => {
    const res = await supertest(app).get('/api/sessions/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/tools', () => {
  it('returns tool stats', async () => {
    const res = await supertest(app).get('/api/tools');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].tool_name).toBe('Bash');
    expect(res.body[0].call_count).toBe(1);
    expect(res.body[0].success_count).toBe(1);
  });
});

describe('GET /api/skills', () => {
  it('returns empty array when no skills invoked', async () => {
    const res = await supertest(app).get('/api/skills');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

describe('GET /api/cost/by-model', () => {
  it('returns cost grouped by model', async () => {
    const res = await supertest(app).get('/api/cost/by-model');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].model).toBe('claude-sonnet-4-6');
    expect(res.body[0].cost_usd).toBeCloseTo(0.01267155);
  });
});

describe('GET /api/cost/by-machine', () => {
  it('returns cost grouped by machine', async () => {
    const res = await supertest(app).get('/api/cost/by-machine');
    expect(res.status).toBe(200);
    expect(res.body[0].machine_id).toBe('test-machine');
  });
});

describe('GET /api/cost/by-day', () => {
  it('returns cost grouped by day', async () => {
    const res = await supertest(app).get('/api/cost/by-day');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // The sample data has 1 api_request, so we expect 1 day entry
    expect(res.body).toHaveLength(1);
    expect(res.body[0].cost_usd).toBeCloseTo(0.01267155);
    expect(res.body[0].api_request_count).toBe(1);
  });
});
