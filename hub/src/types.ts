// OTel attribute value container — one of these fields will be set
export interface OtelAttrValue {
  stringValue?: string;
  intValue?: number;
  doubleValue?: number;
  boolValue?: boolean;
}

export interface OtelAttribute {
  key: string;
  value: OtelAttrValue;
}

// --- Log payload types ---

export interface OtelLogRecord {
  timeUnixNano: string;
  observedTimeUnixNano: string;
  body: { stringValue: string };
  attributes: OtelAttribute[];
  droppedAttributesCount: number;
}

export interface OtelScopeLogs {
  scope: { name: string; version: string };
  logRecords: OtelLogRecord[];
}

export interface OtelResourceLogs {
  resource: { attributes: OtelAttribute[]; droppedAttributesCount: number };
  scopeLogs: OtelScopeLogs[];
}

export interface OtelLogsPayload {
  resourceLogs: OtelResourceLogs[];
}

// --- Metrics payload types ---

export interface OtelDataPoint {
  attributes: OtelAttribute[];
  startTimeUnixNano: string;
  timeUnixNano: string;
  asDouble: number;
}

export interface OtelMetricSum {
  aggregationTemporality: number; // 1 = CUMULATIVE
  isMonotonic: boolean;
  dataPoints: OtelDataPoint[];
}

export interface OtelMetric {
  name: string;
  description: string;
  unit: string;
  sum: OtelMetricSum;
}

export interface OtelScopeMetrics {
  scope: { name: string; version: string };
  metrics: OtelMetric[];
}

export interface OtelResourceMetrics {
  resource: { attributes: OtelAttribute[]; droppedAttributesCount: number };
  scopeMetrics: OtelScopeMetrics[];
}

export interface OtelMetricsPayload {
  resourceMetrics: OtelResourceMetrics[];
}

// --- Normalized types (what we store in SQLite) ---

export interface NormalizedSession {
  id: string;
  machineId: string;
  model: string | null;
  startedAt: number; // microseconds since epoch
}

export interface NormalizedApiRequest {
  sessionId: string;
  ts: number;           // microseconds
  promptId: string;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  durationMs: number;
  isFastMode: number;   // 0 or 1
  eventSequence: number;
}

export interface NormalizedToolEvent {
  sessionId: string;
  ts: number;
  promptId: string;
  toolName: string;
  skillName: string | null;
  durationMs: number | null;
  success: number | null; // 1, 0, or null if unknown
  machineId: string;
  eventSequence: number;
}

export interface ParsedLogPayload {
  sessions: NormalizedSession[];
  apiRequests: NormalizedApiRequest[];
  toolEvents: NormalizedToolEvent[];
}

export interface NormalizedMetricSnapshot {
  sessionId: string;
  metricName: string;
  dimensionKey: string; // JSON-stringified dimension attributes
  value: number;
  timeUnixNano: string;
  machineId: string;
}
