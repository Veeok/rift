import test from 'node:test';
import assert from 'node:assert/strict';
import {ExecService} from '../dist/exec.js';
import {BridgeError} from '../dist/bridge.js';
const off={schemaVersion:1,preload:false,memory:false,virtual:false,unlocker:false};
function fixture({preload=true,error=null,request,snapshot}={}){
 const preferences={...off,preload};let calls=0;
 const bridge={reader:{session:'synthetic',connectionId:'c1',placeId:1,jobId:'job',capabilities:['exec']},request:async(...args)=>{calls++;return request?request(...args):{executed:true,compiled:true,ok:true,returns:[]};}};
 const policy={snapshot:snapshot??(async()=>({preferences:{...preferences},error}))};
 const exec=new ExecService(bridge,true,policy);
 return {exec,bridge,preferences,get calls(){return calls;}};
}
test('saved On and confirm alone refuse unverified execution before dispatch',async()=>{
 const f=fixture(),r=await f.exec.run('return 1',{confirm:true});
 assert.equal(f.calls,0);assert.equal(r.rejectionCode,'preload_unverified');assert.equal(r.protection.mode,'refused');assert.equal(r.protection.reason,'backend_unverified');
});
test('a literal one-run override does not replace separate confirmation or stick to a later run',async()=>{
 const f=fixture();await f.exec.run('return 1',{allowUnprotected:true});assert.equal(f.calls,0);
 for(const value of ['true',1,{confirm:true}]){await f.exec.run('return 1',{confirm:true,allowUnprotected:value});assert.equal(f.calls,0);}
 const r=await f.exec.run('return 1',{confirm:true,allowUnprotected:true});
 assert.equal(f.calls,1);assert.equal(r.protection.mode,'unprotected_override');assert.equal(f.preferences.preload,true);
 const next=await f.exec.run('return 1',{confirm:true});assert.equal(f.calls,1);assert.equal(next.protection.mode,'refused');
});
test('storage errors refuse even an explicit override instead of falling back to Off',async()=>{
 const f=fixture({preload:false,error:{code:'read_failed',message:'Unavailable',retryable:true}});
 const r=await f.exec.run('return 1',{confirm:true,allowUnprotected:true});
 assert.equal(f.calls,0);assert.equal(r.rejectionCode,'protection_preferences_error');assert.equal(r.protection.preloadRequested,null);
});
test('provider failure and reader changes while snapshot awaits both refuse before dispatch',async()=>{
 let f=fixture({snapshot:async()=>{throw new Error('synthetic IO failure');}});
 assert.equal((await f.exec.run('x',{confirm:true})).rejectionCode,'protection_preferences_error');assert.equal(f.calls,0);
 f=fixture({snapshot:async()=>{f.bridge.reader={...f.bridge.reader,connectionId:'c2'};return {preferences:off,error:null};}});
 assert.equal((await f.exec.run('x',{confirm:true})).rejectionCode,'protection_session_changed');assert.equal(f.calls,0);
});
test('Off remains ordinary execution while timeout retains explicit unprotected policy attribution',async()=>{
 let f=fixture({preload:false});let r=await f.exec.run('x',{confirm:true});assert.equal(f.calls,1);assert.equal(r.protection.mode,'off');
 f=fixture({request:async()=>{throw new BridgeError('deadline_exceeded','Synthetic timeout',true);}});
 r=await f.exec.run('x',{confirm:true,allowUnprotected:true});
 assert.equal(f.calls,1);assert.equal(r.unknownOutcome,true);assert.equal(r.protection.mode,'unprotected_override');
 const prior=await f.exec.run('different',{runId:r.runId,confirm:true});assert.equal(f.calls,1);assert.equal(prior.protection.mode,'unprotected_override');
});
