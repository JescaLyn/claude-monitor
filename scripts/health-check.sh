#!/bin/bash
# Health check for Claude Monitor Hub
# Run on the hub to verify service and database health

set -e

HUB_IP="${1:-localhost}"
OTLP_PORT="${2:-4318}"
API_PORT="${3:-3001}"
DB_PATH="${DB_PATH:-/var/lib/claude-monitor/data/monitor.db}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Claude Monitor Health Check"
echo "============================"
echo ""

# Check if service is running
echo -n "Systemd service status... "
if systemctl is-active --quiet claude-monitor; then
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${RED}FAILED${NC}"
  systemctl status claude-monitor || true
  exit 1
fi

# Check OTLP endpoint
echo -n "OTLP endpoint (:$OTLP_PORT)... "
if curl -s -X POST "http://$HUB_IP:$OTLP_PORT/v1/logs" \
  -H 'content-type: application/json' \
  -d '{"resourceLogs":[]}' -o /dev/null -w "%{http_code}" | grep -q 200; then
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${RED}FAILED${NC}"
  exit 1
fi

# Check REST API
echo -n "REST API (:$API_PORT)... "
if curl -s "http://$HUB_IP:$API_PORT/api/summary" | grep -q '"sessions"'; then
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${RED}FAILED${NC}"
  exit 1
fi

# Check dashboard
echo -n "Dashboard (:$API_PORT)... "
if curl -s "http://$HUB_IP:$API_PORT/" | grep -q '<html'; then
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${RED}FAILED${NC}"
  exit 1
fi

# Check database
echo -n "Database file... "
if [ -f "$DB_PATH" ]; then
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${RED}NOT FOUND ($DB_PATH)${NC}"
  exit 1
fi

# Database size
echo -n "Database size... "
if command -v sqlite3 &> /dev/null; then
  SIZE=$(sqlite3 "$DB_PATH" "SELECT page_count * page_size / 1024.0 / 1024.0 FROM pragma_page_count(), pragma_page_size();" 2>/dev/null || echo "?")
  echo -e "${GREEN}$SIZE MB${NC}"
else
  echo -e "${YELLOW}sqlite3 not installed${NC}"
fi

# Machine count
echo -n "Distinct machines... "
if command -v sqlite3 &> /dev/null; then
  COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM machines;" 2>/dev/null || echo "?")
  echo -e "${GREEN}$COUNT${NC}"
else
  echo -e "${YELLOW}sqlite3 not installed${NC}"
fi

# Session count
echo -n "Active sessions... "
if command -v sqlite3 &> /dev/null; then
  COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sessions WHERE ended_at IS NULL;" 2>/dev/null || echo "?")
  echo -e "${GREEN}$COUNT${NC}"
else
  echo -e "${YELLOW}sqlite3 not installed${NC}"
fi

# Recent requests
echo -n "API requests (last hour)... "
if command -v sqlite3 &> /dev/null; then
  COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM api_requests WHERE ts > (strftime('%s', 'now') * 1000000 - 3600000000);" 2>/dev/null || echo "?")
  echo -e "${GREEN}$COUNT${NC}"
else
  echo -e "${YELLOW}sqlite3 not installed${NC}"
fi

echo ""
echo -e "${GREEN}All checks passed!${NC}"
