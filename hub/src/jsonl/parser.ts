import { statSync, openSync, readSync, closeSync } from 'fs';

export interface JsonlEntry {
  sessionId: string;
  timestamp: string;
  type: string;
  costUSD: number;
  agentId?: string;
  agentType?: string;
  sessionName?: string;
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
  sessionNames: Map<string, string>; // sessionId -> name
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
      return { entries: [], sessionNames: new Map(), newOffset: fromOffset };
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
    const sessionNames = new Map<string, string>();

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const raw = JSON.parse(line);

        // Extract session name from custom-title metadata
        if ((raw as Record<string, unknown>).type === 'custom-title' && (raw as Record<string, unknown>).customTitle) {
          const sessionId = (raw as Record<string, unknown>).sessionId as string;
          const customTitle = (raw as Record<string, unknown>).customTitle as string;
          if (sessionId && customTitle) {
            sessionNames.set(sessionId, customTitle);
          }
        }

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
      sessionNames,
      newOffset: stat.size,
    };
  } catch (err) {
    // Log file access errors; may indicate permission/disk issues
    console.error(`[jsonl-parser] Error reading ${filePath}:`, err instanceof Error ? err.message : String(err));
    return { entries: [], sessionNames: new Map(), newOffset: fromOffset };
  }
}

/**
 * Normalize raw JSONL entry to our schema.
 * Filter to cost-bearing assistant messages with token usage OR subagent results in toolUseResult.
 */
function normalizeEntry(raw: unknown): JsonlEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;

  const obj = raw as Record<string, unknown>;

  // Try to extract from message.usage (assistant entries)
  const message = obj.message as Record<string, unknown> | undefined;
  let usage = message?.usage as Record<string, unknown> | undefined;

  // Fall back to toolUseResult.usage (user entries with subagent results)
  if (!usage) {
    const toolUseResult = obj.toolUseResult as Record<string, unknown> | undefined;
    usage = toolUseResult?.usage as Record<string, unknown> | undefined;
  }

  // Only process entries with token usage
  if (!usage || typeof usage !== 'object') return null;

  const inputTokens = usage.input_tokens as number | undefined;
  const outputTokens = usage.output_tokens as number | undefined;

  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
    return null;
  }

  // Must be either assistant or a user entry with agentId
  if (obj.type !== 'assistant' && obj.type !== 'user') return null;

  // Extract agentType from toolUseResult, top-level, or tool_use blocks
  let agentType: string | undefined;

  const toolUseResult = obj.toolUseResult as Record<string, unknown> | undefined;
  if (toolUseResult && typeof toolUseResult === 'object') {
    agentType = toolUseResult.agentType as string | undefined;
  }

  if (!agentType) {
    agentType = obj.agentType as string | undefined;
  }

  if (!agentType && message) {
    const content = message.content as Record<string, unknown>[] | undefined;
    if (content && Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === 'object' && block !== null) {
          const blockObj = block as Record<string, unknown>;
          // Check for Agent or Task tool invocations
          if ((blockObj.type === 'tool_use') && (blockObj.name === 'Agent' || blockObj.name === 'Task')) {
            const input = blockObj.input as Record<string, unknown> | undefined;
            if (input && typeof input === 'object') {
              const extractedType = input.subagent_type as string | undefined;
              if (extractedType) {
                agentType = extractedType;
                break; // Use the first subagent_type found
              }
            }
          }
        }
      }
    }
  }

  // For entries with message (assistant), get message.id and model
  const messageId = message?.id ?? (obj.promptId as string) ?? 'unknown';
  const model = (message?.model as string) ?? 'unknown';

  // Extract session name from customTitle if present
  const sessionName = obj.customTitle as string | undefined;

  return {
    sessionId: obj.sessionId as string,
    timestamp: obj.timestamp as string,
    type: 'assistant',
    costUSD: (obj.costUSD as number) ?? 0,
    agentId: obj.agentId ?? (obj.toolUseResult as Record<string, unknown>)?.agentId as string | undefined,
    agentType,
    sessionName,
    message: {
      id: messageId as string,
      model,
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
