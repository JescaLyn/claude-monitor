# Claude Monitor

A self-hosted system that collects Claude Code usage telemetry across multiple machines, stores it in SQLite, and visualizes usage patterns through a web dashboard. Understand where your Claude API spend is going — by session, skill, tool, machine, and model.

## Architecture

**Hub** (always-on Linux desktop): Receives OTLP telemetry on port :4318, stores in SQLite, serves dashboard on :3001.

**Clients** (Zima, Mac, Windows): Run Claude Code with env vars pointing telemetry to the hub via ZeroTier.

```
ZeroTier Private Network
├─ Linux hub (10.147.17.1) — OTLP receiver + REST API + Dashboard + SQLite
├─ Zima (10.147.17.2) — Claude Code client
├─ Mac (10.147.17.3) — Claude Code client
└─ Windows (10.147.17.4) — Claude Code client
```

## Quick Start (Development)

```bash
cd hub
npm install
npm run dev   # OTLP :4318, API :3001
```

Test the OTLP endpoint:
```bash
curl -X POST http://localhost:4318/v1/logs \
  -H 'content-type: application/json' \
  -d '{"resourceLogs": []}'  # Should return 200
```

View dashboard: `http://localhost:3001/`

## Production Deployment

👉 **See [DEPLOYMENT.md](./DEPLOYMENT.md)** for the full multi-machine setup guide with ZeroTier configuration, firewall rules, and client setup for all four machines.

**TL;DR:**
1. Fresh Ubuntu 24.04 on Linux desktop.
2. Install ZeroTier, join your network.
3. Clone repo, `npm ci && npm run build` in hub/.
4. Install `hub/hub.service` as systemd service.
5. On each client (Zima/Mac/Win): set `OTEL_RESOURCE_ATTRIBUTES=host.name=<id>` in `~/.claude/settings.json`, pointing to hub's ZeroTier IP.

## Features

### Dashboard

Tabs for:
- **Overview** — Real-time aggregated cost, tokens, session count; daily cost trends
- **Sessions** — Per-session breakdown; filter by machine, model, date, fast-mode
- **Cost Analysis** — Multi-dimensional breakdown by machine, model, skill, tool
- **Skills** — Which skills cost the most; invocation counts vs. API request counts
- **Tools** — Tool usage by session; success/failure rates

### Data Collection

- **OTLP receiver** on :4318 — Accepts logs and metrics from Claude Code clients
- **JSONL watcher** — Local file ingestion from `~/.claude/projects/` (local to hub)
- **Machine identity** — Extracted from OTEL resource attribute `host.name` (standard OTEL mechanism; no satellite proxy needed)

### Database

SQLite with WAL mode for concurrency:
- **machines** — Distinct clients (zima, my-mac, my-win)
- **sessions** — Session metadata, aggregated cost/tokens
- **api_requests** — Per-request granularity (cost, tokens, model, duration, fast-mode flag)
- **tool_events** — Tool invocations with skill names, success/failure
- **metric_snapshots** — Time-series metrics from OTEL

Migrations are declarative in `src/schema.ts`; applied on startup.

## Hub Architecture

### Components

- **src/receiver.ts** — OTLP HTTP endpoint; `resolveMachineId()` extracts machine from OTEL `host.name` or `x-machine-id` header
- **src/parser/** — Parses OTEL logs and metrics into normalized form
- **src/ingest.ts** — Writes normalized data to SQLite
- **src/api/router.ts** — Read-only REST API consumed by the dashboard
- **src/jsonl/** — JSONL file watcher for local Claude Code telemetry journals
- **hub/hub.service** — Systemd service definition

### Key Design Decisions

- **No auth by default** — Assumes trusted ZeroTier network; firewalled via ufw rules
- **Standard OTEL** — Clients self-identify via `OTEL_RESOURCE_ATTRIBUTES=host.name=...`, not a custom header
- **WAL + NORMAL sync** — Balanced durability/performance; good for home use
- **No external APIs** — Pure Node.js + Express + better-sqlite3; nothing external

## Client Setup (Condensed)

Each client machine sets `~/.claude/settings.json`:

```json
{
  "env": {
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://10.147.17.1:4318",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOG_TOOL_DETAILS": "1",
    "OTEL_RESOURCE_ATTRIBUTES": "host.name=my-mac"
  }
}
```

Update `host.name` per machine (zima, my-mac, my-win) and the hub's IP. Restart Claude Code.

**Full instructions:** See [DEPLOYMENT.md](./DEPLOYMENT.md) § Phase 2.

## Development

### Running Tests

```bash
cd hub
npm test                    # Run all
npm test -- receiver.test   # Specific test file
```

### Type Checking

```bash
npx tsc --noEmit
```

### Building

```bash
npm run build  # Compiles TypeScript to dist/
```

### Schema Changes

Edit `hub/src/schema.ts`, add a new migration string. The migration runner will apply it on next hub startup.

## Deployment Checklist

- [ ] Linux desktop: Ubuntu 24.04 LTS, encrypted disk, ufw hardened
- [ ] ZeroTier: Hub and all clients authorized, stable IPs assigned
- [ ] Hub: Node 20+ LTS, `git clone`, `npm ci && npm run build`
- [ ] Hub: Service user created, `/var/lib/claude-monitor/data` writable
- [ ] Hub: `hub/hub.service` installed as systemd service, `systemctl enable --now`
- [ ] Hub: Firewall rules (ufw) restrict 3001/4318 to ZeroTier interface
- [ ] Clients: `~/.claude/settings.json` configured with hub IP + `host.name`
- [ ] Clients: Verified ZeroTier connectivity (`ping <hub-ip>`)
- [ ] Clients: Restarted Claude Code sessions
- [ ] Verification: Run a prompt on each client, check dashboard shows distinct `machine_id` rows

## Monitoring

Hub health:

```bash
# Service status
systemctl status claude-monitor

# Recent logs (last 50 lines)
journalctl -u claude-monitor -n 50 -f

# Database queries
sqlite3 /var/lib/claude-monitor/data/monitor.db

# List machines with request count
sqlite> SELECT machine_id, COUNT(*) FROM api_requests GROUP BY 1;

# Database size (MB)
sqlite> SELECT page_count * page_size / 1024.0 / 1024.0 as mb FROM pragma_page_count(), pragma_page_size();
```

## Troubleshooting

**Clients show `machine_id=local`:** `OTEL_RESOURCE_ATTRIBUTES=host.name=...` not set or not reloaded. Verify settings.json, restart Claude Code.

**Clients can't reach hub:** ZeroTier not running on client, or hub not authorized in `my.zerotier.com`. Verify: `zerotier-cli listnetworks` shows OK; `ping <hub-ip>` succeeds.

**Hub service fails:** Check `journalctl -u claude-monitor -n 50`, verify DB file permissions, Node.js installed, paths in hub.service match your setup.

**Database bloat:** Backups auto-prune to 14 days. For older data, delete rows: `DELETE FROM api_requests WHERE ts < strftime('%s', 'now', '-30 days') * 1000000; VACUUM;`

See [DEPLOYMENT.md](./DEPLOYMENT.md) § Troubleshooting for more.

## Project Status

- ✅ Hub core (OTLP receiver, SQLite storage, REST API)
- ✅ Dashboard (5 tabs, multi-dimensional filtering)
- ✅ Multi-machine support via OTEL `host.name`
- ✅ ZeroTier deployment guide
- 🔲 Token-based auth (optional, later)
- 🔲 Satellite proxy pattern (optional, later)
- 🔲 Data export (CSV, JSON)
- 🔲 Retention policies (auto-cleanup)

## Files

- **DEPLOYMENT.md** — Multi-machine setup guide
- **CLAUDE.md** — Project architecture notes
- **hub/hub.service** — Systemd service file
- **hub/src/** — Hub implementation
- **dashboard/** — Web dashboard (vanilla JS, Chart.js)

## Questions?

- 📖 Read [DEPLOYMENT.md](./DEPLOYMENT.md) for setup issues
- 🐛 Check hub logs: `journalctl -u claude-monitor -f`
- 🔍 Query the database: `sqlite3 /var/lib/claude-monitor/data/monitor.db`
