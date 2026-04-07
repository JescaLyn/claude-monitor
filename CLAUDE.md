# claude-monitor

A self-hosted Claude Code usage monitoring system. Collects OpenTelemetry telemetry from Claude Code sessions across multiple machines, stores everything in SQLite, and surfaces usage patterns through a tabbed web dashboard and a terminal TUI.

## Project Goal

Understand where Claude usage (tokens, cost) is going — broken down by session, skill invoked, tool used, machine, and project — so high-burn patterns can be identified and optimized.

## Status

In design phase. See `docs/design-notes.md` for current architecture decisions.

## Session Protocol: `standard`
