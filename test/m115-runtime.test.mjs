import test from 'node:test';
import assert from 'node:assert/strict';
import {BridgeError} from '../dist/bridge.js';
let m;try{m=await import('../dist/owned-ui-runtime.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const reader={session:'s1',connectionId:'c1',generation:1,readerBuild:'candidate-reader',capabilities:['owned_ui_v1']};
function fixture(transform=x=>x){
 assert.equal(typeof m?.OwnedUiRuntime,'function','resource-scoped runtime is missing');let calls=[];
 const bridge={reader:{...reader},request:async(op,args)=>{calls.push({op,args});return transform({runId:args.runId,nonce:args.nonce,profileId:m.OWNED_UI_PROFILE.id,factoryHash:m.OWNED_UI_PROFILE.factoryHash,validatorHash:m.OWNED_UI_PROFILE.validatorHash,readerBuild:reader.readerBuild,scope:'context_created_only',wholeScriptProtected:false,validation:{status:'observed_exclusion',checksPassed:true,created:10,destroyed:10,retainedOwned:0,unknownOwned:false,deferred:false}});}};
 return {bridge,calls,runtime:new m.OwnedUiRuntime(bridge)};
}
test('only the exact reviewed example and matching reader protocol are candidates',()=>{
 const f=fixture();assert.equal(f.runtime.isCandidate(m.OWNED_UI_EXAMPLE),true);assert.equal(f.runtime.isCandidate(m.OWNED_UI_EXAMPLE+'\n--different'),false);
 f.bridge.reader.capabilities=[];assert.equal(f.runtime.isCandidate(m.OWNED_UI_EXAMPLE),false);assert.equal(f.calls.length,0);
});
test('preparation binds a fresh nonce, exact profile and compact native proof before returning a policy',async()=>{
 const f=fixture(),p=await f.runtime.prepare('run-1');assert.equal(f.calls[0].op,'owned_ui_prepare');assert.equal(p.mode,'owned_ui_v1');assert.equal(typeof p.nonce,'string');assert.equal(p.profileId,m.OWNED_UI_PROFILE.id);
 assert.equal(f.runtime.view().support,'supported');assert.equal(f.runtime.view().wholeScriptProtected,false);assert.equal(f.runtime.view().inUse,false);
});
test('spoofed nonce, equivocal cleanup and foreign profile are never accepted',async()=>{
 for(const change of [x=>({...x,nonce:'foreign'}),x=>({...x,factoryHash:'foreign'}),x=>({...x,validation:{...x.validation,unknownOwned:true}}),x=>({...x,validation:{...x.validation,retainedOwned:1}})]){
  const f=fixture(change);await assert.rejects(f.runtime.prepare('run-1'));assert.equal(f.runtime.view().support,'unverified');
 }
});
test('reader changes and cancellation during preparation refuse; no later source is queued',async()=>{
 let f=fixture(x=>{f.bridge.reader={...reader,connectionId:'c2'};return x;});await assert.rejects(f.runtime.prepare('run-1'),/changed/i);
 const controller=new AbortController();f=fixture(x=>{controller.abort();return x;});await assert.rejects(f.runtime.prepare('run-2',controller.signal),/cancel/i);
 assert.ok(f.calls.every(c=>c.op!=='exec'));
});
test('result eviction is independent of explicit close and reconnect invalidates readiness',async()=>{
 const f=fixture();await f.runtime.prepare('run-1');f.runtime.observe('run-1',{active:2,created:2,state:'open'});assert.equal(f.runtime.view().inUse,true);
 f.bridge.reader={...reader,connectionId:'c2'};assert.equal(f.runtime.view().support,'unverified');assert.equal(f.runtime.view().inUse,false);
 await f.runtime.close('run-1');assert.equal(f.calls.at(-1).op,'owned_ui_close');assert.equal(f.calls.at(-1).args.runId,'run-1');
});
test('known pre-native capacity refusal stays retryable after a slot closes',async()=>{
 const f=fixture(),request=f.bridge.request;let full=true;
 f.bridge.request=async(op,args)=>{if(op==='owned_ui_prepare'&&full)throw new BridgeError('reader_error','capacity',false,'context_limit');return request(op,args);};
 await assert.rejects(f.runtime.prepare('full'),error=>error.preparationUnknown===false);
 assert.equal(f.runtime.view().validationBlocked,false);full=false;
 await f.runtime.prepare('after-close');assert.equal(f.runtime.view().support,'supported');
});
test('verified cancellation cleanup releases host records instead of exhausting sixty-four slots',async()=>{
 const f=fixture(),request=f.bridge.request;let controller;
 f.bridge.request=async(op,args)=>{
  if(op==='owned_ui_close')return {state:'closed',created:0,destroyed:0,active:0,retainedOwned:0,residualFailedCreates:0,unknownOwned:false};
  const ack=await request(op,args);controller?.abort();return ack;
 };
 for(let i=0;i<65;i++){controller=new AbortController();await assert.rejects(f.runtime.prepare('cancel-'+i,controller.signal),/cancel/i);}
 controller=null;await f.runtime.prepare('uncancelled');assert.equal(f.runtime.view().support,'supported');
});
test('a new host recovers exact historical cleanup references without restoring readiness or nonces',async()=>{
 const f=fixture();await f.runtime.prepare('surviving');f.runtime.observe('surviving',{active:2,created:2,state:'open'});
 const reference={runId:'surviving',sessionId:reader.session,connectionId:reader.connectionId,generation:reader.generation,readerBuild:reader.readerBuild};
 f.bridge.reader={...reader,connectionId:'reconnected'};
 f.bridge.request=async(op,args)=>{
  f.calls.push({op,args});
  if(op==='owned_ui_status')return {validationBlocked:false,contexts:[{...reference,active:2,created:2,destroyed:0,retainedOwned:0,residualFailedCreates:0,unknownOwned:false,state:'revoked',current:false}]};
  assert.equal(op,'owned_ui_close_recorded');assert.deepEqual(args,reference);
  return {...reference,state:'closed',created:2,destroyed:2,active:0,retainedOwned:0,residualFailedCreates:0,unknownOwned:false};
 };
 const fresh=new m.OwnedUiRuntime(f.bridge);await fresh.refresh();assert.equal(fresh.view().support,'unverified');assert.equal(fresh.view().inUse,false);assert.equal(fresh.view().earlierContexts,1);
 await fresh.close('surviving');assert.equal(fresh.view().earlierContexts,0);
});
