import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import type { OtelLogsPayload } from '../../src/types.js';
import { parseLogsPayload } from '../../src/parser/logs.js';

// repo root is two directories above hub/
// import.meta.url = hub/tests/parser/logs.test.ts
// resolve(file, '../../../..') = repo root (4 levels up from the file path)
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');
const SAMPLE = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'logs/payload_020218_841952_v1_logs.json'), 'utf8')
) as OtelLogsPayload;

describe('parseLogsPayload', () => {
  it('extracts one session', () => {
    const result = parseLogsPayload(SAMPLE, 'test-machine');
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].id).toBe('bf9aefc7-1d4c-4385-b5df-bd161e0c1ded');
    expect(result.sessions[0].machineId).toBe('test-machine');
    expect(result.sessions[0].model).toBe('claude-sonnet-4-6');
  });

  it('extracts the api_request event', () => {
    const { apiRequests } = parseLogsPayload(SAMPLE, 'test-machine');
    expect(apiRequests).toHaveLength(1);
    const req = apiRequests[0];
    expect(req.model).toBe('claude-sonnet-4-6');
    expect(req.costUsd).toBeCloseTo(0.01267155);
    expect(req.inputTokens).toBe(1);
    expect(req.outputTokens).toBe(137);
    expect(req.cacheReadTokens).toBe(28591);
    expect(req.cacheCreationTokens).toBe(543);
    expect(req.durationMs).toBe(2446);
    expect(req.isFastMode).toBe(0); // speed = "normal"
    expect(req.eventSequence).toBe(39);
    expect(req.sessionId).toBe('bf9aefc7-1d4c-4385-b5df-bd161e0c1ded');
  });

  it('extracts the tool_result event (not tool_decision)', () => {
    const { toolEvents } = parseLogsPayload(SAMPLE, 'test-machine');
    expect(toolEvents).toHaveLength(1); // tool_decision is not stored separately
    const evt = toolEvents[0];
    expect(evt.toolName).toBe('Bash');
    expect(evt.success).toBe(1);
    expect(evt.durationMs).toBe(3150);
    expect(evt.eventSequence).toBe(41);
    expect(evt.skillName).toBeNull();
  });

  it('assigns machineId from parameter', () => {
    const { toolEvents } = parseLogsPayload(SAMPLE, 'my-mac');
    expect(toolEvents[0].machineId).toBe('my-mac');
  });

  it('handles empty payload without throwing', () => {
    const result = parseLogsPayload({ resourceLogs: [] }, 'test');
    expect(result.sessions).toHaveLength(0);
    expect(result.apiRequests).toHaveLength(0);
    expect(result.toolEvents).toHaveLength(0);
  });
});
