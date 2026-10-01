import assert from 'node:assert/strict';
import { captureCommand } from '../src/command.ts';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fixture } from './support.ts';

const installer = path.resolve('scripts/install.py');

test('install, update and removal preserve unowned configuration and marketplace entries', context => {
  const target = fixture(context);
  const config = path.join(target, '.codex/config.toml');
  const marketplace = path.join(target, '.agents/plugins/marketplace.json');
  mkdirSync(path.dirname(config), { recursive: true });
  mkdirSync(path.dirname(marketplace), { recursive: true });
  const settings = 'model = "user-selected"\nbase_instructions = "User instructions"\n';
  const other = { name: 'another-plugin', source: { source: 'local', path: './another' } };
  writeFileSync(config, settings);
  writeFileSync(marketplace, JSON.stringify({ name: 'personal', plugins: [other] }));
  captureCommand(['python3', installer, 'install', '--stage-only', '--target', target], process.cwd());
  assert.equal(readFileSync(config, 'utf8'), settings);
  assert.deepEqual(JSON.parse(readFileSync(marketplace, 'utf8')).plugins[0], other);
  assert.equal(JSON.parse(readFileSync(marketplace, 'utf8')).plugins.length, 2);
  captureCommand(['python3', installer, 'install', '--stage-only', '--target', target], process.cwd());
  assert.equal(JSON.parse(readFileSync(marketplace, 'utf8')).plugins.length, 2);
  captureCommand(['python3', installer, 'remove', '--stage-only', '--target', target], process.cwd());
  assert.equal(readFileSync(config, 'utf8'), settings);
  assert.deepEqual(JSON.parse(readFileSync(marketplace, 'utf8')).plugins, [other]);
  assert.equal(existsSync(path.join(target, '.local/bin/oso-codex')), false);
});

test('modified owned files survive an attempted update or removal', context => {
  const target = fixture(context);
  captureCommand(['python3', installer, 'install', '--stage-only', '--target', target], process.cwd());
  const role = path.join(target, '.codex/agents/oso-code-codex-verifier.toml');
  writeFileSync(role, 'User customization');
  for (const action of ['install', 'remove']) assert.throws(() => captureCommand(['python3', installer, action, '--stage-only', '--target', target], process.cwd()), /preserved/);
  assert.equal(readFileSync(role, 'utf8'), 'User customization');
});

test('a partially applied installation resumes and removal preserves a deleted marketplace', context => {
  const target = fixture(context);
  const install = ['python3', installer, 'install', '--stage-only', '--target', target];
  captureCommand(install, process.cwd());
  const receiptPath = path.join(target, '.local/state/oso-code-codex-install/receipt.json');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const filenames = Object.keys(receipt.files);
  receipt.pendingFiles = receipt.files;
  receipt.files = {};
  receipt.phase = 'installing';
  writeFileSync(receiptPath, JSON.stringify(receipt));
  unlinkSync(filenames[0]!);
  captureCommand(install, process.cwd());
  assert.equal(existsSync(filenames[0]!), true);
  assert.equal(JSON.parse(readFileSync(receiptPath, 'utf8')).pendingFiles, undefined);
  const marketplace = path.join(target, '.agents/plugins/marketplace.json');
  unlinkSync(marketplace);
  captureCommand(['python3', installer, 'remove', '--stage-only', '--target', target], process.cwd());
  assert.equal(existsSync(marketplace), false);
});

test('native activation rejects a test target before writing payload files', context => {
  const target = fixture(context);
  assert.throws(() => captureCommand(['python3', installer, 'install', '--target', target], process.cwd()), /real user directory/);
  assert.equal(existsSync(path.join(target, 'plugins')), false);
});
