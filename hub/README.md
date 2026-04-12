# Claude Monitor Hub

The hub is the always-on backend that receives telemetry from all client machines, stores it in SQLite, and serves a web dashboard for analysis.

## Quick Start (Development)

```bash
cd hub
npm install
npm run dev   # Starts on :4318 (OTLP) and :3001 (API)
```

Then send test data:

```bash
curl -X POST http://localhost:4318/v1/logs \
  -H 'content-type: application/json' \
  -H 'x-machine-id: test-machine' \
  -d @path/to/payload.json
```

View dashboard: `http://localhost:3001/`

## Production Deployment

See [DEPLOYMENT.md](../DEPLOYMENT.md) for multi-machine setup via ZeroTier.

## Architecture

### OTLP Receiver (port :4318)

- Accepts `POST /v1/logs` and `POST /v1/metrics` with OpenTelemetry-formatted JSON.
- Extracts machine identity from:
  1. **OTEL resource attribute `host.name`** (standard; set by client via `OTEL_RESOURCE_ATTRIBUTES=host.name=foo`)
  2. **HTTP header `x-machine-id`** (custom; for satellite proxies)
  3. Falls back to literal string `'local'`
- Parses and ingests into SQLite.

### REST API (port :3001)

**Read-only** endpoints for the dashboard:
- `GET /api/summary` — aggregated cost, tokens, session count
- `GET /api/sessions` — list of sessions with filters
- `GET /api/cost/by-day` — cost trends by date
- `GET /api/cost/by-model` — breakdown by model
- `GET /api/cost/by-machine` — breakdown by machine_id

See `hub/src/api/router.ts` for full endpoint list.

### Dashboard (served from :3001)

Single-page app (vanilla JS, Chart.js) with tabs:
- **Overview** — aggregated metrics, daily cost trend
- **Sessions** — session list, drill-down by machine/model/date
- **Cost Analysis** — multi-dimensional filtering
- **Skills** — skill invocation costs
- **Tools** — tool usage breakdown

### Database (SQLite WAL mode)

Tables:
- **machines** — hostname, first_seen, last_seen
- **sessions** — session metadata, aggregated cost/tokens
- **api_requests** — per-request cost, tokens, model, duration
- **tool_events** — tool invocations, skill names, success/failure
- **metric_snapshots** — time-series metric data (OTEL metrics)
- **parse_state** — JSONL file ingestion state (offset, mtime) for resumable parsing

See `hub/src/schema.ts` for full schema.

## Key Files

- `src/index.ts` — Entry point; binds OTLP receiver and API to ports
- `src/receiver.ts` — OTLP HTTP endpoint handlers; `resolveMachineId` extracts machine from payload or header
- `src/ingest.ts` — Parses and inserts telemetry into database
- `src/parser/` — Logs and metrics parsers
- `src/api/router.ts` — REST API routes
- `hub.service` — Systemd service file (customize paths and user for your environment)

## Tests

```bash
npm test                           # Run all tests
npm test -- receiver.test.ts       # Run receiver tests only
npx tsc --noEmit                   # Type-check
```

Tests cover:
- Machine ID resolution from OTEL attributes and headers
- Log/metrics parsing
- Data ingestion
- API routes

## Environment Variables

- `DB_PATH` — SQLite database file path (default: `./data/monitor.db`)
- `OTLP_PORT` — OTLP receiver port (default: `4318`)
- `API_PORT` — REST API + dashboard port (default: `3001`)
- `NODE_ENV` — Set to `production` in systemd service

## Monitoring

Hub health can be checked via:

```bash
# Is the service running?
systemctl status claude-monitor

# Recent logs
journalctl -u claude-monitor -n 50

# Database size
sqlite3 /var/lib/claude-monitor/data/monitor.db \
  "SELECT page_count * page_size / 1024.0 / 1024.0 as mb FROM pragma_page_count(), pragma_page_size();"
```

## Development Notes

- **WAL mode**: Database uses Write-Ahead Logging for better concurrency under high OTLP write load.
- **Synchronous NORMAL**: Balanced durability/performance; good enough for home use, not ACID-strict.
- **Migrations**: All schema changes are declarative in `src/schema.ts`; migrations run on startup.
- **No external dependencies**: The receiver is pure Node.js (Express, better-sqlite3).

## Future Enhancements

- Satellite proxy pattern (forward and aggregate from multiple hubs)
- Token-based auth on OTLP endpoint
- Retention policies (auto-cleanup of old data)
- Export (CSV, JSON) from the dashboard
