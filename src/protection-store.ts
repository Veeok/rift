import fs from 'node:fs/promises';
import {dirname} from 'node:path';
import {loadProtectionPreferences,saveProtectionPreferences,protectionPreferencesSchema,type Preferences,type ProtectionError} from './protection-policy.js';

export type ProtectionSnapshot={preferences:Preferences;error:ProtectionError|null};
export interface ProtectionSnapshotProvider {snapshot():Promise<ProtectionSnapshot>}
const off=():Preferences=>({schemaVersion:1,preload:false,memory:false,virtual:false,unlocker:false});
const busy=(code:'read_failed'|'write_failed'):ProtectionError=>({code,message:'Protection preferences are busy; retry later.',retryable:true});

// Invocation order is local to this store. Atomic replacement handles complete
// snapshots from other writers; this is not cross-process locking.
export class ProtectionStore implements ProtectionSnapshotProvider {
 private tail=Promise.resolve();
 private pending=0;
 constructor(private readonly filePath:string){}
 private enqueue<T>(operation:()=>Promise<T>):Promise<T>{
  this.pending++;
  const current=this.tail.then(operation);
  this.tail=current.then(()=>undefined,()=>undefined);
  return current.finally(()=>{this.pending--;});
 }
 snapshot():Promise<ProtectionSnapshot>{
  if(this.pending>=16)return Promise.resolve({preferences:off(),error:busy('read_failed')});
  return this.enqueue(()=>loadProtectionPreferences(this.filePath));
 }
 async save(input:unknown){
  const parsed=protectionPreferencesSchema.safeParse(input);
  if(!parsed.success)return {ok:false as const,error:{code:'invalid_preferences' as const,message:'Invalid preferences',retryable:false}};
  if(this.pending>=16)return {ok:false as const,error:busy('write_failed')};
  return this.enqueue(async()=>{
   try{await fs.mkdir(dirname(this.filePath),{recursive:true});}
   catch{return {ok:false as const,error:{code:'write_failed' as const,message:'Unable to prepare protection preferences',retryable:true}};}
   return saveProtectionPreferences(this.filePath,parsed.data);
  });
 }
}

export function protectionView(snapshot:ProtectionSnapshot,scoped?:{support:string;inUse:boolean;scope:string;wholeScriptProtected:false;validationBlocked:boolean;profileId:string|null;earlierContexts?:number}){
 return {...snapshot,runtime:{
  preload:{requested:snapshot.error?null:snapshot.preferences.preload,state:snapshot.error||scoped?.validationBlocked?'Error':scoped?.inUse?'In use':snapshot.preferences.preload?(scoped?.support==='supported'?'Ready for supported UI':'Unverified'):'Off',support:scoped?.support??'unverified',inUse:scoped?.inUse??false,
   scope:scoped?.scope??'context_created_only',wholeScriptProtected:false,profileId:scoped?.profileId??null,earlierContexts:scoped?.earlierContexts??0,
   notice:'Only reviewed factory-created resources are covered. Arbitrary scripts and prior asset history are not protected; older resources are not moved by preference changes.'},
  memory:{state:'Unavailable',inUse:false},virtual:{state:'Unavailable',inUse:false},unlocker:{state:'Unavailable',inUse:false},
 }};
}
