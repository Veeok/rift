import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = process.env.READER_TEST_ROOT || resolve(here, '..');
const template = process.env.READER_TEMPLATE || resolve(root, 'luau/bootstrap.template.luau');
const lune = process.env.LUNE_PATH || resolve(root, '.tools/lune.exe');
function scenario(name) {
  const run = spawnSync(lune, ['run', resolve(here, 'lune/reader-output.luau'), template, name], {
    cwd: root, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(run.status, 0, `${run.error || ''}\n${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, new RegExp(`PASS ${name}`));
}
// Explicit declarations keep the acceptance reporter's native-suite inventory complete.
test('reader output: wire-contract', () => scenario('wire-contract'));
test('reader output: late', () => scenario('late'));
test('reader output: duplicate', () => scenario('duplicate'));
test('reader output: bounds', () => scenario('bounds'));
test('reader output: empty', () => scenario('empty'));
test('reader output: redaction', () => scenario('redaction'));
test('reader output: stale', () => scenario('stale'));
test('reader output: same-connection', () => scenario('same-connection'));
test('reader output: socket', () => scenario('socket'));
test('reader output: shutdown', () => scenario('shutdown'));
test('reader output: replacement', () => scenario('replacement'));
test('reader output: disabled', () => scenario('disabled'));
test('reader output: no-env', () => scenario('no-env'));
test('reader output: broken-env', () => scenario('broken-env'));
test('reader output: send-failure', () => scenario('send-failure'));
test('reader output: globals', () => scenario('globals'));
test('reader output: rejected', () => scenario('rejected'));
test('reader output: safe-string', () => scenario('safe-string'));
