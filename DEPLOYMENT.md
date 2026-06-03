# Deployment: Running as a macOS Background Service

The hub can run as a LaunchAgent so it starts automatically on login and stays running without a terminal window.

## Setup

1. Edit `hub/claude-monitor.plist` — update the path placeholders to match your install location:

   - `<string>/path/to/claude-monitor/hub</string>` — absolute path to the `hub/` directory
   - `<string>/path/to/claude-monitor</string>` — absolute path to the repo root
   - Also update `<string>/usr/local/bin/npm</string>` if your npm is elsewhere (`which npm`)

2. Build the hub:

   ```bash
   cd hub && npm ci && npm run build
   ```

3. Install and load the agent:

   ```bash
   cp hub/claude-monitor.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/claude-monitor.plist
   ```

4. Verify it started:

   ```bash
   curl http://localhost:3001/api/summary   # Should return JSON
   tail -f /tmp/claude-monitor.log          # Watch logs
   ```

## Managing the Service

```bash
# Stop
launchctl unload ~/Library/LaunchAgents/claude-monitor.plist

# Restart (after code changes)
launchctl unload ~/Library/LaunchAgents/claude-monitor.plist
npm run build --prefix hub
launchctl load ~/Library/LaunchAgents/claude-monitor.plist

# View logs
tail -f /tmp/claude-monitor.log
```

## Configuring Claude Code to Push Telemetry

By default the hub reads session data from `~/.claude/projects/` directly — no client configuration needed. To also receive real-time OTLP telemetry, add to `~/.claude/settings.json`:

```json
{
  "env": {
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4318",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOG_TOOL_DETAILS": "1",
    "OTEL_RESOURCE_ATTRIBUTES": "host.name=my-mac"
  }
}
```

Restart Claude Code after editing `settings.json`.

## Troubleshooting

**Service fails to load:** Check the plist for syntax errors with `plutil hub/claude-monitor.plist`. Verify all paths exist.

**`npm: command not found` in logs:** The plist PATH needs to include your npm location. Find it with `which npm` and add its directory to the PATH entry in the plist.

**Database location:** Defaults to `hub/data/monitor.db` relative to the WorkingDirectory set in the plist.
