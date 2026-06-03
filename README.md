# Claude Monitor

A self-hosted utility that collects Claude Code usage telemetry on your Mac, stores it in SQLite, and visualizes usage patterns through a web dashboard. Understand where your Claude API spend is going — by session, project, model, and cost over time.

## How It Works

The hub runs locally on your Mac. It reads Claude Code session files directly from `~/.claude/projects/` and optionally accepts telemetry over OTLP if you want to connect other machines.

```
Your Mac
├─ Hub — JSONL watcher + OTLP receiver (:4318) + REST API + Dashboard (:3001) + SQLite
└─ Claude Code — session files at ~/.claude/projects/ (watched automatically)
```

## Quick Start

```bash
cd hub
npm install
npm run dev   # OTLP :4318, dashboard :3001
```

Open the dashboard: `http://localhost:3001/`

## Running as a Background Service

Install the included LaunchAgent to keep the hub running without a terminal window:

```bash
# Edit hub/claude-monitor.plist — set the paths to match your install location
cp hub/claude-monitor.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/claude-monitor.plist
```

Logs go to `/tmp/claude-monitor.log`. See [DEPLOYMENT.md](./DEPLOYMENT.md) for details.

## Dashboard

Five tabs:

- **Overview** — Aggregated cost, tokens, and session count; daily cost trends
- **Sessions** — Per-session breakdown with sortable columns; filter by machine, model, date
- **Projects** — Sessions grouped by project with collapsible rows and per-project model breakdown
- **Cost Analysis** — Multi-dimensional breakdown by machine, model, tool, and time period
- **Timeline** — Daily cost line chart with configurable period selector

## Data Collection

**JSONL watcher** reads session files from `~/.claude/projects/` automatically on startup and watches for new files. No configuration needed for local use.

**OTLP receiver** on `:4318` accepts telemetry pushed directly from Claude Code via `settings.json`. Useful for seeing real-time data or connecting additional machines.

## Database

SQLite at `hub/data/monitor.db` (WAL mode):

- **machines** — Distinct client identifiers
- **sessions** — Session metadata with aggregated cost and tokens
- **api_requests** — Per-request detail: cost, tokens, model, duration, fast-mode flag
- **tool_events** — Tool invocations with skill names and success/failure
- **metric_snapshots** — Time-series OTEL metrics

Migrations are declarative in `hub/src/schema.ts` and applied automatically on startup.

## Adding Other Machines (Optional)

Each additional machine running Claude Code can push telemetry to the hub. On the remote machine, add to `~/.claude/settings.json`:

```json
{
  "env": {
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://<hub-ip>:4318",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOG_TOOL_DETAILS": "1",
    "OTEL_RESOURCE_ATTRIBUTES": "host.name=<machine-name>"
  }
}
```

Use a distinct `host.name` per machine. The dashboard groups sessions by machine automatically.

## Development

```bash
cd hub
npm test                    # Run all tests
npm test -- receiver.test   # Specific file
npx tsc --noEmit            # Type check
npm run build               # Compile TypeScript to dist/
```

To add a schema migration: edit `hub/src/schema.ts` and append a new migration string. It runs on next hub startup.

## Troubleshooting

**Sessions not appearing:** The JSONL watcher reads `~/.claude/projects/`. Verify Claude Code has run at least one session and the directory exists.

**`machine_id=local` in sessions:** `OTEL_RESOURCE_ATTRIBUTES=host.name=...` not set in `settings.json`, or Claude Code not restarted after the change.

**Hub service not starting:** Check `/tmp/claude-monitor.log`. Common causes: paths in the plist don't match your install location, or Node.js not in the PATH specified in the plist.

## Project Status

- ✅ JSONL watcher (reads `~/.claude/projects/` directly)
- ✅ OTLP receiver (push telemetry from Claude Code)
- ✅ SQLite storage with WAL mode
- ✅ Dashboard (5 tabs, multi-dimensional filtering)
- ✅ Multi-machine support via OTEL `host.name`
- 🔲 Token-based auth
- 🔲 Data export (CSV, JSON)
- 🔲 Retention policies

## Files

- **hub/src/** — Hub implementation (receiver, parser, ingest, API, JSONL watcher)
- **dashboard/** — Web dashboard (vanilla JS, Chart.js)
- **hub/claude-monitor.plist** — macOS LaunchAgent for background service
- **hub/hub.service** — systemd unit for Linux deployments
- **CLAUDE.md** — Project notes
