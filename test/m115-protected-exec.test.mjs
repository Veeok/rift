import test from 'node:test';
import assert from 'node:assert/strict';
import {ExecService} from '../dist/exec.js';
import {OWNED_UI_EXAMPLE,OWNED_UI_PROFILE} from '../dist/owned-ui-runtime.js';
import {BridgeError} from '../dist/bridge.js';
const prefs={schemaVersion:1,preload:true,memory:false,virtual:false,unlocker:false};
function fixture({capability=true,failPrepare=false,failExecution=false}={}){
 const calls=[];const bridge={reader:{session:'s1',connectionId:'c1',generation:1,readerBuild:'candidate',placeId:1,jobId:'job',capabilities:['exec',...(capability?['owned_ui_v1']:[])]},request:async(op,args)=>{
  calls.push({op,args});if(op==='owned_ui_prepare'){
   if(failPrepare)throw new BridgeError('deadline_exceeded','Synthetic validation timeout',true);
   return {...args,readerBuild:'candidate',scope:'context_created_only',wholeScriptProtected:false,validation:{status:'observed_exclusion',checksPassed:true,created:10,destroyed:10,retainedOwned:0,unknownOwned:false,deferred:false}};
  }
  if(op==='exec'){if(failExecution)throw new BridgeError('deadline_exceeded','Synthetic execution timeout',true);return {executed:true,compiled:true,ok:true,returns:[],ownedUi:{state:'open',created:3,active:3,residualFailedCreates:0}};}
  return {state:'closed',active:0,residualFailedCreates:0};
 }};
 return {calls,bridge,exec:new ExecService(bridge,true,{snapshot:async()=>({preferences:prefs,error:null})})};
}
test('reviewed workload gets a prepared context before dispatch and only resource-level coverage',async()=>{
 const f=fixture(),r=await f.exec.run(OWNED_UI_EXAMPLE,{confirm:true});
 assert.deepEqual(f.calls.map(c=>c.op),['owned_ui_prepare','exec']);assert.equal(r.protection.mode,'protected');assert.equal(r.protection.scope,'context_created_only');assert.equal(r.protection.wholeScriptProtected,false);
 assert.equal(f.calls[1].args.policy.nonce,f.calls[0].args.nonce);assert.equal(f.calls[1].args.policy.profileId,OWNED_UI_PROFILE.id);
 assert.equal(f.exec.preloadView().inUse,true);
});
test('unknown source and an old reader cannot obtain a context from declarations or capabilities',async()=>{
 let f=fixture();await f.exec.run(OWNED_UI_EXAMPLE+'\n--outside reviewed source',{confirm:true});assert.equal(f.calls.length,0);
 f=fixture({capability:false});await f.exec.run(OWNED_UI_EXAMPLE,{confirm:true});assert.equal(f.calls.length,0);
});
test('unknown preparation refuses source and latches against automatic validation retries',async()=>{
 const f=fixture({failPrepare:true});const r=await f.exec.run(OWNED_UI_EXAMPLE,{confirm:true});assert.equal(f.calls.filter(c=>c.op==='exec').length,0);
 assert.equal(r.protection.mode,'refused');assert.equal(r.protection.preparationUnknown,true);
 await f.exec.run(OWNED_UI_EXAMPLE,{confirm:true});assert.equal(f.calls.length,1);
});
test('post-dispatch timeout keeps scoped policy and explicit close remains separate from results',async()=>{
 const f=fixture({failExecution:true}),r=await f.exec.run(OWNED_UI_EXAMPLE,{confirm:true});assert.equal(r.unknownOutcome,true);assert.equal(r.protection.mode,'protected');
 assert.equal(f.calls.some(c=>c.op==='owned_ui_close'),false);await f.exec.closeOwnedUi(r.runId,true);assert.equal(f.calls.at(-1).op,'owned_ui_close');
});
