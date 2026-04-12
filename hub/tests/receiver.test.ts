import { describe, it, expect } from 'vitest';
import { resolveMachineId } from '../src/receiver.js';

describe('resolveMachineId', () => {
  it('prefers host.name from OTEL resource attributes over the header', () => {
    const payload = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'claude-code' } },
              { key: 'host.name', value: { stringValue: 'my-mac' } },
            ],
          },
        },
      ],
    };
    expect(resolveMachineId(payload as any, 'header-id')).toBe('my-mac');
  });

  it('falls back to x-machine-id header when host.name is absent', () => {
    const payload = {
      resourceLogs: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'x' } }] } }],
    };
    expect(resolveMachineId(payload as any, 'satellite-forwarded')).toBe('satellite-forwarded');
  });

  it("falls back to 'local' when neither host.name nor header is present", () => {
    expect(resolveMachineId({ resourceLogs: [] } as any, undefined)).toBe('local');
  });

  it('resolves host.name from resourceMetrics payloads too', () => {
    const payload = {
      resourceMetrics: [
        { resource: { attributes: [{ key: 'host.name', value: { stringValue: 'my-win' } }] } },
      ],
    };
    expect(resolveMachineId(payload as any, undefined)).toBe('my-win');
  });
});
