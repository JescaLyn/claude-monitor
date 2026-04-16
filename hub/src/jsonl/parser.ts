import { statSync, openSync, readSync, closeSync } from 'fs';

export interface JsonlEntry {
  sessionId: string;
  timestamp: string;
  type: string;
  costUSD: number;
  agentId?: string;
  message?: {
    id: string;
    model: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  cwd?: string;
}

export interface ParseState {
  byteOffset: number;
  fileSize: number;
  mtime: string;
}

export interface ParseResult {
  entries: JsonlEntry[];
  newOffset: number;
}

/**
 * Parse new bytes from a JSONL file since the last known offset.
 * Uses byte-offset incremental parsing to avoid re-reading the entire file.
 */
export function parseFile(
  filePath: string,
  fromOffset: number = 0
): ParseResult {
  try {
    const stat = statSync(filePath);
    const mtime = stat.mtimeMs.toString();

    // File hasn't grown since last parse
    if (stat.size <= fromOffset) {
      return { entries: [], newOffset: fromOffset };
    }

    // File was truncated or replaced — reset offset to beginning
    if (stat.size < fromOffset) {
      fromOffset = 0;
    }

    // Read only the new bytes
    const fd = openSync(filePath, 'r');
    const bytesToRead = stat.size - fromOffset;
    const buf = Buffer.alloc(bytesToRead);

    try {
      readSync(fd, buf, 0, bytesToRead, fromOffset);
    } finally {
      closeSync(fd);
    }

    const text = buf.toString('utf-8');
    const lines = text.split('\n');

    // Deduplicate by message.id (last-write-wins for streaming)
    const entries = new Map<string, JsonlEntry>();

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const raw = JSON.parse(line);
        const entry = normalizeEntry(raw);

        if (entry && entry.message?.id) {
          // Dedup by message id
          entries.set(entry.message.id, entry);
        }
      } catch {
        // Skip invalid JSON lines
      }
    }

    return {
      entries: Array.from(entries.values()),
      newOffset: stat.size,
    };
  } catch (err) {
    // Log file access errors; may indicate permission/disk issues
    console.error(`[jsonl-parser] Error reading ${filePath}:`, err instanceof Error ? err.message : String(err));
    return { entries: [], newOffset: fromOffset };
  }
}

/**
 * Normalize raw JSONL entry to our schema.
 * Filter to cost-bearing assistant messages with token usage.
 */
function normalizeEntry(raw: unknown): JsonlEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;

  const obj = raw as Record<string, unknown>;

  // Only process assistant messages with cost/tokens
  if (obj.type !== 'assistant') return null;

  const message = obj.message as Record<string, unknown> | undefined;
  if (!message || typeof message !== 'object') return null;

  const usage = message.usage as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== 'object') return null;

  const inputTokens = usage.input_tokens as number | undefined;
  const outputTokens = usage.output_tokens as number | undefined;

  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
    return null;
  }

  return {
    sessionId: obj.sessionId as string,
    timestamp: obj.timestamp as string,
    type: 'assistant',
    costUSD: (obj.costUSD as number) ?? 0,
    agentId: obj.agentId as string | undefined,
    message: {
      id: message.id as string,
      model: (message.model as string) ?? 'unknown',
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens as number | undefined,
        cache_read_input_tokens: usage.cache_read_input_tokens as number | undefined,
      },
    },
    cwd: obj.cwd as string | undefined,
  };
}
