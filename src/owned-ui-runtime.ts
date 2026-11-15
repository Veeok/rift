import {createHash,randomUUID} from 'node:crypto';
import {Bridge,BridgeError} from './bridge.js';

export const OWNED_UI_EXAMPLE=`-- Reviewed cooperative factory example. No whole-script concealment claim.
local ui = assert(RiftUI, "This example requires a prepared RiftUI context")
local function make(class, properties, parent)
    local node, problem = ui:create(class, properties, parent)
    assert(node, problem and problem.code)
    return node
end
local root = make("ScreenGui", {Name="RiftOwnedUiExample", ResetOnSpawn=false})
local image = make("ImageLabel", {Name="ExampleImage", Image="rbxassetid://3926307971", Size=UDim2.fromOffset(120,120), Position=UDim2.fromOffset(24,100)}, root)
task.defer(function()
    make("Frame", {Name="DeferredOwnedFrame", Size=UDim2.fromOffset(8,8)}, image)
end)
return "Factory resources remain owned until explicit close; raw producers and prior asset history are outside coverage."
`;
const digest=(source:string)=>createHash('sha256').update(source).digest('hex');
export const OWNED_UI_PROFILE=Object.freeze({id:'rift-owned-ui-v1',factoryHash:'20feeb857eb3f370aa5d4f4f5cb9441f583bbc2db45cb45b65d629a5ec5cbce1',validatorHash:'9c4b3a1fda0d75ffee28d2709e8a5e7cbbe50b0fa98f29d732255ec9d7df9234',workloadHash:digest(OWNED_UI_EXAMPLE)});
export type OwnedUiPolicy={mode:'owned_ui_v1';nonce:string;profileId:string};
type RecordedReference={runId:string;sessionId:string;connectionId:string;generation:string|number;readerBuild:string};
type RecordState={nonce?:string;reference?:RecordedReference;identity:string;used:boolean;active:number;closed:boolean;last?:unknown};

/** A capability report alone is not readiness. Only the reviewed source can
 * request fixed native validation, and every acknowledgment is generation-bound.
 * This is a scoped engineering check, not attestation of an untrusted client. */
export class OwnedUiRuntime {
 private readonly records=new Map<string,RecordState>();
 private proofIdentity:string|null=null;
 private validationBlocked=false;
 constructor(private readonly bridge:Bridge){}
 private identity(){const r=this.bridge.reader;return r?`${r.session}/${r.connectionId}/${r.generation}/${r.readerBuild}`:null;}
 isCandidate(source:string){return !this.validationBlocked&&digest(source)===OWNED_UI_PROFILE.workloadHash&&this.bridge.reader?.capabilities.includes('owned_ui_v1')===true;}
 async prepare(runId:string,signal?:AbortSignal):Promise<OwnedUiPolicy>{
  const reader=this.bridge.reader,identity=this.identity();
  if(signal?.aborted)throw new Error('Caller cancelled before native preparation.');
  if(this.validationBlocked||!reader||!identity||!reader.capabilities.includes('owned_ui_v1'))throw new Error('Owned UI backend is unverified or blocked.');
  if(this.records.has(runId))throw new Error('Run already has a preparation record.');
  if(this.records.size>=64){
   const old=[...this.records].find(([,v])=>v.closed&&v.active===0);
   if(old)this.records.delete(old[0]);else throw new Error('Owned UI preparation registry is full.');
  }
  const nonce=randomUUID();const record:RecordState={nonce,identity,used:false,active:0,closed:false};this.records.set(runId,record);
  let ack:any;
  try{ack=await this.bridge.request('owned_ui_prepare',{runId,nonce,profileId:OWNED_UI_PROFILE.id,factoryHash:OWNED_UI_PROFILE.factoryHash,validatorHash:OWNED_UI_PROFILE.validatorHash},{deadlineMs:18_000});}
  catch(error){
   // These fixed reader errors occur before validation or context reservation.
   if(error instanceof BridgeError&&error.code==='reader_error'&&['context_limit','run_history_limit'].includes(error.readerCode??'')){
    this.records.delete(runId);
    throw Object.assign(new Error('Owned UI capacity refused before native preparation. Close an earlier context before retrying explicitly.'),{cause:error,preparationUnknown:false});
   }
   this.validationBlocked=true;
   throw Object.assign(new Error('Native preparation did not complete with verified cleanup. Source was not dispatched; no automatic retry.'),{cause:error,preparationUnknown:true});
  }
  if(signal?.aborted||identity!==this.identity()){
   // No source has claimed this empty context. Try exactly one bounded close.
   await this.bridge.request('owned_ui_close',{runId,nonce},{deadlineMs:1_000}).then(summary=>this.observe(runId,summary)).catch(()=>undefined);
   throw new Error(signal?.aborted?'Caller cancelled during native preparation.':'Reader changed during native preparation.');
  }
  const v=ack?.validation;
  const exact=ack?.runId===runId&&ack?.nonce===nonce&&ack?.profileId===OWNED_UI_PROFILE.id&&ack?.factoryHash===OWNED_UI_PROFILE.factoryHash&&ack?.validatorHash===OWNED_UI_PROFILE.validatorHash&&ack?.readerBuild===reader.readerBuild&&ack?.scope==='context_created_only'&&ack?.wholeScriptProtected===false;
  const proven=v?.status==='observed_exclusion'&&v?.checksPassed===true&&Number.isSafeInteger(v.created)&&v.created>0&&v.created===v.destroyed&&v.retainedOwned===0&&v.unknownOwned===false&&v.deferred===false;
  if(!exact||!proven){this.validationBlocked=true;throw new Error('Native preparation acknowledgment is unverified; source was not dispatched.');}
  this.proofIdentity=identity;
  return {mode:'owned_ui_v1',nonce,profileId:OWNED_UI_PROFILE.id};
 }
 observe(runId:string,summary:any){
  const record=this.records.get(runId);if(!record||!summary||typeof summary!=='object')return;
  record.used=true;record.active=Number.isSafeInteger(summary.active)&&summary.active>=0?summary.active:record.active;
  record.closed=summary.state==='closed'&&record.active===0&&summary.residualFailedCreates===0&&summary.retainedOwned===0&&summary.unknownOwned!==true&&Number.isSafeInteger(summary.created)&&summary.created===summary.destroyed;record.last=summary;
 }
 async close(runId:string){
  if(!this.records.has(runId))await this.refresh();
  const record=this.records.get(runId);if(!record)throw new Error('Unknown owned UI context.');
  if(record.closed)return record.last;
  if(!record.nonce&&!record.reference)throw new Error('Owned UI cleanup reference is unavailable.');
  const result=await this.bridge.request(record.nonce?'owned_ui_close':'owned_ui_close_recorded',record.nonce?{runId,nonce:record.nonce}:record.reference!,{deadlineMs:5_000});this.observe(runId,result);return result;
 }
 async refresh(){
  if(!this.bridge.reader?.capabilities.includes('owned_ui_v1'))return this.view();
  try{
   const data=await this.bridge.request('owned_ui_status',{}, {deadlineMs:2_000}) as any;
   if(data?.validationBlocked===true)this.validationBlocked=true;
   if(Array.isArray(data?.contexts))for(const row of data.contexts.slice(0,16)){
    const bounded=(v:unknown,n:number)=>typeof v==='string'&&v.length>0&&v.length<=n&&!/[\x00-\x1f\x7f]/.test(v);
    if(!bounded(row?.runId,64)||!bounded(row.sessionId,128)||!bounded(row.connectionId,128)||!bounded(row.readerBuild,128)||!(bounded(row.generation,128)||Number.isSafeInteger(row.generation)&&row.generation>=0))continue;
    const identity=`${row.sessionId}/${row.connectionId}/${row.generation}/${row.readerBuild}`;
    let record=this.records.get(row.runId);
    if(!record&&this.records.size<64){
     const reference={runId:row.runId,sessionId:row.sessionId,connectionId:row.connectionId,generation:row.generation,readerBuild:row.readerBuild};
     record={reference,identity,used:true,active:0,closed:false};this.records.set(row.runId,record);
    }
    if(record?.identity===identity)this.observe(row.runId,row);
   }
  }catch{this.proofIdentity=null;}
  return this.view();
 }
 view(){
  const identity=this.identity(),current=!!identity&&identity===this.proofIdentity&&!this.validationBlocked;
  return {support:current?'supported':'unverified',scope:'context_created_only',wholeScriptProtected:false as const,inUse:current&&[...this.records.values()].some(r=>r.identity===identity&&r.active>0),earlierContexts:[...this.records.values()].filter(r=>(r.identity!==identity||!current)&&r.active>0).length,validationBlocked:this.validationBlocked,profileId:current?OWNED_UI_PROFILE.id:null};
 }
}
