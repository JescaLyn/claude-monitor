import type { OtelMetricsPayload, NormalizedMetricSnapshot, OtelAttribute } from '../types.js';
import { attrStr } from '../attributes.js';

// Fields that identify the user/session, not the metric dimensions
const IDENTITY_KEYS = new Set([
  'user.id', 'user.email', 'user.account_uuid', 'user.account_id',
  'organization.id', 'session.id', 'terminal.type',
]);

function dimensionKey(attrs: OtelAttribute[]): string {
  const dims = attrs
    .filter(a => !IDENTITY_KEYS.has(a.key))
    .sort((a, b) => a.key.localeCompare(b.key));
  const obj: Record<string, string> = {};
  for (const a of dims) {
    obj[a.key] = String(a.value.stringValue ?? a.value.intValue ?? a.value.doubleValue ?? '');
  }
  return JSON.stringify(obj);
}

export function parseMetricsPayload(
  payload: OtelMetricsPayload,
  machineId: string
): NormalizedMetricSnapshot[] {
  const snapshots: NormalizedMetricSnapshot[] = [];

  for (const rm of payload.resourceMetrics ?? []) {
    for (const sm of rm.scopeMetrics ?? []) {
      for (const metric of sm.metrics ?? []) {
        for (const dp of metric.sum?.dataPoints ?? []) {
          const sessionId = attrStr(dp.attributes, 'session.id');
          if (!sessionId) continue;

          snapshots.push({
            sessionId,
            metricName: metric.name,
            dimensionKey: dimensionKey(dp.attributes),
            value: dp.asDouble,
            timeUnixNano: dp.timeUnixNano,
            machineId,
          });
        }
      }
    }
  }

  return snapshots;
}
