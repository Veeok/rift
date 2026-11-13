import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';

test('production reader subtree returns selected properties without enumeration', () => {
  const result = spawnSync('.tools/lune.exe', ['run', 'test/lune/m11-inspection.luau', 'luau/bootstrap.template.luau'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('schemas bound inspection inputs and registration sends one reader request', async () => {
  const { inspectionSchema, registerInspectionTools } = await import('../dist/inspection.js');
  const subtree = z.object(inspectionSchema.get_subtree);
  assert.equal(subtree.parse({}).maxDepth, 2);
  assert.equal(subtree.safeParse({ maxDepth: 17 }).success, false);
  assert.equal(subtree.safeParse({ properties: Array(33).fill('Name') }).success, false);
  const batch = z.object(inspectionSchema.inspect_instances);
  assert.equal(batch.safeParse({ targets: [] }).success, false);
  assert.equal(batch.safeParse({ targets: [{}] }).success, false);
  const args = batch.parse({ targets: [{ id: 'test-ses:1' }, { path: ['Workspace'] }] });
  const registered = {};
  const server = { registerTool(name, config, fn) { registered[name] = { config, fn }; } };
  let calls = 0;
  const bridge = { reader: { session: 'test-session', connectionId: 'c1', capabilities: ['inspection_v1'] },
    async request(op, input) { calls++; assert.equal(op, 'inspect_instances'); assert.equal(input, args); return { items: [{ index: 1 }] }; } };
  registerInspectionTools(server, bridge);
  assert.deepEqual(Object.keys(registered).sort(), ['get_subtree', 'inspect_instances']);
  const result = await registered.inspect_instances.fn(args);
  assert.equal(calls, 1);
  assert.equal(result.structuredContent.items[0].index, 1);
  bridge.reader.capabilities = [];
  const unsupported = await registered.get_subtree.fn({});
  assert.equal(unsupported.isError, true);
  assert.match(unsupported.content[0].text, /inspection_v1/);
  assert.equal(calls, 1);
  bridge.reader.capabilities = ['inspection_v1'];
  bridge.request = async () => { bridge.reader = { ...bridge.reader, connectionId: 'c2' }; return { items: [] }; };
  const reconnected = await registered.get_subtree.fn({});
  assert.equal(reconnected.isError, true);
  assert.equal(reconnected.structuredContent.error.code, 'stale_session');
});

test('richer search schema validates predicate combinations and safe property names', async () => {
  const { inspectionSchema } = await import('../dist/inspection.js');
  const search = z.object(inspectionSchema.search_instances);
  assert.equal(search.safeParse({ root: {}, name: 'TypeProbe' }).success, true);
  assert.equal(search.safeParse({ attributes: [{ name: 'Locked', op: 'eq', value: true }], visible: false }).success, true);
  assert.equal(search.safeParse({ propertyFilters: [{ name: 'Secret', op: 'eq', value: true }] }).success, false);
  assert.equal(search.safeParse({ attributes: [{ name: 'N', op: 'gt', value: '1' }] }).success, false);
  assert.equal(search.safeParse({ attributes: [{ name: 'N', op: 'exists', value: true }] }).success, true);
});

test('complete UTF-8 envelope is bounded with an exact batch omission cursor', async () => {
  const { registerInspectionTools } = await import('../dist/inspection.js');
  const registered = {};
  const server = { registerTool(name, config, fn) { registered[name] = fn; } };
  const bridge = { reader: { session: 'session', connectionId: 'c', capabilities: ['inspection_v1'] },
    async request() { return { offset: 0, items: Array.from({ length: 10 }, (_, i) => ({ index: i + 1, value: '漢'.repeat(90) })), omissions: { items: 2 }, partial: true, partialReason: 'response_size' }; } };
  registerInspectionTools(server, bridge);
  const result = await registered.inspect_instances({ targets: [{ id: 'abc' }], maxResponseChars: 2048 });
  assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 2048);
  const data = result.structuredContent;
  assert.ok(data.items.length > 0 && data.items.length < 10);
  assert.equal(data.nextOffset, data.items.length);
  assert.equal(data.omittedCount, 12 - data.items.length);
  assert.equal(data.omissions.items, data.omittedCount);
  bridge.request = async () => { throw new Error('漢'.repeat(5000)); };
  const failure = await registered.inspect_instances({ targets: [{ id: 'abc' }], maxResponseChars: 2048 });
  assert.equal(failure.isError, true);
  assert.ok(Buffer.byteLength(JSON.stringify(failure), 'utf8') <= 2048, 'error envelope exceeded budget');
});
