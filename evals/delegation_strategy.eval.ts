/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe } from 'vitest';
import { evalTest } from './test-helper.js';

describe('Delegation Strategy Evals', () => {
  /**
   * Scenario 1: Multi-file / Architectural task.
   * Expectation: Use codebase_investigator to build a mental model.
   */
  evalTest('USUALLY_PASSES', {
    name: 'should delegate to codebase_investigator for architectural mapping',
    params: {
      settings: {
        experimental: {
          enableAgents: true,
        },
      },
    },
    prompt: 'How does the telemetry system interact with the hook system?',
    files: {
      'packages/core/src/telemetry/telemetryService.ts':
        'export class TelemetryService {}',
      'packages/core/src/hooks/hookManager.ts': 'export class HookManager {}',
      'packages/core/src/index.ts':
        'import "./telemetry/telemetryService"; import "./hooks/hookManager";',
    },
    assert: async (rig, _result) => {
      await rig.expectToolCallSuccess(
        ['delegate_to_agent'],
        undefined,
        (args) => {
          try {
            const parsed = JSON.parse(args);
            return parsed.agent_name === 'codebase_investigator';
          } catch {
            return false;
          }
        },
      );
    },
  });

  /**
   * Scenario 2: Highly localized / Trivial task.
   * Expectation: Use manual search tools (grep) or direct read because it's surgical and fast.
   */
  evalTest('USUALLY_PASSES', {
    name: 'should use manual tools for localized surgical tasks',
    params: {
      settings: {
        experimental: {
          enableAgents: true,
        },
      },
    },
    prompt:
      'Change the default port in packages/core/src/config.ts from 3000 to 8080.',
    files: {
      'packages/core/src/config.ts': 'export const DEFAULT_PORT = 3000;',
    },
    assert: async (rig, _result) => {
      // We expect it NOT to delegate, and instead use manual tools or edit.
      await rig.expectNoToolCall(['delegate_to_agent']);
      await rig.expectToolCallSuccess([
        'search_file_content',
        'read_file',
        'replace',
      ]);
    },
  });
});
