import { describe, it, expect, beforeAll } from 'vitest';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import supertest from 'supertest';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const DASHBOARD_DIR = join(REPO_ROOT, 'dashboard');

let app: ReturnType<typeof express>;

beforeAll(() => {
  app = express();
  app.use(express.static(DASHBOARD_DIR));
});

describe('static dashboard files', () => {
  it('GET / returns index.html as text/html', async () => {
    const res = await supertest(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Claude Monitor');
  });

  it('GET /style.css returns text/css', async () => {
    const res = await supertest(app).get('/style.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/css/);
  });
});
