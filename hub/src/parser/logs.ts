import type { OtelLogsPayload, ParsedLogPayload, NormalizedSession,
  NormalizedApiRequest, NormalizedToolEvent } from '../types.js';
import { attrStr, attrNum } from '../attributes.js';

function nanoToMicro(nano: string): number {
  // nanoseconds → microseconds; BigInt handles the large value safely
  return Number(BigInt(nano) / 1000n);
}

export function parseLogsPayload(payload: OtelLogsPayload, machineId: string): ParsedLogPayload {
  const sessionsMap = new Map<string, NormalizedSession>();
  const apiRequests: NormalizedApiRequest[] = [];
  const toolEvents: NormalizedToolEvent[] = [];

  for (const rl of payload.resourceLogs ?? []) {
    for (const sl of rl.scopeLogs ?? []) {
      for (const record of sl.logRecords ?? []) {
        const attrs = record.attributes;
        const sessionId = attrStr(attrs, 'session.id');
        if (!sessionId) continue;

        const eventName = attrStr(attrs, 'event.name');
        const promptId = attrStr(attrs, 'prompt.id');
        const sequence = attrNum(attrs, 'event.sequence');
        const ts = nanoToMicro(record.timeUnixNano);

        // Ensure session record exists
        if (!sessionsMap.has(sessionId)) {
          sessionsMap.set(sessionId, { id: sessionId, machineId, model: null, startedAt: ts });
        }
        const session = sessionsMap.get(sessionId)!;
        if (ts < session.startedAt) session.startedAt = ts;

        if (eventName === 'api_request') {
          const model = attrStr(attrs, 'model');
          if (!session.model) session.model = model;

          apiRequests.push({
            sessionId, ts, promptId, model,
            costUsd: attrNum(attrs, 'cost_usd'),
            inputTokens: attrNum(attrs, 'input_tokens'),
            outputTokens: attrNum(attrs, 'output_tokens'),
            cacheReadTokens: attrNum(attrs, 'cache_read_tokens'),
            cacheCreationTokens: attrNum(attrs, 'cache_creation_tokens'),
            durationMs: attrNum(attrs, 'duration_ms'),
            isFastMode: attrStr(attrs, 'speed') === 'fast' ? 1 : 0,
            eventSequence: sequence,
          });

        } else if (eventName === 'tool_result') {
          const successStr = attrStr(attrs, 'success');
          const skillName = attrStr(attrs, 'skill_name') || null;
          const durationMs = attrNum(attrs, 'duration_ms') || null;
          const success = successStr === 'true' ? 1 : successStr === 'false' ? 0 : null;

          toolEvents.push({
            sessionId, ts, promptId,
            toolName: attrStr(attrs, 'tool_name'),
            skillName, durationMs, success, machineId,
            eventSequence: sequence,
          });
        }
        // tool_decision and user_prompt: captured via log but not stored separately
      }
    }
  }

  return { sessions: Array.from(sessionsMap.values()), apiRequests, toolEvents };
}
