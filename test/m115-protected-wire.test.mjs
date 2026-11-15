import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {startService} from '../dist/service.js';
import {OWNED_UI_EXAMPLE} from '../dist/owned-ui-runtime.js';
import {connectReader} from './client-fixture.mjs';
const token='OWNED_UI_SYNTHETIC_ONLY_TOKEN_01234567890123456789';
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;}
test('scoped example traverses shared MCP, HTTP, nonce preparation and reader socket; browser cannot close it',async()=>{
 await fs.mkdir('test/.tmp',{recursive:true});const dir=await fs.mkdtemp(path.resolve('test/.tmp/owned-wire-'));
 for(const name of ['dist','luau','package.json'])await fs.cp(name,path.join(dir,name),{recursive:true});await fs.symlink(path.resolve('node_modules'),path.join(dir,'node_modules'),'junction');
 const file=path.join(dir,'preferences.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,preload:true,memory:false,virtual:false,unlocker:false}));
 const readerPort=await port(),apiPort=await port(),url='http://127.0.0.1:'+apiPort;
 const service=await startService({port:readerPort,apiPort,token,tokenFile:'unused',tokenError:null,allowExec:true,logLevel:'error',protectionFile:file});
 const transport=new StdioClientTransport({command:process.execPath,args:[path.join(dir,'dist/index.js'),'--shared'],cwd:dir,stderr:'pipe',env:{...process.env,VOLT_BRIDGE_TOKEN:token,RIFT_API_PORT:String(apiPort)}});
 const client=new Client({name:'owned-ui-wire-fixture',version:'1'},{capabilities:{}});let reader,policy,runId,active=0;
 try{
   reader=await connectReader({port:readerPort,token,build:service.status().build.expectedReaderBuild,capabilities:['exec','owned_ui_v1'],handler:({op,args})=>{
   if(op==='owned_ui_prepare'){policy={...args};return {...args,readerBuild:service.bridge.reader.readerBuild,scope:'context_created_only',wholeScriptProtected:false,validation:{status:'observed_exclusion',checksPassed:true,created:10,destroyed:10,retainedOwned:0,unknownOwned:false,deferred:false}};}
   if(op==='exec'){assert.equal(args.policy.nonce,policy.nonce);assert.equal(args.source,OWNED_UI_EXAMPLE);runId=args.runId;active=3;return {executed:true,compiled:true,ok:true,returns:[],ownedUi:{runId,state:'open',active,created:3,residualFailedCreates:0}};}
   if(op==='owned_ui_close'){assert.equal(args.nonce,policy.nonce);active=0;return {runId,state:'closed',active:0,created:3,destroyed:3,retainedOwned:0,residualFailedCreates:0};}
   if(op==='owned_ui_status'){const r=service.bridge.reader;return {validationBlocked:false,contexts:[{runId,sessionId:r.session,connectionId:r.connectionId,generation:r.generation,readerBuild:r.readerBuild,current:true,state:active?'claimed':'closed',active,created:3,destroyed:active?0:3,retainedOwned:0,residualFailedCreates:0}]};}
   throw new Error('Unexpected fixture operation '+op);
  }});
  await client.connect(transport);const response=await client.callTool({name:'execute_luau',arguments:{source:OWNED_UI_EXAMPLE,confirm:true}});
   const data=response.structuredContent??JSON.parse(response.content[0].text);assert.equal(data.protection.mode,'protected',JSON.stringify(data));assert.equal(data.protection.wholeScriptProtected,false);assert.equal(reader.executions,1);
  const status=await(await fetch(url+'/api/protection',{headers:{authorization:'Bearer '+token}})).json();assert.equal(status.runtime.preload.inUse,true);assert.equal(status.runtime.preload.scope,'context_created_only');
  const forbidden=await fetch(url+'/api/tools/close_owned_ui',{method:'POST',headers:{origin:url,authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({runId,confirm:true})});assert.equal(forbidden.status,403);assert.equal(active,3);
  const closed=await client.callTool({name:'close_owned_ui',arguments:{runId,confirm:true}});assert.notEqual(closed.isError,true);assert.equal(active,0);
 }finally{await reader?.close();await client.close();await service.stop();}
});
