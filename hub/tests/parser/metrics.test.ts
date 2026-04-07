import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import type { OtelMetricsPayload } from '../../src/types.js';
import { parseMetricsPayload } from '../../src/parser/metrics.js';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');
const SAMPLE = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'docs/reference/real-payload-metrics-sample.json'), 'utf8')
) as OtelMetricsPayload;

describe('parseMetricsPayload', () => {
  it('returns one snapshot per data point', () => {
    const snapshots = parseMetricsPayload(SAMPLE, 'test-machine');
    // Sample has: lines_of_code(2 points) + cost(1) + token(4) + code_edit_tool(1) + active_time(1) = 9
    expect(snapshots).toHaveLength(9);
  });

  it('sets sessionId on all snapshots', () => {
    const snapshots = parseMetricsPayload(SAMPLE, 'test-machine');
    for (const s of snapshots) {
      expect(s.sessionId).toBe('bf9aefc7-1d4c-4385-b5df-bd161e0c1ded');
    }
  });

  it('parses claude_code.cost.usage snapshot', () => {
    const snapshots = parseMetricsPayload(SAMPLE, 'test-machine');
    const costSnap = snapshots.find(s => s.metricName === 'claude_code.cost.usage');
    expect(costSnap).toBeDefined();
    expect(costSnap!.value).toBeCloseTo(0.07230255);
    expect(costSnap!.machineId).toBe('test-machine');
  });

  it('parses claude_code.token.usage with type dimensions', () => {
    const snapshots = parseMetricsPayload(SAMPLE, 'test-machine');
    const tokenSnaps = snapshots.filter(s => s.metricName === 'claude_code.token.usage');
    expect(tokenSnaps).toHaveLength(4); // input, output, cacheRead, cacheCreation
    const cacheRead = tokenSnaps.find(s => s.dimensionKey.includes('cacheRead'));
    expect(cacheRead!.value).toBe(116931);
  });

  it('excludes user identity fields from dimensionKey', () => {
    const snapshots = parseMetricsPayload(SAMPLE, 'test-machine');
    for (const s of snapshots) {
      expect(s.dimensionKey).not.toContain('user.email');
      expect(s.dimensionKey).not.toContain('user.id');
      expect(s.dimensionKey).not.toContain('session.id');
    }
  });

  it('handles empty payload', () => {
    const snapshots = parseMetricsPayload({ resourceMetrics: [] }, 'test');
    expect(snapshots).toHaveLength(0);
  });
});
