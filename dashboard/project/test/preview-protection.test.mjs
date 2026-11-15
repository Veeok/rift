import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createPreviewApi} from '../tools/preview-api.mjs';
test('synthetic protection API parses bounded PATCH, preserves explicit saves and refuses unsupported fields',async()=>{
 const middleware=createPreviewApi();
 const server=http.createServer((req,res)=>middleware(req,res,()=>{res.writeHead(404);res.end();}));
 await new Promise(r=>server.listen(0,'127.0.0.2',r));
 const url='http://127.0.0.2:'+server.address().port;
 const off={schemaVersion:1,preload:false,memory:false,virtual:false,unlocker:false};
 const write=input=>fetch(url+'/api/protection',{method:'PATCH',headers:{origin:url,'content-type':'application/json'},body:typeof input==='string'?input:JSON.stringify(input)});
 try{
  let response=await fetch(url+'/api/protection');assert.equal(response.status,200);assert.deepEqual((await response.json()).preferences,off);
  for(const bad of [{...off,source:'x'},{...off,memory:true},{...off,preload:'true'}])assert.equal((await write(bad)).status,400);
  assert.equal((await write(JSON.stringify(off)+' '.repeat(1025))).status,413);
  response=await write({...off,preload:true});assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
  const saved=await(await fetch(url+'/api/protection')).json();assert.equal(saved.preferences.preload,true);assert.equal(saved.runtime.preload.state,'Unverified');assert.equal(saved.runtime.preload.inUse,false);
  await fetch(url+'/api/preview/scenario',{method:'POST',headers:{origin:url,'content-type':'application/json'},body:'{"scenario":"locked"}'});
  assert.equal((await fetch(url+'/api/protection')).status,401);assert.equal((await write(off)).status,401);
 }finally{await new Promise(r=>server.close(r));}
});
