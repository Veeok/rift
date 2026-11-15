// Actual host/MCP/WebSocket dispatch boundaries, with a synthetic reader only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {startService} from '../dist/service.js';
import {buildIdentity} from '../dist/build.js';
import {ProtectionStore} from '../dist/protection-store.js';
import {connectReader,until} from './client-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const token='M115_SYNTHETIC_READER_TOKEN_012345678901234567890';
const on={schemaVersion:1,preload:true,memory:false,virtual:false,unlocker:false};
const payload=r=>r.structuredContent??JSON.parse(r.content[0].text);
async function privatePackage(){
 await fs.mkdir(path.join(root,'test/.tmp'),{recursive:true});const dir=await fs.mkdtemp(path.join(root,'test/.tmp/m115-standalone-'));
 for(const name of ['dist','luau','package.json'])await fs.cp(path.join(root,name),path.join(dir,name),{recursive:true});
 await fs.symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'),'junction');return dir;
}
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;}
async function runContract(call,reader,file){
 let r=await call({source:'SYNTHETIC_ONLY_1',confirm:true});assert.equal(r.isError,true);assert.equal(reader.executions,0);
 assert.equal(payload(r).protection.mode,'refused');
 r=await call({source:'SYNTHETIC_ONLY_2',confirm:true,allowUnprotected:'true'});assert.equal(r.isError,true);assert.equal(reader.executions,0);
 r=await call({source:'SYNTHETIC_ONLY_3',confirm:true,allowUnprotected:true});assert.notEqual(r.isError,true);assert.equal(reader.executions,1);
 assert.equal(payload(r).protection.mode,'unprotected_override');const id=payload(r).runId;
 r=await call({source:'DIFFERENT_SYNTHETIC_SOURCE',confirm:true,allowUnprotected:true,runId:id});assert.equal(reader.executions,1);assert.equal(payload(r).duplicateOfPreviousRun,true);
 r=await call({source:'SYNTHETIC_ONLY_4',confirm:true});assert.equal(r.isError,true);assert.equal(reader.executions,1);
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).preload,true);
 await fs.writeFile(file,'{');r=await call({source:'SYNTHETIC_ONLY_5',confirm:true,allowUnprotected:true});
 assert.equal(r.isError,true);assert.equal(reader.executions,1);assert.equal(payload(r).protection.error.code,'invalid_preferences');
}
test('shared service dispatches 0/1/0 over a real socket for refused/explicit override/next refused',async()=>{
 await fs.mkdir('test/.tmp',{recursive:true});const dir=await fs.mkdtemp(path.resolve('test/.tmp/m115-wire-')),file=path.join(dir,'prefs.json');await fs.writeFile(file,JSON.stringify(on));
 const readerPort=await port(),service=await startService({port:readerPort,apiPort:await port(),token,tokenFile:'unused',tokenError:null,allowExec:true,logLevel:'error',protectionFile:file});let reader;
 try{
  reader=await connectReader({port:readerPort,token,build:service.status().build.expectedReaderBuild,capabilities:['exec','preload_supported_claim_is_not_proof'],handler:()=>({executed:true,compiled:true,ok:true,returns:[]})});
  await runContract(args=>service.call('execute_luau',args),reader,file);
 }finally{await reader?.close();await service.stop();}
});
test('standalone MCP uses the same persisted gate and cannot bypass it with a readiness claim',async()=>{
 const dir=await privatePackage(),file=path.join(dir,'.secrets/extra-protection.json');assert.notEqual(path.dirname(file),path.join(root,'.secrets'),'standalone fixture must not mutate shared package preferences');await fs.mkdir(path.dirname(file),{recursive:true});
 await fs.writeFile(file,JSON.stringify(on),{flag:'wx'});
 const readerPort=await port(),transport=new StdioClientTransport({command:process.execPath,args:[path.join(dir,'dist/index.js')],cwd:dir,stderr:'pipe',env:{...process.env,VOLT_BRIDGE_TOKEN:token,VOLT_BRIDGE_PORT:String(readerPort),VOLT_BRIDGE_ALLOW_EXEC:'1'}});
 const client=new Client({name:'m115-isolated-fixture',version:'1'},{capabilities:{}});let reader;
 try{
  await client.connect(transport);
  reader=await connectReader({port:readerPort,token,build:buildIdentity().expectedReaderBuild,capabilities:['exec','preload_supported_claim_is_not_proof'],handler:()=>({executed:true,compiled:true,ok:true,returns:[]})});
  await runContract(args=>client.callTool({name:'execute_luau',arguments:args}),reader,file);
 }finally{await reader?.close();await client.close();await fs.unlink(file);}
});
test('shared MCP stdio crosses authenticated HTTP before the synthetic reader and propagates cancellation',async()=>{
 const dir=await privatePackage(),file=path.join(dir,'prefs.json');await fs.writeFile(file,JSON.stringify(on));
 const readerPort=await port(),apiPort=await port(),service=await startService({port:readerPort,apiPort,token,tokenFile:'unused',tokenError:null,allowExec:true,logLevel:'error',protectionFile:file});
 const transport=new StdioClientTransport({command:process.execPath,args:[path.join(dir,'dist/index.js'),'--shared'],cwd:dir,stderr:'pipe',env:{...process.env,VOLT_BRIDGE_TOKEN:token,RIFT_API_PORT:String(apiPort)}});
 const client=new Client({name:'m115-shared-wire-fixture',version:'1'},{capabilities:{}});let reader,finish;
 const original=ProtectionStore.prototype.snapshot;
 try{
  reader=await connectReader({port:readerPort,token,build:service.status().build.expectedReaderBuild,handler:()=>({executed:true,compiled:true,ok:true,returns:[]})});
  await client.connect(transport);await runContract(args=>client.callTool({name:'execute_luau',arguments:args}),reader,file);
  ProtectionStore.prototype.snapshot=function(){return new Promise(r=>finish=r);};
  const abort=new AbortController();
  const pending=client.callTool({name:'execute_luau',arguments:{source:'CANCELLED_SYNTHETIC',confirm:true,allowUnprotected:true}},undefined,{signal:abort.signal});
  const cancelled=assert.rejects(pending);await until(()=>finish);abort.abort();await cancelled;
  await new Promise(r=>setTimeout(r,60));finish({preferences:{...on,preload:false},error:null});await new Promise(r=>setTimeout(r,60));
  assert.equal(reader.executions,1,'shared MCP cancellation allowed delayed dispatch');
 }finally{ProtectionStore.prototype.snapshot=original;finish?.({preferences:on,error:null});await reader?.close();await client.close();await service.stop();}
});
