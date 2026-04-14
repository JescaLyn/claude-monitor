#!/usr/bin/env python3
"""
Poll Anthropic Claude API rate limits and send to claude-monitor hub.

Usage:
  python3 poll-rate-limits.py

Environment variables:
  ANTHROPIC_API_KEY      - Required; your Anthropic API key
  MONITOR_HUB_URL        - Hub URL (e.g., http://10.147.17.1:3001); default: http://localhost:3001
  MONITOR_MACHINE_ID     - Machine identifier (e.g., my-mac); default: hostname
  POLL_INTERVAL_SECONDS  - Polling interval; default: 300 (5 minutes)
"""

import os
import sys
import json
import time
import uuid
from datetime import datetime
import socket
import requests
from anthropic import Anthropic

def get_env(key, default=None, required=False):
    val = os.environ.get(key, default)
    if required and not val:
        print(f"ERROR: {key} is required", file=sys.stderr)
        sys.exit(1)
    return val

def get_machine_id():
    return get_env('MONITOR_MACHINE_ID', socket.gethostname())

def poll_rate_limits():
    """Call Token Counting API to capture rate limit headers."""
    api_key = get_env('ANTHROPIC_API_KEY', required=True)
    client = Anthropic(api_key=api_key)

    models = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5']
    snapshots = []

    for model in models:
        try:
            # Use Token Counting API with raw_response to access rate limit headers
            response = client.messages.with_raw_response.count_tokens(
                model=model,
                messages=[{"role": "user", "content": "test"}]
            )
            headers = response.headers

            # Validate that we got rate limit headers (error if missing)
            requests_remaining = parse_header(headers, 'anthropic-ratelimit-requests-remaining')
            if requests_remaining is None:
                print(f"[{datetime.now().isoformat()}] WARNING: No rate limit headers for {model}; skipping snapshot", file=sys.stderr)
                continue

            snapshot = {
                'id': str(uuid.uuid4()),
                'machine_id': get_machine_id(),
                'ts': int(time.time() * 1_000_000),  # microseconds
                'model': model,
                'requests_limit': parse_header(headers, 'anthropic-ratelimit-requests-limit'),
                'requests_remaining': requests_remaining,
                'requests_reset_at': get_header(headers, 'anthropic-ratelimit-requests-reset'),
                'input_tokens_limit': parse_header(headers, 'anthropic-ratelimit-input-tokens-limit'),
                'input_tokens_remaining': parse_header(headers, 'anthropic-ratelimit-input-tokens-remaining'),
                'input_tokens_reset_at': get_header(headers, 'anthropic-ratelimit-input-tokens-reset'),
                'output_tokens_limit': parse_header(headers, 'anthropic-ratelimit-output-tokens-limit'),
                'output_tokens_remaining': parse_header(headers, 'anthropic-ratelimit-output-tokens-remaining'),
                'output_tokens_reset_at': get_header(headers, 'anthropic-ratelimit-output-tokens-reset'),
                # Token counting API is free per Anthropic pricing docs
                'polling_cost_usd': 0.0,
            }
            snapshots.append(snapshot)
            print(f"[{datetime.now().isoformat()}] Polled {model}: {snapshot['requests_remaining']} requests remaining")
        except Exception as e:
            print(f"[{datetime.now().isoformat()}] ERROR polling {model}: {e}", file=sys.stderr)

    return snapshots

def get_header(headers, key):
    """Get header value, case-insensitive."""
    for k, v in headers.items():
        if k.lower() == key.lower():
            return v
    return None

def parse_header(headers, key):
    """Parse integer header value."""
    val = get_header(headers, key)
    if val:
        try:
            return int(val)
        except ValueError:
            return None
    return None

def send_snapshots(snapshots):
    """POST snapshots to hub API."""
    if not snapshots:
        return

    hub_url = get_env('MONITOR_HUB_URL', 'http://localhost:3001')
    url = f"{hub_url}/api/rate-limits"

    try:
        response = requests.post(url, json=snapshots, timeout=10)
        if response.status_code == 200:
            print(f"[{datetime.now().isoformat()}] Sent {len(snapshots)} rate limit snapshots to hub")
        else:
            print(f"[{datetime.now().isoformat()}] WARNING: Hub returned {response.status_code}: {response.text}", file=sys.stderr)
    except Exception as e:
        print(f"[{datetime.now().isoformat()}] ERROR sending to hub: {e}", file=sys.stderr)

def main():
    poll_interval = int(get_env('POLL_INTERVAL_SECONDS', '300'))

    print(f"[{datetime.now().isoformat()}] Starting rate limit poller")
    print(f"  Machine ID: {get_machine_id()}")
    print(f"  Hub URL: {get_env('MONITOR_HUB_URL', 'http://localhost:3001')}")
    print(f"  Poll interval: {poll_interval}s")

    while True:
        snapshots = poll_rate_limits()
        send_snapshots(snapshots)
        time.sleep(poll_interval)

if __name__ == '__main__':
    main()
