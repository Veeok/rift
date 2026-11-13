// Regression: omitting structuredContent makes OpenCode concatenate metadata JSON and Luau source.
// Only the external reader/cache is synthetic; production tool registration, paging and serialization run.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createCatalog} from '../dist/catalog.js';
import {startService} from '../dist/service.js';
import {LIMITS} from '../dist/limits.js';

const session='a1b2c3d4-0000-4000-8000-000000000001';
const script={id:'a1b2c3d4:fixture',name:'Synthetic',className:'LocalScript',path:'Synthetic/Fixture'};
async function read({lines=['-- synthetic\r','local value = "Ω"','return value',''],startLine=1,maxLines=100,truncated=false,lossy=false,job,connected=true}={}){
 const bridge={session:connected?session:null,reader:{session,connectionId:'fixture-connection',placeId:99,jobId:'fixture-place'},request:async op=>{
  assert.equal(op,'script_info');return {object:script,hash:'fixture-hash',decompileSupport:'supported'};
 }};
 const entry={key:'fixture-cache',session,lines,chars:lines.join('\n').length,hash:'fixture-hash',lossy,truncated,script,observedAt:'2026-11-12T00:00:00.000Z',storedAt:Date.now(),elapsedMs:7};
 const decompiler={lookup:()=>job?null:entry,start:()=>job,getJob:()=>job};
 const tool=createCatalog(bridge,decompiler,{isEnabled:false}).get('read_script');
 return tool.handler(tool.schema.parse({script:{id:script.id},...(job?{jobId:job.id}:{}),startLine,maxLines,waitMs:0}));
}
function checkContract(result,source){
 assert.equal(typeof result.structuredContent,'object','read_script must supply structuredContent before OpenCode joins text blocks');
 assert.ok(Object.hasOwn(result.structuredContent,'metadata'));assert.ok(Object.hasOwn(result.structuredContent,'sourceText'));
 assert.deepEqual(result.structuredContent.metadata,JSON.parse(result.content[0].text));
 for(const [key,value] of Object.entries(result.structuredContent.metadata))assert.deepEqual(result.structuredContent[key],value,'legacy metadata field '+key);
 assert.equal(result.structuredContent.sourceText,source);
 assert.deepEqual(result.content,source===null?[{type:'text',text:JSON.stringify(result.structuredContent.metadata)}]:[
  {type:'text',text:JSON.stringify(result.structuredContent.metadata)},{type:'text',text:source},
 ]);
 return result.structuredContent.metadata;
}

test('CM-01 complete pages separate metadata and exact source while preserving legacy blocks',async()=>{
 const result=await read();const meta=checkContract(result,'-- synthetic\r\nlocal value = "Ω"\nreturn value\n');
 assert.equal(meta.status,'complete');assert.deepEqual(meta.source,{startLine:1,endLine:4,totalLines:4,nextStartLine:null,truncatedByCharLimit:false,longLineTruncated:false});
 assert.equal(meta.hash,'fixture-hash');assert.equal(meta.observedAt,'2026-11-12T00:00:00.000Z');assert.equal(meta.session.readerSession,session);
});
test('CM-02 paged source retains the nested cursor and line boundaries',async()=>{
 const meta=checkContract(await read({startLine:2,maxLines:1}),'local value = "Ω"');
 assert.deepEqual(meta.source,{startLine:2,endLine:2,totalLines:4,nextStartLine:3,truncatedByCharLimit:false,longLineTruncated:false});
});
test('CM-03 actual empty source is not confused with an absent page',async()=>{
 const result=await read({lines:['']});const meta=checkContract(result,'');assert.equal(result.content.length,2);assert.equal(meta.source.nextStartLine,null);
});
test('CM-04 source truncation and lossy-text flags survive structured results',async()=>{
 const meta=checkContract(await read({lines:['clipped Ω'],truncated:true,lossy:true}),'clipped Ω');
 assert.equal(meta.partial,true);assert.equal(meta.partialReason,'source_limit');assert.equal(meta.sourceTruncated,true);assert.equal(meta.lossyText,true);
});
test('CM-05 long-line clipping preserves its separate indicator and exact displayed text',async()=>{
 const result=await read({lines:['x'.repeat(LIMITS.readScriptMaxChars+100)]});
 const meta=checkContract(result,result.content[1].text);assert.equal(meta.source.longLineTruncated,true);assert.equal(meta.partial,true);assert.equal(meta.partialReason,'long_line');assert.equal(meta.sourceTruncated,false);
 assert.match(result.structuredContent.sourceText,/^x+ --\[\[Rift: line truncated\]\]$/);assert.ok(result.structuredContent.sourceText.length<LIMITS.readScriptMaxChars);assert.equal(meta.source.responseBudgetLimited,true);assert.ok(Buffer.byteLength(JSON.stringify(result),'utf8')<=LIMITS.maxToolResponseChars);assert.equal(meta.source.truncatedByCharLimit,true);
});
test('M11 source pages bound the complete multibyte MCP envelope',async()=>{
 const result=await read({lines:['漢'.repeat(60000)]});
 assert.notEqual(result.isError,true);assert.ok(Buffer.byteLength(JSON.stringify(result),'utf8')<=LIMITS.maxToolResponseChars);
 const source=result.structuredContent.sourceText,meta=checkContract(result,source);assert.ok(source.length>0);assert.equal(meta.source.responseBudgetLimited,true);assert.equal(meta.partial,true);
});
test('CM-06 pending jobs carry metadata and null source without inventing an empty page',async()=>{
 const job={id:'fixture-job',session,status:'running',createdAt:Date.now(),script,done:new Promise(()=>{})};
 const meta=checkContract(await read({job}),null);assert.equal(meta.status,'pending');assert.equal(meta.jobId,'fixture-job');assert.equal(meta.pollAfterMs,3000);
});
test('CM-07 failed jobs retain isError, error details and legacy error text',async()=>{
 const job={id:'fixture-failed',session,status:'failed',createdAt:Date.now(),script,error:{code:'fixture_failed',message:'Synthetic decompiler failure',retryable:false},done:Promise.resolve()};
 const result=await read({job});const meta=checkContract(result,null);assert.equal(result.isError,true);assert.equal(meta.ok,false);assert.equal(meta.error.code,'fixture_failed');assert.equal(meta.error.message,'Synthetic decompiler failure');assert.equal(meta.jobId,'fixture-failed');
});
test('CM-08 disconnected reads retain their retryable error contract',async()=>{
 const result=await read({connected:false});const meta=checkContract(result,null);assert.equal(result.isError,true);assert.equal(meta.error.code,'not_connected');assert.equal(meta.error.retryable,true);
});
async function freePort(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
test('CM-09 shared-service guard errors expose the same structured fields without a reader',async()=>{
 const service=await startService({port:await freePort(),apiPort:await freePort(),token:'fixture-only-credential-00000000000000000000',tokenFile:'unused',tokenError:null,allowExec:false,logLevel:'error'});
 try{const result=await service.call('read_script',{script:{path:['Synthetic']}});const meta=checkContract(result,null);assert.equal(result.isError,true);assert.equal(meta.ok,false);assert.equal(meta.error.code,'operation_failed');assert.match(meta.error.message,/session|select/i);}finally{await service.stop();}
});
test('CM-10 character-limited pages retain their next cursor without becoming long-line truncation',async()=>{
 const first='x'.repeat(LIMITS.readScriptMaxChars/2-20);
 const meta=checkContract(await read({lines:[first,'y'.repeat(LIMITS.readScriptMaxChars)]}),first);
 assert.equal(meta.source.truncatedByCharLimit,true);assert.equal(meta.source.longLineTruncated,false);assert.equal(meta.source.nextStartLine,2);
});
test('CM-11 shared-adapter connection errors retain structured fields and isError',async()=>{
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),port=await freePort();
 const transport=new StdioClientTransport({command:process.execPath,args:[resolve(root,'dist/index.js'),'--shared'],cwd:root,env:{...process.env,VOLT_BRIDGE_TOKEN:'fixture-only-credential-00000000000000000000',RIFT_API_PORT:String(port)},stderr:'pipe'});
 const client=new Client({name:'isolated-contract-test',version:'1'},{capabilities:{}});
 try{await client.connect(transport);const result=await client.callTool({name:'read_script',arguments:{script:{path:['Synthetic']}}});const meta=checkContract(result,null);assert.equal(result.isError,true);assert.equal(meta.error.code,'service_unavailable');}finally{await client.close();}
});
test('CM-12 older Code Mode polling callers retain top-level status and jobId',async()=>{
 const job={id:'fixture-legacy-poll',session,status:'running',createdAt:Date.now(),script,done:new Promise(()=>{})};
 const result=await read({job});
 assert.equal(result.structuredContent.status,'pending');
 assert.equal(result.structuredContent.jobId,'fixture-legacy-poll');
 assert.equal(result.structuredContent.ok,true);
});
