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
  readFileSync(resolve(REPO_ROOT, 'hub/tests/fixtures/payload_logs.json'), 'utf8')
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

afterAll(() => {
  db.close();
});

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

  it('returns a name field on each session row (may be null)', async () => {
    const res = await supertest(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('name');
    }
  });
});

describe('GET /api/sessions sort params', () => {
  it('accepts valid sort field', async () => {
    const res = await supertest(app).get('/api/sessions?sort=cost_usd&order=asc');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 400 for invalid sort field', async () => {
    const res = await supertest(app).get('/api/sessions?sort=invalid_field');
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid order', async () => {
    const res = await supertest(app).get('/api/sessions?order=sideways');
    expect(res.status).toBe(400);
  });

  it.each(['started_at', 'cost_usd', 'machine_id', 'tool_call_count', 'api_request_count'])(
    'accepts sort=%s', async (field) => {
      const res = await supertest(app).get(`/api/sessions?sort=${field}`);
      expect(res.status).toBe(200);
    }
  );
});

describe('PUT /api/sessions/:id', () => {
  const KNOWN_SESSION_ID = 'bf9aefc7-1d4c-4385-b5df-bd161e0c1ded';

  it('returns 400 if name is not a string', async () => {
    const res = await supertest(app)
      .put('/api/sessions/any-id')
      .send({ name: 123 });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown session id', async () => {
    const res = await supertest(app)
      .put('/api/sessions/unknown-session-id-xyz')
      .send({ name: 'My Session' });
    expect(res.status).toBe(404);
  });

  it('sets session name and returns ok', async () => {
    const res = await supertest(app)
      .put(`/api/sessions/${KNOWN_SESSION_ID}`)
      .send({ name: 'test-name' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const getRes = await supertest(app).get('/api/sessions');
    const session = getRes.body.find((s: { id: string }) => s.id === KNOWN_SESSION_ID);
    expect(session?.name).toBe('test-name');
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
    const res = await supertest(app).get('/api/cost/by-day?days=365');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // The sample data has 1 api_request, so we expect 1 day entry
    expect(res.body).toHaveLength(1);
    expect(res.body[0].cost_usd).toBeCloseTo(0.01267155);
    expect(res.body[0].api_request_count).toBe(1);
  });
});

describe('GET /api/skills/costs', () => {
  it('returns skill costs with request counts', async () => {
    const res = await supertest(app).get('/api/skills/costs');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Sample data has no skills, so should be empty
    expect(res.body).toHaveLength(0);
  });
});

describe('GET /api/subagents/costs', () => {
  it('returns subagent costs', async () => {
    const res = await supertest(app).get('/api/subagents/costs');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('invocation_count');
    expect(res.body).toHaveProperty('api_request_count');
    expect(res.body).toHaveProperty('total_cost_usd');
  });
});

describe('GET /api/requests', () => {
  it('returns API requests', async () => {
    const res = await supertest(app).get('/api/requests');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toHaveProperty('model');
    expect(res.body[0]).toHaveProperty('cost_usd');
  });

  it('filters requests by model', async () => {
    const res = await supertest(app).get('/api/requests?model=claude-sonnet-4-6');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].model).toBe('claude-sonnet-4-6');
  });

  it('filters requests by non-existent model', async () => {
    const res = await supertest(app).get('/api/requests?model=claude-nonexistent');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('respects limit and offset', async () => {
    const res = await supertest(app).get('/api/requests?limit=1&offset=0');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(1);
  });
});

describe('GET /api/sessions/:id/breakdown', () => {
  it('returns session breakdown with skills and requests', async () => {
    const res = await supertest(app).get('/api/sessions/bf9aefc7-1d4c-4385-b5df-bd161e0c1ded/breakdown');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('skill_costs');
    expect(res.body).toHaveProperty('api_requests');
    expect(Array.isArray(res.body.skill_costs)).toBe(true);
    expect(Array.isArray(res.body.api_requests)).toBe(true);
    expect(res.body.api_requests).toHaveLength(1);
  });

  it('returns 404 for unknown session', async () => {
    const res = await supertest(app).get('/api/sessions/nonexistent-session/breakdown');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

describe('GET /api/sessions/with-subagents', () => {
  it('returns parent sessions with subagent array', async () => {
    const res = await supertest(app).get('/api/sessions/with-subagents?limit=20&offset=0&sort=cost_usd&order=desc');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('bf9aefc7-1d4c-4385-b5df-bd161e0c1ded');
    expect(res.body[0]).toHaveProperty('cost_usd');
    expect(Array.isArray(res.body[0].subagents)).toBe(true);
  });

  it('accepts valid sort field', async () => {
    const res = await supertest(app).get('/api/sessions/with-subagents?sort=cost_usd&order=asc');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 400 for invalid sort field', async () => {
    const res = await supertest(app).get('/api/sessions/with-subagents?sort=invalid_field');
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid order', async () => {
    const res = await supertest(app).get('/api/sessions/with-subagents?order=sideways');
    expect(res.status).toBe(400);
  });
});
