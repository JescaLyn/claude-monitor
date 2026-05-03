import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseFile } from '../../src/jsonl/parser.js';

function makeTempFile(lines: object[]): { filePath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'jsonl-test-'));
  const filePath = join(dir, 'session.jsonl');
  writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
  return { filePath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const BASE_ASSISTANT = {
  type: 'assistant',
  sessionId: 'sess-1',
  timestamp: '2026-01-01T00:00:00Z',
  costUSD: 0.01,
  message: {
    id: 'msg-1',
    model: 'claude-sonnet-4-6',
    usage: { input_tokens: 100, output_tokens: 50 },
  },
};

describe('parseFile', () => {
  describe('agentType extraction', () => {
    it('extracts agentType from toolUseResult on a user entry', () => {
      const line = {
        type: 'user',
        sessionId: 'sess-1',
        timestamp: '2026-01-01T00:00:00Z',
        costUSD: 0.01,
        toolUseResult: {
          agentType: 'Explore',
          agentId: 'sub-1',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      };
      const { filePath, cleanup } = makeTempFile([line]);
      try {
        const { entries } = parseFile(filePath, 0);
        expect(entries).toHaveLength(1);
        expect(entries[0].agentType).toBe('Explore');
      } finally {
        cleanup();
      }
    });

    it('extracts agentType from top-level obj.agentType', () => {
      const line = {
        ...BASE_ASSISTANT,
        agentType: 'code-reviewer',
      };
      const { filePath, cleanup } = makeTempFile([line]);
      try {
        const { entries } = parseFile(filePath, 0);
        expect(entries).toHaveLength(1);
        expect(entries[0].agentType).toBe('code-reviewer');
      } finally {
        cleanup();
      }
    });

    it('extracts agentType from message.content Agent tool_use block', () => {
      const line = {
        ...BASE_ASSISTANT,
        message: {
          ...BASE_ASSISTANT.message,
          id: 'msg-2',
          content: [
            {
              type: 'tool_use',
              name: 'Agent',
              input: { subagent_type: 'general-purpose' },
            },
          ],
        },
      };
      const { filePath, cleanup } = makeTempFile([line]);
      try {
        const { entries } = parseFile(filePath, 0);
        expect(entries).toHaveLength(1);
        expect(entries[0].agentType).toBe('general-purpose');
      } finally {
        cleanup();
      }
    });

    it('extracts agentType from message.content Task tool_use block', () => {
      const line = {
        ...BASE_ASSISTANT,
        message: {
          ...BASE_ASSISTANT.message,
          id: 'msg-3',
          content: [
            {
              type: 'tool_use',
              name: 'Task',
              input: { subagent_type: 'analyst' },
            },
          ],
        },
      };
      const { filePath, cleanup } = makeTempFile([line]);
      try {
        const { entries } = parseFile(filePath, 0);
        expect(entries).toHaveLength(1);
        expect(entries[0].agentType).toBe('analyst');
      } finally {
        cleanup();
      }
    });

    it('prefers toolUseResult.agentType over top-level agentType', () => {
      const line = {
        type: 'user',
        sessionId: 'sess-1',
        timestamp: '2026-01-01T00:00:00Z',
        costUSD: 0.01,
        agentType: 'top-level-type',
        toolUseResult: {
          agentType: 'tool-result-type',
          agentId: 'sub-1',
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      };
      const { filePath, cleanup } = makeTempFile([line]);
      try {
        const { entries } = parseFile(filePath, 0);
        expect(entries).toHaveLength(1);
        expect(entries[0].agentType).toBe('tool-result-type');
      } finally {
        cleanup();
      }
    });
  });

  describe('sessionName extraction', () => {
    it('extracts sessionName from obj.customTitle on an entry', () => {
      const line = {
        ...BASE_ASSISTANT,
        customTitle: 'my session',
      };
      const { filePath, cleanup } = makeTempFile([line]);
      try {
        const { entries } = parseFile(filePath, 0);
        expect(entries).toHaveLength(1);
        expect(entries[0].sessionName).toBe('my session');
      } finally {
        cleanup();
      }
    });

    it('leaves sessionName undefined when customTitle is absent', () => {
      const { filePath, cleanup } = makeTempFile([BASE_ASSISTANT]);
      try {
        const { entries } = parseFile(filePath, 0);
        expect(entries).toHaveLength(1);
        expect(entries[0].sessionName).toBeUndefined();
      } finally {
        cleanup();
      }
    });
  });

  describe('custom-title lines', () => {
    it('populates sessionNames from custom-title lines', () => {
      const titleLine = {
        type: 'custom-title',
        sessionId: 'sess-1',
        customTitle: 'My Session',
      };
      const { filePath, cleanup } = makeTempFile([titleLine]);
      try {
        const { sessionNames, entries } = parseFile(filePath, 0);
        expect(sessionNames.get('sess-1')).toBe('My Session');
        expect(entries).toHaveLength(0);
      } finally {
        cleanup();
      }
    });

    it('does not produce a JsonlEntry for custom-title lines', () => {
      const titleLine = {
        type: 'custom-title',
        sessionId: 'sess-2',
        customTitle: 'Another Session',
      };
      const { filePath, cleanup } = makeTempFile([titleLine, BASE_ASSISTANT]);
      try {
        const { sessionNames, entries } = parseFile(filePath, 0);
        expect(sessionNames.get('sess-2')).toBe('Another Session');
        // Only the BASE_ASSISTANT entry should appear
        expect(entries).toHaveLength(1);
        expect(entries[0].sessionId).toBe('sess-1');
      } finally {
        cleanup();
      }
    });
  });

  describe('entries without usage', () => {
    it('returns empty entries when no lines have usage data', () => {
      const noUsageLine = {
        type: 'assistant',
        sessionId: 'sess-1',
        timestamp: '2026-01-01T00:00:00Z',
        costUSD: 0,
        message: { id: 'msg-x', model: 'claude-sonnet-4-6' },
      };
      const titleLine = {
        type: 'custom-title',
        sessionId: 'sess-1',
        customTitle: 'No Usage Session',
      };
      const { filePath, cleanup } = makeTempFile([noUsageLine, titleLine]);
      try {
        const { entries, sessionNames } = parseFile(filePath, 0);
        expect(entries).toHaveLength(0);
        expect(sessionNames.get('sess-1')).toBe('No Usage Session');
      } finally {
        cleanup();
      }
    });
  });

  describe('fromOffset handling', () => {
    it('returns empty entries and empty sessionNames when file has not grown', () => {
      const { filePath, cleanup } = makeTempFile([BASE_ASSISTANT]);
      try {
        // Parse once to get the real file size
        const first = parseFile(filePath, 0);
        const fileSize = first.newOffset;

        // Parse again from the end — file hasn't grown
        const second = parseFile(filePath, fileSize);
        expect(second.entries).toHaveLength(0);
        expect(second.sessionNames).toEqual(new Map());
      } finally {
        cleanup();
      }
    });

    it('only parses new bytes when fromOffset is mid-file', () => {
      const line1 = { ...BASE_ASSISTANT, message: { ...BASE_ASSISTANT.message, id: 'msg-a' } };
      const line2 = { ...BASE_ASSISTANT, message: { ...BASE_ASSISTANT.message, id: 'msg-b' } };
      const { filePath, cleanup } = makeTempFile([line1, line2]);
      try {
        const first = parseFile(filePath, 0);
        // Both entries present on full parse
        expect(first.entries).toHaveLength(2);

        // Parsing from end returns nothing new
        const second = parseFile(filePath, first.newOffset);
        expect(second.entries).toHaveLength(0);
      } finally {
        cleanup();
      }
    });
  });
});
