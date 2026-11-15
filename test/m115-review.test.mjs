import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {ExecService} from '../dist/exec.js';
import {ProtectionStore} from '../dist/protection-store.js';
import {createCatalog} from '../dist/catalog.js';
import {startService} from '../dist/service.js';
import {LIMITS} from '../dist/limits.js';
import {connectReader,until} from './client-fixture.mjs';
const off={schemaVersion:1,preload:false,memory:false,virtual:false,unlocker:false};
const reader={session:'synthetic',connectionId:'c1',placeId:1,jobId:'job',capabilities:['exec']};
const success={executed:true,compiled:true,ok:true,returns:[]};
const token='M115_REVIEW_SYNTHETIC_ONLY_TOKEN_012345678901234567';
test('constructing without an injected provider still reads persisted policy and refuses corruption',async()=>{
 const original=ProtectionStore.prototype.snapshot;let calls=0,reads=0;
 ProtectionStore.prototype.snapshot=async function(){reads++;return {preferences:off,error:{code:'invalid_preferences',message:'Synthetic corruption',retryable:false}};};
 try{const exec=new ExecService({reader,request:async()=>{calls++;return success;}},true);
  const result=await exec.run('synthetic',{confirm:true});assert.equal(calls,0);assert.equal(reads,1);assert.equal(result.rejectionCode,'protection_preferences_error');
 }finally{ProtectionStore.prototype.snapshot=original;}
});
test('an invalid absent provider cannot silently bypass admission at runtime',async()=>{
 let calls=0;const exec=new ExecService({reader,request:async()=>{calls++;return success;}},true,null);
 const result=await exec.run('synthetic',{confirm:true});assert.equal(calls,0);assert.equal(result.rejectionCode,'protection_preferences_error');
});
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;}
test('cancelled preflight never dispatches when a stalled snapshot later resolves',async()=>{
 let finish,calls=0;const controller=new AbortController();
 const bridge={reader,request:async()=>{calls++;return success;}};
 const exec=new ExecService(bridge,true,{snapshot:()=>new Promise(r=>finish=r)});
 const pending=exec.run('synthetic',{confirm:true,signal:controller.signal});controller.abort();finish({preferences:off,error:null});
 const result=await pending;assert.equal(calls,0);assert.equal(result.rejectionCode,'protection_preflight_cancelled');assert.equal(result.unknownOutcome,false);
});
test('preflight has a fixed time bound and cannot dispatch after its timeout',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let finish,calls=0;
 const exec=new ExecService({reader,request:async()=>{calls++;return success;}},true,{snapshot:()=>new Promise(r=>finish=r)});
 const pending=exec.run('synthetic',{confirm:true});t.mock.timers.tick(5001);await Promise.resolve();finish({preferences:off,error:null});
 const result=await pending;assert.equal(calls,0);assert.equal(result.rejectionCode,'protection_preflight_timeout');
});
test('oversized escaped output retains run identity and exact unprotected override attribution',async()=>{
 const bridge={reader,request:async()=>({...success,output:'\u0000'.repeat(60000)})};
 const exec=new ExecService(bridge,true,{snapshot:async()=>({preferences:{...off,preload:true},error:null})});
 const tool=createCatalog(bridge,{},exec).get('execute_luau');
 const result=await tool.handler({source:'synthetic',confirm:true,allowUnprotected:true});
 const value=result.structuredContent??JSON.parse(result.content[0].text);
 assert.ok(value.runId);assert.equal(value.status,'completed');assert.equal(value.executed,true);assert.equal(value.protection.mode,'unprotected_override');assert.equal(value.outputTruncated,true);
 assert.ok(Buffer.byteLength(JSON.stringify(result))<=LIMITS.maxToolResponseChars);
});
test('closing the HTTP caller during preference preflight prevents later socket dispatch',async()=>{
 const original=ProtectionStore.prototype.snapshot;let finish,started=false;
 ProtectionStore.prototype.snapshot=function(){started=true;return new Promise(r=>finish=r);};
 const readerPort=await port(),apiPort=await port();let svc,client,request;
 try{
  svc=await startService({port:readerPort,apiPort,token,tokenFile:'unused',tokenError:null,allowExec:true,logLevel:'error'});
  client=await connectReader({port:readerPort,token,build:svc.status().build.expectedReaderBuild,handler:()=>success});
  request=http.request({hostname:'127.0.0.1',port:apiPort,path:'/api/tools/execute_luau',method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'}});
  request.on('error',()=>{});request.end(JSON.stringify({source:'synthetic',confirm:true}));await until(()=>started);
  const closed=new Promise(r=>request.once('close',r));request.destroy();await closed;
  // Let the server observe TCP close before releasing its unrelated I/O.
  await new Promise(r=>setTimeout(r,30));finish({preferences:off,error:null});await new Promise(r=>setTimeout(r,30));
  assert.equal(client.executions,0);
 }finally{ProtectionStore.prototype.snapshot=original;request?.destroy();await client?.close();await svc?.stop();}
});
