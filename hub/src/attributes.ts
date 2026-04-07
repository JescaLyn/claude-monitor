import type { OtelAttribute, OtelAttrValue } from './types.js';

export function attrValue(attr: OtelAttribute): string | number | boolean {
  const v: OtelAttrValue = attr.value;
  if (v.intValue !== undefined) return v.intValue;
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.boolValue !== undefined) return v.boolValue;
  return v.stringValue ?? '';
}

export function attrStr(attrs: OtelAttribute[], key: string): string {
  const attr = attrs.find(a => a.key === key);
  if (!attr) return '';
  return String(attrValue(attr));
}

export function attrNum(attrs: OtelAttribute[], key: string): number {
  const attr = attrs.find(a => a.key === key);
  if (!attr) return 0;
  const v = attrValue(attr);
  if (typeof v === 'number') return v;
  const parsed = parseFloat(String(v));
  return isNaN(parsed) ? 0 : parsed;
}

export function extractAttrs(attrs: OtelAttribute[]): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const attr of attrs) result[attr.key] = attrValue(attr);
  return result;
}
