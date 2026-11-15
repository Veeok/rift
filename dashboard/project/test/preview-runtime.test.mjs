import test from 'node:test';
import assert from 'node:assert/strict';
let m;try{m=await import('../src/preview-runtime.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
test('a rehosted synthetic build refuses production origins before fetching anything',async()=>{
 assert.equal(typeof m?.createPreviewTransport,'function','preview runtime boundary is missing');
 let calls=0;
 for(const origin of ['http://127.0.0.1:38918','https://example.invalid','http://127.0.0.2:9999']){
  const fetch=m.createPreviewTransport({origin,fetchImpl:async()=>{calls++;}});
  await assert.rejects(fetch('/api/status',{}),/synthetic|origin/i);
 }
 assert.equal(calls,0);
});
test('the private runtime never transmits a real token or routes outside the fixture host',async()=>{
 assert.equal(typeof m?.createPreviewTransport,'function','preview runtime boundary is missing');
 let calls=0;const fetch=m.createPreviewTransport({origin:'http://127.0.0.2:41735',fetchImpl:async()=>{calls++;return new Response('{}');}});
 await assert.rejects(fetch('/api/login',{body:'{"token":"REAL_SECRET_REFUSED"}'}),/preview-only/i);
 await assert.rejects(fetch('http://127.0.0.1:38918/api/status',{}));
 await fetch('/api/login',{body:'{"token":"preview-only"}'});assert.equal(calls,1);
});
