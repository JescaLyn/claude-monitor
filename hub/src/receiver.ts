import express, { Request, Response } from 'express';
import type Database from 'better-sqlite3';
import type { OtelLogsPayload, OtelMetricsPayload } from './types.js';
import { parseLogsPayload } from './parser/logs.js';
import { parseMetricsPayload } from './parser/metrics.js';
import { ingestLogPayload, ingestMetricSnapshots } from './ingest.js';

async function readBody(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function createReceiver(db: Database.Database): express.Express {
  const app = express();

  // Disable body parsing — we read the raw stream ourselves to handle chunked encoding
  app.use((req, _res, next) => {
    req.resume(); // prevent stream from blocking if nothing reads it
    next();
  });

  app.post('/v1/logs', async (req: Request, res: Response) => {
    try {
      const body = await readBody(req);
      if (!body.length) { res.status(200).json({}); return; }
      const payload = JSON.parse(body.toString('utf8')) as OtelLogsPayload;
      const machineId = (req.headers['x-machine-id'] as string) ?? 'local';
      const parsed = parseLogsPayload(payload, machineId);
      ingestLogPayload(db, parsed);
      res.status(200).json({});
    } catch (err) {
      console.error('[receiver] /v1/logs error:', err);
      res.status(500).json({ error: 'internal error' });
    }
  });

  app.post('/v1/metrics', async (req: Request, res: Response) => {
    try {
      const body = await readBody(req);
      if (!body.length) { res.status(200).json({}); return; }
      const payload = JSON.parse(body.toString('utf8')) as OtelMetricsPayload;
      const machineId = (req.headers['x-machine-id'] as string) ?? 'local';
      const snapshots = parseMetricsPayload(payload, machineId);
      ingestMetricSnapshots(db, snapshots);
      res.status(200).json({});
    } catch (err) {
      console.error('[receiver] /v1/metrics error:', err);
      res.status(500).json({ error: 'internal error' });
    }
  });

  return app;
}
