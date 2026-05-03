export const MIGRATIONS: string[] = [
  // Migration 0: initial schema
  `
  CREATE TABLE IF NOT EXISTS machines (
    id         TEXT PRIMARY KEY,
    first_seen INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id                    TEXT PRIMARY KEY,
    machine_id            TEXT NOT NULL,
    model                 TEXT,
    started_at            INTEGER NOT NULL,
    ended_at              INTEGER,
    cost_usd              REAL NOT NULL DEFAULT 0,
    input_tokens          INTEGER NOT NULL DEFAULT 0,
    output_tokens         INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS api_requests (
    id                    TEXT PRIMARY KEY,
    session_id            TEXT NOT NULL REFERENCES sessions(id),
    ts                    INTEGER NOT NULL,
    prompt_id             TEXT NOT NULL,
    model                 TEXT NOT NULL,
    cost_usd              REAL NOT NULL,
    input_tokens          INTEGER NOT NULL DEFAULT 0,
    output_tokens         INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    duration_ms           INTEGER,
    is_fast_mode          INTEGER NOT NULL DEFAULT 0,
    event_sequence        INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tool_events (
    id             TEXT PRIMARY KEY,
    session_id     TEXT NOT NULL REFERENCES sessions(id),
    ts             INTEGER NOT NULL,
    prompt_id      TEXT NOT NULL,
    tool_name      TEXT NOT NULL,
    skill_name     TEXT,
    duration_ms    INTEGER,
    success        INTEGER,
    machine_id     TEXT NOT NULL,
    event_sequence INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS metric_snapshots (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id     TEXT NOT NULL,
    metric_name    TEXT NOT NULL,
    dimension_key  TEXT NOT NULL,
    value          REAL NOT NULL,
    time_unix_nano TEXT NOT NULL,
    machine_id     TEXT NOT NULL,
    UNIQUE(session_id, metric_name, dimension_key, time_unix_nano)
  );

  CREATE INDEX IF NOT EXISTS idx_api_requests_session ON api_requests(session_id);
  CREATE INDEX IF NOT EXISTS idx_api_requests_ts ON api_requests(ts);
  CREATE INDEX IF NOT EXISTS idx_tool_events_session ON tool_events(session_id);
  CREATE INDEX IF NOT EXISTS idx_tool_events_tool ON tool_events(tool_name);
  CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_machine ON sessions(machine_id);
  CREATE INDEX IF NOT EXISTS idx_metric_snapshots_session ON metric_snapshots(session_id);
  `,

  // Migration 1: add human-readable name to sessions (note: old dbs might fail if column exists, but new ones are fine)
  `ALTER TABLE sessions ADD COLUMN name TEXT;`,

  // Migration 2: add project column and parse_state table for JSONL ingestion
  `
  ALTER TABLE sessions ADD COLUMN project TEXT;

  CREATE TABLE IF NOT EXISTS parse_state (
    file_path   TEXT PRIMARY KEY,
    byte_offset INTEGER NOT NULL DEFAULT 0,
    file_size   INTEGER NOT NULL DEFAULT 0,
    mtime       TEXT NOT NULL DEFAULT ''
  );
  `,

  // Migration 3: add rate_limit_snapshots for polling rate limit data
  `
  CREATE TABLE IF NOT EXISTS rate_limit_snapshots (
    id                    TEXT PRIMARY KEY,
    machine_id            TEXT NOT NULL,
    ts                    INTEGER NOT NULL,
    model                 TEXT NOT NULL,
    requests_limit        INTEGER,
    requests_remaining    INTEGER,
    requests_reset_at     TEXT,
    input_tokens_limit    INTEGER,
    input_tokens_remaining INTEGER,
    input_tokens_reset_at TEXT,
    output_tokens_limit   INTEGER,
    output_tokens_remaining INTEGER,
    output_tokens_reset_at TEXT,
    polling_cost_usd      REAL NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_rate_limit_snapshots_machine ON rate_limit_snapshots(machine_id);
  CREATE INDEX IF NOT EXISTS idx_rate_limit_snapshots_ts ON rate_limit_snapshots(ts);
  CREATE INDEX IF NOT EXISTS idx_rate_limit_snapshots_model ON rate_limit_snapshots(model);
  `,

  // Migration 4: add parent_session_id to track subagent relationships
  `
  ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);
  `,

  // Migration 5: add denormalized counts and last_event_ts for query performance
  `
  ALTER TABLE sessions ADD COLUMN api_request_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sessions ADD COLUMN tool_call_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sessions ADD COLUMN last_event_ts INTEGER;
  `,

  // Migration 6: add agent_id to api_requests for subagent tracking
  `
  ALTER TABLE api_requests ADD COLUMN agent_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_api_requests_agent ON api_requests(agent_id);
  `,

  // Migration 7: add agent_type to sessions to track subagent type (e.g., "Explore", "code-reviewer")
  `
  ALTER TABLE sessions ADD COLUMN agent_type TEXT;
  `,

  // Migration 8: fix self-referential parent_session_id rows created by a bug where
  // subagent JSONL entries (which use the parent's UUID as sessionId) caused the parent
  // session to be inserted with parent_session_id = itself before the real parent JSONL
  // was processed.
  `
  UPDATE sessions SET parent_session_id = NULL WHERE parent_session_id = id;
  `,

  // Migration 9: back-fill cost_usd for JSONL-sourced api_requests where costUSD was null
  // in the JSONL files (all JSONL entries). Uses per-model token pricing to compute cost.
  `
  UPDATE api_requests SET cost_usd = (
    CASE
      WHEN model LIKE '%haiku-4-5%' THEN
        (input_tokens * 1.0 + output_tokens * 5.0 + cache_read_tokens * 0.10 + cache_creation_tokens * 1.25) / 1000000
      WHEN model LIKE '%sonnet-4-6%' THEN
        (input_tokens * 3.0 + output_tokens * 15.0 + cache_read_tokens * 0.30 + cache_creation_tokens * 3.75) / 1000000
      WHEN model LIKE '%opus-4-7%' THEN
        (input_tokens * 5.0 + output_tokens * 25.0 + cache_read_tokens * 0.50 + cache_creation_tokens * 6.25) / 1000000
      ELSE
        (input_tokens * 3.0 + output_tokens * 15.0 + cache_read_tokens * 0.30 + cache_creation_tokens * 3.75) / 1000000
    END
  )
  WHERE duration_ms IS NULL AND cost_usd = 0 AND input_tokens > 0;
  `,

  // Migration 10: refresh session cost aggregates after the cost back-fill in migration 9.
  // Sessions table stores denormalized cost_usd; re-sum from api_requests per session.
  `
  UPDATE sessions SET cost_usd = (
    SELECT COALESCE(SUM(ar.cost_usd), 0)
    FROM api_requests ar
    WHERE ar.session_id = sessions.id
      AND (ar.agent_id IS NULL OR ar.agent_id = sessions.id)
  );
  `,
];
