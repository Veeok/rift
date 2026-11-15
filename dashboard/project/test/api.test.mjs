import test from 'node:test';
import assert from 'node:assert/strict';
let module;
try { module=await import('../src/api.js'); } catch(e) { if(e.code!=='ERR_MODULE_NOT_FOUND')throw e; }
function setup(respond=()=>new Response(JSON.stringify({ok:true}),{status:200})) {
 assert.equal(typeof module?.createDashboardClient,'function','source-owned dashboard client is missing');
 const calls=[];
 const client=module.createDashboardClient({fetchImpl:async(...args)=>{calls.push(args);return respond(...args)}});
 return {client,calls};
}
test('status uses only the fixed same-origin credentialed GET route',async()=>{
 const {client,calls}=setup(()=>new Response(JSON.stringify({state:'healthy'})));
 assert.deepEqual(await client.status(),{state:'healthy'});
 assert.equal(calls[0][0],'/api/status');assert.equal(calls[0][1].method,'GET');
 assert.equal(calls[0][1].credentials,'same-origin');assert.equal(calls[0][1].cache,'no-store');
 assert.equal(calls[0][1].headers.Authorization,undefined);
});
test('login posts the supplied token only in JSON, without retaining a client token property',async()=>{
 const {client,calls}=setup();await client.login('TEST_ONLY_TOKEN');
 assert.equal(calls[0][0],'/api/login');assert.equal(calls[0][1].method,'POST');
 assert.deepEqual(JSON.parse(calls[0][1].body),{token:'TEST_ONLY_TOKEN'});
 assert.equal(calls[0][1].headers['Content-Type'],'application/json');
 assert.ok(!Object.values(client).includes('TEST_ONLY_TOKEN'));
});
test('invalid credentials and forbidden browser tools reject before a request',async()=>{
 const {client,calls}=setup();
 for(const token of ['',null,'x'.repeat(4097)])await assert.rejects(client.login(token));
 for(const name of ['execute_luau','share_capture','../execute_luau','read_script?token=x'])await assert.rejects(client.tool(name,{}));
 assert.equal(calls.length,0);
});
test('structured tool data is preferred without repeated legacy bulk parsing',async()=>{
 const {client}=setup(()=>new Response(JSON.stringify({structuredContent:{metadata:{partial:true},items:[{id:'1',error:{code:'stale'}}]},content:[{type:'text',text:'not JSON'}]})));
 const r=await client.tool('search_instances',{name:'Widget'});assert.equal(r.items[0].error.code,'stale');assert.equal(r.metadata.partial,true);
});
test('pending source is null while a genuine empty source remains an empty string',async()=>{
 for(const sourceText of [null,'']){
  const {client}=setup(()=>new Response(JSON.stringify({structuredContent:{metadata:{status:sourceText===null?'pending':'complete'},sourceText},content:[]})));
  const r=await client.tool('read_script',{script:{id:'s'}},{includeSource:true});
  assert.equal(r.sourceText,sourceText);assert.deepEqual(r.textBlocks,sourceText===null?[]:['']);
 }
});
test('legacy exact source is separate from its metadata and preserves CRLF',async()=>{
 const {client}=setup(()=>new Response(JSON.stringify({content:[{type:'text',text:'{"status":"complete"}'},{type:'text',text:'a\r\nΩ'}]})));
 const r=await client.tool('read_script',{script:{id:'s'}},{includeSource:true});
 assert.deepEqual(r.metadata,{status:'complete'});assert.equal(r.sourceText,'a\r\nΩ');
});
test('HTTP and MCP errors retain error meaning and do not become empty success',async()=>{
 let f=setup(()=>new Response('{"error":"Authentication required"}',{status:401}));
 await assert.rejects(f.client.status(),e=>e.status===401&&/Authentication/.test(e.message));
 f=setup(()=>new Response(JSON.stringify({isError:true,structuredContent:{metadata:{error:{code:'stale_session',message:'Reader changed'}}}})));
 await assert.rejects(f.client.tool('get_logs',{}),/Reader changed/);
 f=setup(()=>new Response('<html>bad gateway</html>'));
 await assert.rejects(f.client.status(),/response/i);
});
test('transport passes cancellation and performs no implicit retry',async()=>{
 const controller=new AbortController();controller.abort();
 const {client,calls}=setup(()=>{throw new DOMException('cancelled','AbortError')});
 await assert.rejects(client.status(controller.signal),{name:'AbortError'});
 assert.equal(calls.length,1);assert.equal(calls[0][1].signal,controller.signal);
});
test('preference writes use only fixed PATCH and exact boolean fields',async()=>{
 const {client,calls}=setup();const input={schemaVersion:1,preload:true,memory:false,virtual:false,unlocker:false};
 await client.protection(input);assert.equal(calls[0][0],'/api/protection');assert.equal(calls[0][1].method,'PATCH');
 assert.deepEqual(JSON.parse(calls[0][1].body),input);
 for(const bad of [{...input,source:'x'},{...input,preload:'true'},{...input,schemaVersion:2}])await assert.rejects(client.protection(bad));
 assert.equal(calls.length,1);
});
test('arbitrary URLs, methods and oversized request bodies reject before transport',async()=>{
 const {client,calls}=setup();
 for(const path of ['https://example.invalid/api/status','//example.invalid','/api/../status','/api/status?token=x'])await assert.rejects(client.request(path));
 await assert.rejects(client.request('/api/status',{}, {method:'DELETE'}));
 await assert.rejects(client.tool('search_source',{query:'x'.repeat(20000)}));
 assert.equal(calls.length,0);
});
