import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLabels } from './labels.mjs';

test('normalizes whitespace and case while preserving first-seen order', () => {
  assert.deepEqual(normalizeLabels([' Red ', 'BLUE', 'red', '', ' blue ', 'Green']), ['red', 'blue', 'green']);
});
test('omits empty labels without inventing a label', () => {
  assert.deepEqual(normalizeLabels([' ', '', '\t']), []);
  assert.deepEqual(normalizeLabels([]), []);
});
test('rejects non-string values with the defined error', () => {
  assert.throws(() => normalizeLabels(['red', null]), { name: 'TypeError', message: 'Labels must be strings' });
});
test('preserves the caller input', () => {
  const input = Object.freeze([' A ', 'a']);
  normalizeLabels(input);
  assert.deepEqual(input, [' A ', 'a']);
});
