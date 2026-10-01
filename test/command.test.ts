import assert from 'node:assert/strict';
import test from 'node:test';
import { captureCommand } from '../src/command.ts';
import { fixture } from './support.ts';

test('file-backed capture preserves actual nested process output inside the sandbox', context => {
  const project = fixture(context);
  assert.equal(captureCommand([process.execPath, '-e', 'console.log("observable output")'], project), 'observable output\n');
  assert.match(captureCommand(['git', 'status', '--short', '--branch'], project), /^## /);
});

test('capture keeps nonzero status, stderr and actual spawn errors as failures', context => {
  const project = fixture(context);
  assert.throws(() => captureCommand([process.execPath, '-e', 'console.error("specific defect"); process.exit(7)'], project), /exit 7\nspecific defect/);
  assert.throws(() => captureCommand(['oso-code-codex-missing-binary'], project), /ENOENT/);
});
