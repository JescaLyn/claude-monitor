import { mkdirSync } from 'fs';
import express from 'express';
import { openDb } from './db.js';
import { createReceiver } from './receiver.js';
import { createApiRouter } from './api/router.js';

const OTLP_PORT = parseInt(process.env.OTLP_PORT ?? '4318', 10);
const API_PORT  = parseInt(process.env.API_PORT  ?? '3001', 10);
const DB_PATH   = process.env.DB_PATH ?? './data/monitor.db';

mkdirSync('./data', { recursive: true });
const db = openDb(DB_PATH);

// OTLP receiver — accepts Claude Code telemetry (direct or forwarded from satellite)
const receiver = createReceiver(db);
receiver.listen(OTLP_PORT, () => {
  console.log(`[hub] OTLP receiver listening on :${OTLP_PORT}`);
});

// REST API — read-only, consumed by dashboard and TUI
const apiApp = express();
apiApp.use(express.json());
apiApp.use('/api', createApiRouter(db));
apiApp.listen(API_PORT, () => {
  console.log(`[hub] REST API listening on :${API_PORT}`);
});

process.on('SIGTERM', () => {
  console.log('[hub] SIGTERM received, shutting down');
  db.close();
  process.exit(0);
});
