import { describe, it, expect } from 'vitest';
import { attrValue, attrStr, attrNum } from '../src/attributes.js';
import type { OtelAttribute } from '../src/types.js';

const strAttr = (key: string, val: string): OtelAttribute =>
  ({ key, value: { stringValue: val } });
const intAttr = (key: string, val: number): OtelAttribute =>
  ({ key, value: { intValue: val } });
const dblAttr = (key: string, val: number): OtelAttribute =>
  ({ key, value: { doubleValue: val } });

describe('attrValue', () => {
  it('returns intValue when present', () => {
    expect(attrValue(intAttr('k', 42))).toBe(42);
  });
  it('returns doubleValue when present', () => {
    expect(attrValue(dblAttr('k', 3.14))).toBeCloseTo(3.14);
  });
  it('returns stringValue when no number', () => {
    expect(attrValue(strAttr('k', 'hello'))).toBe('hello');
  });
  it('returns empty string for empty value', () => {
    expect(attrValue({ key: 'k', value: {} })).toBe('');
  });
});

describe('attrStr', () => {
  it('finds value by key', () => {
    expect(attrStr([strAttr('model', 'claude-sonnet-4-6')], 'model')).toBe('claude-sonnet-4-6');
  });
  it('returns empty string for missing key', () => {
    expect(attrStr([], 'missing')).toBe('');
  });
  it('converts intValue to string', () => {
    expect(attrStr([intAttr('seq', 5)], 'seq')).toBe('5');
  });
});

describe('attrNum', () => {
  it('returns intValue directly', () => {
    expect(attrNum([intAttr('event.sequence', 39)], 'event.sequence')).toBe(39);
  });
  it('parses stringValue as float', () => {
    expect(attrNum([strAttr('cost_usd', '0.01267155')], 'cost_usd')).toBeCloseTo(0.01267155);
  });
  it('parses stringValue integer string', () => {
    expect(attrNum([strAttr('duration_ms', '2446')], 'duration_ms')).toBe(2446);
  });
  it('returns 0 for missing key', () => {
    expect(attrNum([], 'missing')).toBe(0);
  });
  it('returns 0 for non-numeric string', () => {
    expect(attrNum([strAttr('x', 'not-a-number')], 'x')).toBe(0);
  });
});
