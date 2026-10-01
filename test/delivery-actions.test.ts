import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { hookDecision } from '../src/hooks.ts';
import { approved, fixture } from './support.ts';

function decide(project: string, tool_name: string, command?: string): { allow: boolean; reason?: string } {
  return hookDecision({ cwd: project, hook_event_name: 'PreToolUse', tool_name, tool_input: command ? { command } : undefined });
}

test('delivery hook distinguishes Git history mutations from quoted data and read-only replace commands', context => {
  const project = fixture(context);
  approved(project);
  for (const command of ['git filter-branch -- --all', 'git -C . replace deadbeef feedface', 'git replace --delete deadbeef', 'bash -lc "git replace deadbeef feedface"']) assert.equal(decide(project, 'Bash', command).allow, false, command);
  for (const command of ['git replace --list', 'git replace --help', 'printf "%s\\n" "git filter-branch -- --all"', "cat <<'EOF'\ngit replace deadbeef feedface\nEOF"]) assert.equal(decide(project, 'exec_command', command).allow, true, command);
});

test('delivery hook guards literal MCP publication actions and permits read-only release and deployment actions', context => {
  const project = fixture(context);
  approved(project);
  for (const tool of ['mcp__github__create_release', 'mcp__github__release', 'mcp__registry__publish', 'mcp__hosting__deploy', 'mcp__hosting__create_deployment']) assert.equal(decide(project, tool).allow, false, tool);
  for (const tool of ['mcp__github__get_release', 'mcp__github__list_releases', 'mcp__hosting__read_deployment', 'mcp__hosting__fetch_deployments', 'mcp__hosting__search_deployments', 'mcp__hosting__preview_deployment', 'mcp__hosting__prepare_deployment', 'mcp__hosting__status_deployment', 'mcp__github__release_notes', 'mcp__github__unknown_release_thing']) assert.equal(decide(project, tool).allow, true, tool);
});

test('delivery hook manifest includes shell surfaces and relevant MCP action names', () => {
  const manifest = JSON.parse(readFileSync(path.resolve('hooks/hooks.json'), 'utf8')) as { hooks: { PreToolUse: { matcher: string }[] } };
  const matcher = new RegExp(`^(?:${manifest.hooks.PreToolUse[0]!.matcher})$`);
  for (const tool of ['Bash', 'exec_command', 'functions.exec_command', 'mcp__github__create_release', 'mcp__hosting__get_deployments']) assert.equal(matcher.test(tool), true, tool);
  assert.equal(matcher.test('mcp__github__release_notes'), true);
});
