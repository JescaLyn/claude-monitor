import type Database from 'better-sqlite3';
import { watch } from 'chokidar';
import { hostname } from 'os';
import { parseFile, type ParseState } from './parser.js';
import { ingestJsonlEntries } from './ingest.js';
import { findJsonlFiles } from './paths.js';

interface ParseStateMap {
  [filePath: string]: ParseState;
}

let parseStateMap: ParseStateMap = {};
let flushTimer: NodeJS.Timeout | null = null;

/**
 * Start watching JSONL files for changes and ingesting them into the DB.
 */
export function startJsonlWatcher(db: Database.Database): void {
  const machineId = hostname();

  // Load existing parse state from DB
  loadParseState(db);

  // Do initial catch-up pass
  const files = findJsonlFiles();
  console.log(`[jsonl-watcher] Found ${files.length} JSONL files`);
  initialParse(db, files, machineId);

  // Start watching for new/changed files
  const watchPaths = [
    process.env.HOME ? `${process.env.HOME}/.claude/projects` : '',
    process.env.HOME ? `${process.env.HOME}/.config/claude/projects` : '',
  ].filter(Boolean);

  if (watchPaths.length === 0) {
    console.log('[jsonl-watcher] No JSONL directories found, skipping watcher');
    return;
  }

  const watcher = watch(watchPaths, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500, // Wait 500ms for file writes to stabilize
      pollInterval: 100,
    },
  });

  watcher.on('add', (filePath) => {
    if (filePath.endsWith('.jsonl')) {
      console.log(`[jsonl-watcher] Added: ${filePath}`);
      processFile(db, filePath, machineId);
    }
  });

  watcher.on('change', (filePath) => {
    if (filePath.endsWith('.jsonl')) {
      console.log(`[jsonl-watcher] Changed: ${filePath}`);
      processFile(db, filePath, machineId);
    }
  });

  // Flush parse state periodically
  flushTimer = setInterval(() => {
    flushParseState(db);
  }, 30000); // 30 seconds

  console.log('[jsonl-watcher] Watching for JSONL file changes');
}

/**
 * Load parse state from the DB into memory.
 */
function loadParseState(db: Database.Database): void {
  try {
    const rows = db.prepare('SELECT file_path, byte_offset, file_size, mtime FROM parse_state').all() as Array<{
      file_path: string;
      byte_offset: number;
      file_size: number;
      mtime: string;
    }>;

    parseStateMap = {};
    for (const row of rows) {
      parseStateMap[row.file_path] = {
        byteOffset: row.byte_offset,
        fileSize: row.file_size,
        mtime: row.mtime,
      };
    }
  } catch {
    // Table may not exist in older DBs, ignore
    parseStateMap = {};
  }
}

/**
 * Do an initial catch-up pass over all JSONL files.
 */
function initialParse(db: Database.Database, files: string[], machineId: string): void {
  for (const filePath of files) {
    processFile(db, filePath, machineId);
  }
  console.log('[jsonl-watcher] Initial parse complete');
}

/**
 * Parse a single file and ingest new entries.
 */
function processFile(db: Database.Database, filePath: string, machineId: string): void {
  try {
    const state = parseStateMap[filePath];
    const fromOffset = state?.byteOffset ?? 0;

    const { entries, sessionNames, asyncAgentLaunches, newOffset } = parseFile(filePath, fromOffset);

    if (entries.length > 0 || sessionNames.size > 0 || asyncAgentLaunches.length > 0) {
      if (entries.length > 0) {
        console.log(`[jsonl-watcher] Parsed ${entries.length} entries from ${filePath}`);
      }
      ingestJsonlEntries(db, entries, machineId, filePath, sessionNames, asyncAgentLaunches);
    }

    // Update parse state
    parseStateMap[filePath] = {
      byteOffset: newOffset,
      fileSize: newOffset,
      mtime: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`[jsonl-watcher] Error processing ${filePath}:`, err);
  }
}

/**
 * Flush the in-memory parse state to the DB.
 */
function flushParseState(db: Database.Database): void {
  try {
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO parse_state (file_path, byte_offset, file_size, mtime)
      VALUES (?, ?, ?, ?)
    `);

    const tx = db.transaction((entries: Array<[string, ParseState]>) => {
      for (const [filePath, state] of entries) {
        upsert.run(filePath, state.byteOffset, state.fileSize, state.mtime);
      }
    });

    tx(Object.entries(parseStateMap).map(([filePath, state]) => [filePath, state]));
  } catch (err) {
    console.error('[jsonl-watcher] Error flushing parse state:', err);
  }
}
