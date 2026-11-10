// Real host/socket boundaries; these fixtures do not claim actual reader compatibility.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {startService} from '../dist/service.js';
import {ExecService} from '../dist/exec.js';
import {LIMITS} from '../dist/limits.js';
import {connectReader,until} from './client-fixture.mjs';
const token='exec-output-fixture-token-000000000000000000';
const source='task.delay(2, function()\n    warn("DELAYED_SOURCE_MARKER")\nend)\nreturn "scheduled"';
const parsed=result=>JSON.parse(result.content[0].text);
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const outcome={executed:true,compiled:true,ok:true,output:'',returns:['scheduled'],capture:'print+warn',environment:'setfenv'};
async function fixture(options={}){
 const readerPort=await port(),svc=await startService({port:readerPort,apiPort:await port(),token,tokenFile:'unused',tokenError:null,allowExec:true});let reader;
 const send=frame=>reader.ws.send(JSON.stringify({v:1,type:'log',...frame}));
 const connect=(extra={})=>connectReader({port:readerPort,token,build:svc.status().build.expectedReaderBuild,capabilities:['exec','exec_output_v1'],handler:m=>m.op==='exec'?outcome:m.op==='list_scripts'?{items:[],total:0,hasMore:false,cache:{builtObservedAt:'empty-inventory'}}:{},...extra});
 reader=await connect(options);return{svc,send,connect,get reader(){return reader;},set reader(value){reader=value;},async close(){await reader?.close();await svc.stop();}};
}
test('M9-09 delayed execution frames retain explicit known run attribution after return',async()=>{
 const f=await fixture();try{const result=parsed(await f.svc.call('execute_luau',{source,confirm:true}));assert.equal(result.status,'completed');f.send({producer:'exec_capture',runId:result.runId,level:'warn',message:'DELAYED_SOURCE_MARKER'});await until(()=>f.svc.status().activity.lastSequence===1);const row=parsed(await f.svc.call('get_logs',{})).items[0];assert.equal(row.runId,result.runId);assert.equal(row.attribution,'run');assert.equal(row.source,'provided_execution');assert.equal(row.severity,'warn');assert.equal(row.details.sourceId,'exec:'+result.runId);assert.equal(row.details.revision,createHash('sha256').update(source).digest('hex'));assert.match(row.details.outputSourceVerification,/native.*unverified/i);}finally{await f.close();}
});
test('M9-10 forged unknown-run and unsupported producer claims never gain run attribution',async()=>{
 const f=await fixture();try{const run=parsed(await f.svc.call('execute_luau',{source,confirm:true}));for(const frame of[{producer:'exec_capture',runId:'not-a-known-run'},{producer:'native_console',runId:run.runId}])f.send({...frame,level:'warn',message:'unverified producer'});await until(()=>f.svc.status().activity.lastSequence===2);const rows=parsed(await f.svc.call('get_logs',{})).items;assert.ok(rows.every(row=>row.runId===null&&row.attribution!=='run'));}finally{await f.close();}
 const legacy=await fixture({capabilities:['exec']});try{const run=parsed(await legacy.svc.call('execute_luau',{source,confirm:true}));legacy.send({producer:'exec_capture',runId:run.runId,message:'unsupported capture'});await until(()=>legacy.svc.status().activity.lastSequence===1);assert.equal(parsed(await legacy.svc.call('get_logs',{})).items[0].runId,null);}finally{await legacy.close();}
});
test('M10-07 literal search and read trace only approved execution input with exact revision and line',async()=>{
 let decompiles=0;const f=await fixture({handler:m=>{if(m.op==='exec')return outcome;if(m.op==='decompile'){decompiles++;throw new Error('must not reconstruct execution input');}if(m.op==='list_scripts')return{items:[],total:0,hasMore:false,cache:{builtObservedAt:'empty'}};return{};}});
 try{assert.equal((await f.svc.call('execute_luau',{source:source+'\n-- rejected input',confirm:false})).isError,true);const run=parsed(await f.svc.call('execute_luau',{source,confirm:true}));const found=parsed(await f.svc.call('search_source',{query:'DELAYED_SOURCE_MARKER'}));assert.equal(found.items.length,1);const hit=found.items[0];assert.equal(hit.scriptId,'exec:'+run.runId);assert.equal(hit.line,2);assert.equal(hit.sourceKind,'provided_execution');assert.equal(hit.freshness,'approved_input');assert.equal(hit.revision,createHash('sha256').update(source).digest('hex'));const read=await f.svc.call('read_script',{script:{id:hit.scriptId},startLine:2,maxLines:1});assert.notEqual(read.isError,true);const metadata=parsed(read);assert.equal(metadata.sourceKind,'provided_execution');assert.equal(metadata.revision,hit.revision);assert.equal(metadata.startLine,2);assert.match(read.content[1].text,/warn\("DELAYED_SOURCE_MARKER"\)/);assert.equal(parsed(await f.svc.call('search_source',{query:'rejected input'})).items.length,0);assert.equal(decompiles,0);}finally{await f.close();}
});
test('M10-08 same reader session on a new connection cannot reuse old execution source or attribution',async()=>{
 const f=await fixture({session:'same-reader-session'});try{const run=parsed(await f.svc.call('execute_luau',{source,confirm:true}));await f.reader.close();await until(()=>!f.svc.status().session);f.reader=await f.connect({session:'same-reader-session'});f.send({producer:'exec_capture',runId:run.runId,message:'old execution on new socket'});await until(()=>f.svc.status().activity.lastSequence===1);assert.equal(parsed(await f.svc.call('get_logs',{})).items[0].runId,null);assert.equal(parsed(await f.svc.call('search_source',{query:'DELAYED_SOURCE_MARKER'})).items.length,0);assert.equal((await f.svc.call('read_script',{script:{id:'exec:'+run.runId}})).isError,true);}finally{await f.close();}
});
test('M9-11 immediate execution frames are associated before response and preserve reader truncation/redaction',async()=>{
 let send;const f=await fixture({handler:m=>{if(m.op==='exec'){send({producer:'exec_capture',runId:m.args.runId,level:'warn',message:token+' bounded message',truncated:true});return outcome;}if(m.op==='list_scripts')return{items:[],total:0,hasMore:false,cache:{builtObservedAt:'empty'}};return{};}});send=f.send;
 try{const result=parsed(await f.svc.call('execute_luau',{source,confirm:true}));await until(()=>f.svc.status().activity.lastSequence===1);const row=parsed(await f.svc.call('get_logs',{})).items[0];assert.equal(row.runId,result.runId);assert.equal(row.truncated,true);assert.ok(row.message.startsWith('[REDACTED]'));assert.equal(row.details.readerTruncated,true);assert.ok(!JSON.stringify(row).includes(token));}finally{await f.close();}
});
test('approved execution source pages are bounded without hiding client-source coverage gaps',async()=>{
 const f=await fixture({handler:m=>m.op==='exec'?outcome:m.op==='list_scripts'?{items:[{id:'fixture:missing',name:'Missing',path:'PlayerScripts/Missing'}],total:1,hasMore:false,cache:{builtObservedAt:'one'}}:{}});
 try{const long='x'.repeat(70000)+'\nreturn 1';const run=parsed(await f.svc.call('execute_luau',{source:long,confirm:true}));const found=parsed(await f.svc.call('search_source',{query:'return 1'}));assert.equal(found.items[0].line,2);assert.equal(found.coverage.missingSource,1);assert.equal(found.partial,true);const read=await f.svc.call('read_script',{script:{id:'exec:'+run.runId},startLine:1,maxLines:2});assert.notEqual(read.isError,true);assert.equal(parsed(read).longLineTruncated,true);assert.ok(read.content[1].text.length<61000);}finally{await f.close();}
});
test('approved execution source reads disclose credential redaction without changing the retained revision',async()=>{
 const f=await fixture();try{const input='print("'+token+'")';const run=parsed(await f.svc.call('execute_luau',{source:input,confirm:true}));const read=await f.svc.call('read_script',{script:{id:'exec:'+run.runId}}),meta=parsed(read);assert.equal(meta.revision,createHash('sha256').update(input).digest('hex'));assert.equal(meta.contentRedacted,true);assert.match(read.content[1].text,/\[REDACTED\]/);assert.ok(!JSON.stringify(read).includes(token));}finally{await f.close();}
});
test('provided-source page redacts a complete credential before the long-line boundary',async()=>{
 const f=await fixture();try{const input='--'+'a'.repeat(59988)+token;const run=parsed(await f.svc.call('execute_luau',{source:input,confirm:true}));const read=await f.svc.call('read_script',{script:{id:'exec:'+run.runId},startLine:1,maxLines:1}),meta=parsed(read);assert.notEqual(read.isError,true);assert.ok(!read.content[1].text.includes(token.slice(0,10)),'page leaked credential prefix');assert.match(read.content[1].text,/\[REDACTED\]/);assert.equal(meta.contentRedacted,true);assert.equal(meta.revision,createHash('sha256').update(input).digest('hex'));assert.equal(meta.totalLines,1);}finally{await f.close();}
});
test('provided-source search redacts before excerpt end and retains submitted revision',async()=>{
 const f=await fixture();try{const input='--MARK '+'a'.repeat(220)+token;const run=parsed(await f.svc.call('execute_luau',{source:input,confirm:true}));const found=parsed(await f.svc.call('search_source',{query:'MARK'})),hit=found.items.find(row=>row.scriptId==='exec:'+run.runId);assert.ok(hit,'non-secret marker must remain searchable');assert.ok(!hit.excerpt.includes(token.slice(0,10)),'excerpt leaked credential prefix');assert.match(hit.excerpt,/\[REDACTED\]/);assert.equal(hit.contentRedacted,true);assert.equal(hit.revision,createHash('sha256').update(input).digest('hex'));assert.equal(hit.line,1);}finally{await f.close();}
});
test('provided-source search redacts before excerpt start can expose a credential suffix',async()=>{
 const f=await fixture();try{const input='--'+token+' MARK';const run=parsed(await f.svc.call('execute_luau',{source:input,confirm:true}));const found=parsed(await f.svc.call('search_source',{query:'MARK'})),hit=found.items.find(row=>row.scriptId==='exec:'+run.runId);assert.ok(hit,'non-secret marker must remain searchable');assert.ok(!hit.excerpt.includes(token.slice(-10)),'excerpt leaked credential suffix');assert.match(hit.excerpt,/\[REDACTED\]/);assert.equal(hit.contentRedacted,true);assert.equal(hit.revision,createHash('sha256').update(input).digest('hex'));assert.equal(hit.line,1);}finally{await f.close();}
});
test('approved execution source retention is bounded and duplicates never replace input',async()=>{
 const reader={session:'retention-reader',connectionId:'c1',placeId:0,jobId:'fixture',capabilities:['exec']},service=new ExecService({reader,request:async()=>outcome},true);const first=await service.run('return "first"',{confirm:true});await service.run('return "replaced"',{runId:first.runId,confirm:true});assert.equal(service.sourceEntries(reader.session,reader.connectionId)[0].source,'return "first"');for(let n=0;n<LIMITS.execMaxRetainedResults+2;n++)await service.run('return '+n,{confirm:true});const records=service.sourceEntries(reader.session,reader.connectionId);assert.ok(records.length<=LIMITS.execMaxRetainedResults);assert.ok(!records.some(r=>r.runId===first.runId));assert.equal(service.sourceEntries(reader.session,'different-connection').length,0);
});
