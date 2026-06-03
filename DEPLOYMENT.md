# Multi-Machine Deployment via ZeroTier

This document guides the setup of claude-monitor across multiple machines (Linux hub, Zima, Mac, Windows) using ZeroTier for secure remote communication.

## Architecture

```
ZeroTier Private Network (10.147.x.0/24)
│
├─ Linux desktop (10.147.17.1) — Hub
│  ├─ OTLP receiver (:4318)
│  ├─ REST API + Dashboard (:3001)
│  └─ SQLite database
│
├─ Zima (10.147.17.2) — Client
├─ Mac laptop (10.147.17.3) — Client
└─ Win laptop (10.147.17.4) — Client
   All three send telemetry to the hub via OTLP.
```

---

## Phase 0: Prerequisites

- Linux desktop: **Ubuntu 24.04 LTS Server (fresh install, encrypted disk, ufw hardened)**
- ZeroTier network already configured with all four machines authorized
- Node.js 20+ LTS
- Git, curl, basic build tools

---

## Phase 1: Linux Hub Setup

### 1.1 Install ZeroTier

```bash
curl -s https://install.zerotier.com | sudo bash
sudo systemctl enable --now zerotier-one
sudo zerotier-cli join <network-id>
```

Then authorize the machine in `my.zerotier.com` and note its assigned IP (e.g., `10.147.17.1`).

### 1.2 Create Service User & Directories

```bash
sudo useradd --system --home /var/lib/claude-monitor --shell /usr/sbin/nologin claude-monitor
sudo mkdir -p /opt/claude-monitor /var/lib/claude-monitor/data
sudo chown -R claude-monitor:claude-monitor /var/lib/claude-monitor
cd /opt/claude-monitor
git clone <repo-url> .  # or: cd /opt && git clone <repo-url> claude-monitor
cd /opt/claude-monitor/hub && npm ci && npm run build
```

### 1.3 Install Systemd Service

The service file is already configured for the default install paths. Copy it as-is:

```bash
sudo cp hub/hub.service /etc/systemd/system/claude-monitor.service
sudo systemctl daemon-reload
sudo systemctl enable --now claude-monitor
```

Verify:
```bash
journalctl -u claude-monitor -f  # Should show startup messages
curl http://localhost:3001/api/summary  # Should return JSON
```

### 1.4 Firewall: Allow ZeroTier Interface Only

Restrict OTLP and API ports to ZeroTier traffic:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on zt+ to any port 22 proto tcp   # SSH on ZeroTier
sudo ufw allow in on zt+ to any port 3001 proto tcp # API/Dashboard
sudo ufw allow in on zt+ to any port 4318 proto tcp # OTLP receiver
sudo ufw enable
sudo ufw status verbose
```

### 1.5 Smoke Test

From the Linux hub, verify the endpoints are reachable:
```bash
# OTLP endpoint
curl -X POST http://localhost:4318/v1/logs -H 'content-type: application/json' -d '{}'
# API
curl http://localhost:3001/api/summary | jq .
# Dashboard
curl http://localhost:3001/ | head -5
```

All should succeed with 200 status.

---

## Phase 2: Configure Each Client Machine

Apply the following to Zima, Mac, and Windows.

### 2.1 Determine ZeroTier IP

Find the Linux hub's ZeroTier IP from `my.zerotier.com` (e.g., `10.147.17.1`).

### 2.2 Create/Update `~/.claude/settings.json`

Add the `env` block below. On **Windows**, the path is `%USERPROFILE%\.claude\settings.json`.

```json
{
  "env": {
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://10.147.17.1:4318",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOG_TOOL_DETAILS": "1",
    "OTEL_RESOURCE_ATTRIBUTES": "host.name=<machine-id>"
  }
}
```

Use distinct `host.name` values:
- Zima: `host.name=zima`
- Mac: `host.name=my-mac`
- Windows: `host.name=my-win`

### 2.3 Verify ZeroTier Connectivity

Before configuring Claude Code, confirm the client can reach the hub:

```bash
ping 10.147.17.1        # Should respond
curl http://10.147.17.1:3001/api/summary  # Should return JSON
```

If either fails, ZeroTier is not running or the hub is unreachable.

### 2.4 Restart Claude Code Sessions

Close and reopen any running Claude Code sessions (CLI, IDE, web, desktop). New sessions will use the updated env vars.

---

## Phase 3: End-to-End Verification

### 3.1 Generate Telemetry

Run a simple prompt on each client:
- Zima: `claude "hello" --model opus-4-6`
- Mac: Run a prompt in the Claude Code IDE extension or CLI
- Windows: Same as Mac

### 3.2 Verify Data in Hub Database

SSH to the Linux hub and query:

```bash
sqlite3 /var/lib/claude-monitor/data/monitor.db

# List machines with telemetry:
SELECT DISTINCT machine_id, COUNT(*) as request_count FROM api_requests GROUP BY 1;

# Should output:
# zima|5
# my-mac|3
# my-win|2
# (or similar — non-empty counts for each machine)
```

If all machines show distinct rows (not `local`), the receiver's `host.name` extraction is working.

### 3.3 View Dashboard

Open any web browser and navigate to `http://10.147.17.1:3001/` from any client machine. The dashboard should load with:
- Overview tab showing aggregated costs/tokens
- Sessions tab grouped by machine_id
- Cost Analysis showing trends across all machines

---

## Phase 4: Ongoing Operations

### 4.1 Automatic Updates & Backups

On the Linux hub:

```bash
# Enable automatic security updates
sudo systemctl enable --now unattended-upgrades

# Backup database nightly
cat > /tmp/backup-monitor.sh << 'EOF'
#!/bin/bash
sqlite3 /var/lib/claude-monitor/data/monitor.db \
  ".backup /var/backups/monitor-$(date +%F).db"
find /var/backups/monitor-*.db -mtime +14 -delete  # Keep 14 days
EOF

sudo cp /tmp/backup-monitor.sh /usr/local/bin/backup-monitor
sudo chmod +x /usr/local/bin/backup-monitor
echo "0 2 * * * root /usr/local/bin/backup-monitor" | sudo tee /etc/cron.d/monitor-backup
```

### 4.2 Monitor Hub Health

Check periodically:

```bash
# Service status
systemctl status claude-monitor

# Recent logs
journalctl -u claude-monitor -n 50

# Database size
sqlite3 /var/lib/claude-monitor/data/monitor.db "SELECT page_count * page_size / 1024.0 / 1024.0 as mb FROM pragma_page_count(), pragma_page_size();"

# Active sessions
sqlite3 /var/lib/claude-monitor/data/monitor.db "SELECT COUNT(*) FROM sessions WHERE ended_at IS NULL;"
```

### 4.3 Restart Service

If needed:

```bash
sudo systemctl restart claude-monitor
journalctl -u claude-monitor -f  # Watch startup
```

---

## Troubleshooting

### Clients send `machine_id=local` instead of their hostname

- **Cause**: `OTEL_RESOURCE_ATTRIBUTES=host.name=...` not set or session didn't restart after settings change.
- **Fix**: Verify `~/.claude/settings.json` on the client, restart Claude Code.

### Clients cannot reach hub (OTLP timeout)

- **Cause**: ZeroTier not running, client not authorized, firewall blocking.
- **Steps**:
  1. On client: `zerotier-cli listnetworks` — should show `OK` for the network.
  2. Ping hub from client: `ping 10.147.17.1` — must succeed.
  3. On hub: `sudo ufw status` — check rules allow port 4318 on `zt+`.

### Hub service fails to start

- **Logs**: `journalctl -u claude-monitor -n 50`
- **Common issues**:
  - DB file permissions: `ls -la /var/lib/claude-monitor/data/monitor.db`
  - Missing Node.js: `which node && node -v`
  - Path mismatch: `hub/hub.service` WorkingDirectory vs actual install path.

### Database bloat

- **Symptom**: Hub gets slow or runs out of disk space.
- **Mitigation**: Backups already prune to 14 days. For older data, delete rows:
  ```bash
  sqlite3 /var/lib/claude-monitor/data/monitor.db \
    "DELETE FROM api_requests WHERE ts < strftime('%s', 'now', '-30 days') * 1000000;"
  sqlite3 /var/lib/claude-monitor/data/monitor.db "VACUUM;"
  ```

---

## Optional: Token-Based Auth (Later)

If you later want to restrict the hub to authenticated clients only:

1. Set `MONITOR_TOKEN=<long-random-string>` in hub/hub.service Environment.
2. Add to each client's `~/.claude/settings.json`:
   ```json
   "OTEL_EXPORTER_OTLP_HEADERS": "x-monitor-token=<same-token>"
   ```
3. Patch hub receiver to validate the header (requires code change).

---

## Questions?

- **Hub connectivity**: Test with `curl http://10.147.17.1:3001/api/summary`
- **Service issues**: `journalctl -u claude-monitor -f` captures all output
- **ZeroTier**: Verify `my.zerotier.com` shows all four machines authorized with stable IPs
