// Maintained regression cases for Phase 3 refinement. No AI calls or live game mutation.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Bridge } from '../dist/bridge.js';
import { DecompileService, cacheKey, pageSource } from '../dist/decompile.js';
import { CATALOG } from './catalog.mjs';
import * as harness from './lib.mjs';
import { Recorder, ROOT, sleep, stubReader, waitFor, startBridge, startMockVolt, testToken } from './lib.mjs';

const rec = new Recorder('refinement', CATALOG);
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const run = (id, fn) => !filter || filter.test(id) ? rec.run(id,fn) : null;
const token = 'refinement-local-token-000000000000000000000';

await run('AUTH-11', async check => {
 const bridge = new Bridge(38971,token,null); bridge.start();
 const readers=[];
 try {
  await waitFor(()=>bridge.status().listener.state==='listening',3000);
  const a=stubReader({port:38971,token,session:'aaaaaaaa-1111-4111-8111-111111111111'}); readers.push(a); await a.waitAuth(); a.autoPong=false;
  const b=stubReader({port:38971,token,session:'bbbbbbbb-1111-4111-8111-111111111111'});
  const c=stubReader({port:38971,token,session:'cccccccc-1111-4111-8111-111111111111'}); readers.push(b,c);
  await Promise.all([b.waitAuth(10000),c.waitAuth(10000)]);
  const accepted=[b,c].filter(r=>r.authOk && !r.closed);
  check('only one competing reader received auth_ok', [b,c].filter(r=>r.authOk).length===1, [b,c].map(r=>({auth:r.authOk,fail:r.authFail,close:r.closed})));
  check('exactly one active transport',accepted.length===1,accepted.length);
  return {actual:{accepted:accepted.map(r=>r.session),active:bridge.session}};
 } finally {readers.forEach(r=>r.ws.terminate());await bridge.stop();}
});
await run('AUTH-12',async check=>{
 const bridge = new Bridge(38971,token,null);bridge.start();
 try {
  await waitFor(()=>bridge.status().listener.state==='listening',3000);
  const r=stubReader({port:38971,token,headers:{Origin:'null'}});await r.waitAuth();
  check('opaque Origin rejected before authentication',!r.authOk && r.closed?.code===1008,{auth:r.authOk,close:r.closed});
  r.ws.terminate();return {actual:{close:r.closed,authenticated:!!r.authOk}};
 }finally{await bridge.stop();}
});
await run('CAC-12',async check=>{
 const bridge={session:'session',onSessionChange(){},async request(){return {source:'return "new"',hash:'NEW'};}};
 const service=new DecompileService(bridge);
 const info={object:{id:'session:1',name:'Mod',className:'ModuleScript',path:'game.Mod'},hash:'OLD',decompileSupport:'supported'};
 const job=service.start('session',info);await job.done;
 check('changed hash produces a retryable job failure',job.status==='failed' && job.error?.code==='bytecode_changed' && job.error?.retryable===true,{status:job.status,error:job.error});
 check('no source cached under stale hash',service.lookup(cacheKey('session',info))===null);
 return {actual:{status:job.status,error:job.error}};
});
await run('DEC-11',async check=>{
 const {file}=testToken();const b=await startBridge({port:38972,tokenFile:file});const tk=readFileSync(file,'utf8').trim();
 const r=stubReader({port:38972,token:tk,onReq:(m,s)=>{
  if(m.op==='script_info')s.reply(m.id,{object:{id:'a1b2c3d4:1',name:'M',className:'ModuleScript',path:'game.M'},hash:'h',decompileSupport:'supported'});
  else if(m.op==='decompile')s.reply(m.id,{source:'-- prefix',hash:'h',truncated:true,observedAt:new Date().toISOString()});
  else s.reply(m.id,{});
 }});
 try{
  await r.waitAuth();const result=await b.call('read_script',{script:{id:'a1b2c3d4:1'}});
  check('native source limit is disclosed',result.json?.partial===true && result.json?.partialReason==='source_limit' && result.json?.sourceTruncated===true,result.json);
  const cached=await b.call('read_script',{script:{id:'a1b2c3d4:1'}});
  check('cache retains disclosure',cached.json?.cache?.hit && cached.json?.sourceTruncated===true,cached.json);
  return {actual:{partial:result.json?.partial,sourceTruncated:cached.json?.sourceTruncated}};
 }finally{r.ws.terminate();await b.stop();}
});
await run('AST-11',async check=>{
 const {file,token:tk}=testToken();const b=await startBridge({port:38972,tokenFile:file});
 const r=stubReader({port:38972,token:tk,onReq:(m,s)=>s.reply(m.id,{items:Array.from({length:200},(_,i)=>({id:i,name:'x'.repeat(1000)})),offset:0,total:200,hasMore:false})});
 try{
  await r.waitAuth();const result=await b.call('list_children',{limit:200});
  check('trimmed last page still hasMore',result.json?.hasMore===true && result.json?.nextOffset===result.json?.items?.length,result.json && {hasMore:result.json.hasMore,items:result.json.items?.length,nextOffset:result.json.nextOffset});
  return {actual:{hasMore:result.json?.hasMore,nextOffset:result.json?.nextOffset}};
 }finally{r.ws.terminate();await b.stop();}
});
await run('OBJ-11',async check=>{
 const {file,token:tk}=testToken();const b=await startBridge({port:38972,tokenFile:file});
 const mv=await startMockVolt({ctrlPort:38973,bridgePort:38972,token:tk});
 try{
  await waitFor(async()=> (await b.status()).connected,15000);
  const result=await b.call('search_instances',{root:{path:['Workspace','Deep']},name:'Bottom',maxDepth:2});
  check('pruned descendants disclosed',result.json?.partial===true && result.json?.partialReason==='max_depth',result.json);
  const leaf=await b.call('search_instances',{root:{path:['Workspace','Many']},name:'nonexistent',maxDepth:1});
  check('leaf-only frontier is complete',leaf.json?.partial===false,leaf.json);
  return {actual:{partial:result.json?.partial,reason:result.json?.partialReason,leafPartial:leaf.json?.partial}};
 }finally{await mv.stop();await b.stop();}
});
await run('GEN-11',async check=>{
 check('shared lock implemented',typeof harness.acquireGenerationLock==='function');
 if(typeof harness.acquireGenerationLock!=='function')return {actual:'No shared generation lock in either runner'};
 const path=join(harness.TMP,`refinement-lock-${process.pid}`);
 const release=harness.acquireGenerationLock(path);
 try{
  let refused=false;try{harness.acquireGenerationLock(path);}catch(e){refused=/generation.*active/i.test(e.message);}
  check('second generation fails before any AI call',refused);
 }finally{release();}
 const releaseAgain=harness.acquireGenerationLock(path);releaseAgain();
 check('lock reusable after release',true);
 const sharedRelease=harness.acquireGenerationLock();
 try {
  for (const args of [['test/run-gen.mjs'],['test/run-live.mjs','gen','L1']]) {
   const child=spawnSync(process.execPath,args,{cwd:ROOT,encoding:'utf8',timeout:10000});
   check(`${args[0]} refuses overlap before model/network work`,child.status!==0 && /Another generation run is active/.test(child.stderr),{exit:child.status,error:child.error?.message,stderr:child.stderr?.slice(0,350)});
  }
 }finally{sharedRelease();}
 return {actual:'Exclusive filesystem lease checked and reusable'};
});
const file=rec.save();console.log('results:',file);process.exit(rec.results.some(r=>r.status!=='pass')?1:0);
