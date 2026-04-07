#!/usr/bin/env python3
"""
Minimal OTLP capture server.
Listens on port 4318 (HTTP/JSON) and 4317 (gRPC detection).
Logs every request: method, path, content-type, body prefix.

Usage: python3 tools/otlp-capture.py
Stop with Ctrl+C. Output goes to stdout and logs/otlp-capture.log
"""

import http.server
import json
import sys
import os
import socket
import threading
from datetime import datetime

LOG_FILE = os.path.join(os.path.dirname(__file__), '..', 'logs', 'otlp-capture.log')
HTTP_PORT = 4318
GRPC_PROBE_PORT = 4317


def log(msg):
    line = f"[{datetime.now().isoformat()}] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, 'a') as f:
        f.write(line + '\n')


class OTLPHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress default access log

    def do_POST(self):
        content_length = self.headers.get('Content-Length')
        content_type = self.headers.get('Content-Type', 'unknown')
        transfer_encoding = self.headers.get('Transfer-Encoding', '')
        if content_length is not None:
            body = self.rfile.read(int(content_length))
        elif 'chunked' in transfer_encoding.lower():
            # Read chunked body manually
            body = b''
            while True:
                line = self.rfile.readline().strip()
                chunk_size = int(line, 16)
                if chunk_size == 0:
                    break
                body += self.rfile.read(chunk_size)
                self.rfile.read(2)  # consume CRLF
        else:
            body = self.rfile.read()

        log(f"HTTP POST {self.path}")
        log(f"  Content-Type: {content_type}")
        log(f"  Body length: {len(body)} bytes")

        # Try to decode as JSON
        if b'json' in content_type.encode() or body.startswith(b'{') or body.startswith(b'['):
            try:
                parsed = json.loads(body)
                # Save full payload to a timestamped file for inspection
                ts = datetime.now().strftime('%H%M%S_%f')
                path_slug = self.path.strip('/').replace('/', '_')
                out_path = os.path.join(os.path.dirname(LOG_FILE), f'payload_{ts}_{path_slug}.json')
                with open(out_path, 'w') as pf:
                    json.dump(parsed, pf, indent=2)
                summary = json.dumps(parsed, indent=2)[:500]
                log(f"  Body (JSON, truncated):\n{summary}")
                log(f"  Full payload saved: {out_path}")
            except Exception:
                log(f"  Body (raw prefix): {body[:200]}")
        elif body[:4] == b'\x00\x00\x00\x00':
            log(f"  Body looks like gRPC framing (length-prefixed binary)")
        elif body[:5] in (b'\x1f\x8b\x08', ):
            log(f"  Body looks gzip-compressed")
        else:
            log(f"  Body (raw prefix): {body[:200]}")

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{}')

    def do_GET(self):
        log(f"HTTP GET {self.path}")
        self.send_response(200)
        self.end_headers()


def probe_grpc_port():
    """Listen on 4317 briefly to detect any gRPC connection attempts."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(('0.0.0.0', GRPC_PROBE_PORT))
        s.listen(5)
        s.settimeout(1)
        log(f"gRPC probe: listening on :{GRPC_PROBE_PORT}")
        while True:
            try:
                conn, addr = s.accept()
                data = conn.recv(256)
                log(f"gRPC probe: connection from {addr}, data prefix: {data[:64]}")
                conn.close()
            except socket.timeout:
                continue
    except OSError as e:
        log(f"gRPC probe: could not bind :{GRPC_PROBE_PORT} ({e}) — port may be in use or unavailable")


if __name__ == '__main__':
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    open(LOG_FILE, 'w').close()  # reset log

    # Start gRPC probe in background
    t = threading.Thread(target=probe_grpc_port, daemon=True)
    t.start()

    log(f"OTLP capture server starting on :{HTTP_PORT} (HTTP/JSON)")
    log(f"Log file: {os.path.abspath(LOG_FILE)}")
    log("Waiting for telemetry... (Ctrl+C to stop)")

    server = http.server.HTTPServer(('0.0.0.0', HTTP_PORT), OTLPHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("Stopped.")
