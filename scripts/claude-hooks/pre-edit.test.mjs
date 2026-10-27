// Runs pre-edit.mjs over sample events: the agent folder scopes in the main checkout and in a worktree.
// Usage: node --test scripts/claude-hooks/pre-edit.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('./pre-edit.mjs', import.meta.url));
const ROOT = '/repo';
const WORKTREE = `${ROOT}/.claude/worktrees/cool-name`;

const run = (agent, file) =>
  spawnSync('node', [HOOK], {
    // The file doesn't exist, so the copyright check has nothing to compare with.
    input: JSON.stringify({
      tool_name: 'Write',
      agent_type: agent,
      tool_input: { file_path: file, content: 'x' },
    }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
    encoding: 'utf8',
  });

const KOTLIN = 'android/src/main/java/dev/apexnative/keychain/Keychain.kt';

const cases = [
  // [agent, file, allowed]
  ['ios-dev', `${ROOT}/ios/ANKKeychainStore.mm`, true],
  ['ios-dev', `${ROOT}/${KOTLIN}`, false],
  ['ios-dev', `${WORKTREE}/ios/ANKKeychainStore.mm`, true],
  ['ios-dev', `${WORKTREE}/ios/Tests/ANKKeychainStoreTests.mm`, true],
  ['ios-dev', `${WORKTREE}/example/ios/KeychainExample/AppDelegate.swift`, true],
  ['ios-dev', `${WORKTREE}/${KOTLIN}`, false],
  ['ios-dev', `${WORKTREE}/src/index.ts`, false],
  ['android-dev', `${WORKTREE}/${KOTLIN}`, true],
  ['android-dev', `${WORKTREE}/example/android/app/build.gradle`, true],
  ['android-dev', `${WORKTREE}/ios/ANKKeychainStore.mm`, false],
  ['android-dev', `${WORKTREE}/src/errors.ts`, false],
  ['docs-writer', `${WORKTREE}/docs/content/fundamentals/protection.mdx`, true],
  ['docs-writer', `${WORKTREE}/README.md`, true],
  ['docs-writer', `${WORKTREE}/.claude/agents/ios-dev.md`, false],
  ['docs-writer', `${WORKTREE}/.tasks/task.md`, false],
  ['docs-writer', `${WORKTREE}/src/index.ts`, false],
  ['reviewer', `${WORKTREE}/ios/ANKKeychainStore.mm`, false],
  ['qa', `${WORKTREE}/example/src/scenarios.ts`, false],
  [undefined, `${WORKTREE}/src/index.ts`, true],
  [undefined, `${ROOT}/src/index.ts`, true],
];

for (const [agent, file, allowed] of cases) {
  test(`${agent ?? 'main session'} ${allowed ? 'may' : "can't"} change ${file.replace(ROOT, '')}`, () => {
    assert.equal(run(agent, file).status, allowed ? 0 : 2);
  });
}
