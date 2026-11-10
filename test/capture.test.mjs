import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { CaptureService } from '../dist/capture.js';

// Only the OS boundary is replaced. Produce actual PNGs so image contract checks remain real.
function png(width, height) {
  const chunk = (name, data) => {
    const body = Buffer.concat([Buffer.from(name), data]);
    let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, tail]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc((width * 4 + 1) * height, 0))), chunk('IEND', Buffer.alloc(0))]);
}
const window = (id = '101') => ({ id, title: 'Roblox', pid: 42, processName: 'RobloxPlayerBeta', width: 40, height: 30, minimized: false });
class ClientOS {
  windows = [window(), window('102')];
  closedDuringCapture = false;
  async listWindows() { return structuredClone(this.windows); }
  async capture(id, crop) {
    if (this.closedDuringCapture || !this.windows.some(w => w.id === id)) throw new Error('Window closed; refresh client windows');
    // Coordinate-specific image proves crop forwarding, rather than merely inspecting a spy.
    const w = this.windows.find(w => w.id === id);
    const width = crop?.width ?? w.width, height = crop?.height ?? w.height;
    const data = png(width, height);
    if (crop && (crop.x !== 3 || crop.y !== 4)) throw new Error('unexpected crop coordinates at OS boundary');
    return { data, width, height };
  }
}

test('M6-01 explicit client selection and pixel crop bounds', async () => {
  const os = new ClientOS(), service = new CaptureService(os);
  os.windows.push({...window('103'),processName:'RobloxStudioBeta'}, {...window('104'),processName:'OtherApp'});
  assert.deepEqual((await service.listWindows()).map(w => w.id), ['101', '102']);
  await assert.rejects(service.preview({ sessionId: 's1' }), /select|window/i);
  for (const windowId of ['103', '104', '999', '101;whoami', '', '0']) await assert.rejects(service.preview({ windowId, sessionId: 's1' }), /window/i);
  for (const crop of [{x:-1,y:0,width:1,height:1},{x:0,y:0,width:0,height:1},{x:0.5,y:0,width:1,height:1},{x:39,y:0,width:2,height:1},{x:0,y:29,width:1,height:2},{x:0,y:0,width:Infinity,height:1}]) {
    await assert.rejects(service.preview({windowId:'101',sessionId:'s1',crop}), /crop/i);
  }
  const crop = {x:3,y:4,width:10,height:8};
  const meta = await service.preview({windowId:'102',sessionId:'s1',crop});
  assert.equal(meta.width, 10); assert.equal(meta.height, 8); assert.deepEqual(meta.crop, crop);
  assert.equal(meta.window.id, '102');
  assert.deepEqual(service.image(meta.captureId).data, png(10,8));
});

test('M6-02 fresh enumeration, closed/minimized/huge refusal and recovery', async () => {
  const os = new ClientOS(), service = new CaptureService(os);
  await service.listWindows(); os.windows = [];
  await assert.rejects(service.preview({windowId:'101',sessionId:'s1'}), /closed|refresh|window/i);
  for (const override of [{minimized:true},{width:0},{height:0},{width:20000},{processName:'RobloxStudioBeta'},{processName:'OtherApp'}]) {
    os.windows = [{...window(),...override}];
    await assert.rejects(service.preview({windowId:'101',sessionId:'s1'}), /window|client|restore|size/i);
  }
  os.windows = [window()]; os.closedDuringCapture = true;
  await assert.rejects(service.preview({windowId:'101',sessionId:'s1'}), /closed/i);
  os.closedDuringCapture = false;
  assert.equal((await service.preview({windowId:'101',sessionId:'s1'})).width, 40);
  // A recycled HWND must not attach old PID/title metadata to a new client image.
  class ReplacedWindowOS extends ClientOS {
    async capture(id,crop) {
      const result = await super.capture(id,crop);
      this.windows = [{...window(),pid:99,title:'Another client'}];
      return result;
    }
  }
  await assert.rejects(new CaptureService(new ReplacedWindowOS()).preview({windowId:'101',sessionId:'s1'}), /changed|refresh/i);
});

test('M6-03 explicit share, session integrity, typed image and honest immutable metadata', async () => {
  const os = new ClientOS(), service = new CaptureService(os);
  const meta = await service.preview({windowId:'101',sessionId:'original'});
  const original = structuredClone(meta);
  assert.match(meta.capturedAt, /^\d{4}-.*Z$/); assert.equal(meta.sessionId, 'original');
  assert.equal(meta.crop, null); assert.equal(meta.windowSessionMatch, 'unverified');
  assert.match(meta.notice, /unverified/i);
  assert.deepEqual(meta.window, window());
  assert.throws(() => service.share({captureId:meta.captureId,sessionId:'original',confirm:false}), /confirm/i);
  assert.throws(() => service.share({captureId:meta.captureId,sessionId:'changed',confirm:true}), /session/i);
  assert.throws(() => service.share({captureId:meta.captureId,sessionId:'original',confirm:true,routeSupportsImages:false}), /image|route/i);
  for (const routeSupportsImages of [undefined, true]) {
    const result = service.share({captureId:meta.captureId,sessionId:'original',confirm:true,routeSupportsImages});
    assert.equal(result.content[0].type, 'text');
    const shared = JSON.parse(result.content[0].text);
    for (const [key,value] of Object.entries(original)) assert.deepEqual(shared[key], value);
    assert.equal(shared.routeImageSupport, routeSupportsImages ? 'supported' : 'unverified');
    assert.equal(result.content[1].type, 'image'); assert.equal(result.content[1].mimeType, 'image/png');
    assert.deepEqual(Buffer.from(result.content[1].data,'base64'), png(40,30));
  }
  meta.window.title = 'forged'; meta.sessionId = 'changed';
  const image = service.image(meta.captureId); image.meta.window.title = 'forged again'; image.data.fill(0);
  assert.deepEqual(service.image(meta.captureId).meta, original);
  assert.deepEqual(service.image(meta.captureId).data, png(40,30));
  await assert.rejects(service.preview({windowId:'101',sessionId:''}), /session/i);
});

test('M6-04 bounded count, bytes, TTL and invalid configuration', async () => {
  const os = new ClientOS();
  for (const options of [{maxEntries:0},{ttlMs:NaN},{maxBytes:-1},{maxEntries:1.5}]) assert.throws(() => new CaptureService(os,options), /positive|integer|limit/i);
  const service = new CaptureService(os,{maxEntries:1});
  const a = await service.preview({windowId:'101',sessionId:'s'});
  const b = await service.preview({windowId:'102',sessionId:'s'});
  assert.throws(() => service.image(a.captureId), /expired|evicted|found/i);
  assert.equal(service.image(b.captureId).meta.window.id,'102');
  const bytes = new CaptureService(os,{maxBytes:png(40,30).length});
  const c = await bytes.preview({windowId:'101',sessionId:'s'});
  await bytes.preview({windowId:'102',sessionId:'s'});
  assert.throws(() => bytes.image(c.captureId), /expired|evicted|found/i);
  await assert.rejects(new CaptureService(os,{maxBytes:1}).preview({windowId:'101',sessionId:'s'}), /byte|large|limit/i);
  const ttl = new CaptureService(os,{ttlMs:15});
  const d = await ttl.preview({windowId:'101',sessionId:'s'});
  await new Promise(resolve => setTimeout(resolve,35));
  assert.throws(() => ttl.image(d.captureId), /expired|evicted|found/i);
  assert.throws(() => ttl.share({captureId:d.captureId,sessionId:'s',confirm:true}), /expired|evicted|found/i);
});
