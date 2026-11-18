import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {startService} from '../dist/service.js';
import {connectReader} from './client-fixture.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
const token='EXPLORER_MCP_SYNTHETIC_TOKEN_01234567890123456789';
async function port(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const n=server.address().port;await new Promise(r=>server.close(r));return n;}
test('AI uses typed shared MCP explorer tools, not browser automation or execute_luau',async()=>{
 await fs.mkdir('test/.tmp',{recursive:true});const temp=await fs.mkdtemp(path.resolve('test/.tmp/explorer-mcp-'));
 const apiPort=await port(),readerPort=await port(),service=await startService({port:readerPort,apiPort,token,tokenFile:'unused',tokenError:null,allowExec:true,protectionFile:temp+'/prefs.json'});
 const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/index.js'),'--shared'],env:{...process.env,VOLT_BRIDGE_TOKEN:token,RIFT_API_PORT:String(apiPort)},stderr:'pipe'}),client=new Client({name:'explorer-mcp-fixture',version:'1'},{capabilities:{}});let reader;const ops=[];
 try{
  reader=await connectReader({port:readerPort,token,build:service.status().build.expectedReaderBuild,capabilities:['explorer_v1','explorer_write_v1'],handler:({op,args})=>{ops.push(op);return {binding:args.binding,view:args.view,items:[{id:'object-1',name:'Fixture',className:'Folder'}],schemaVersion:1,status:op==='explorer_write'?'applied':undefined,requestId:args.requestId};}});
  await client.connect(transport);const catalog=await client.listTools();assert.ok(catalog.tools.find(t=>t.name==='explorer_read'));assert.ok(catalog.tools.find(t=>t.name==='explorer_write'));
  const binding={readerSession:reader.session,connectionId:service.bridge.reader.connectionId};
  const read=await client.callTool({name:'explorer_read',arguments:{binding,view:'roots'}});assert.equal(read.structuredContent.items[0].id,'object-1');
  const args={binding,target:{id:'object-1'},requestId:'ai-edit-0001',field:{kind:'property',name:'Name'},expected:{type:'string',value:'Fixture'},value:{type:'string',value:'Changed'},schemaVersion:1,confirm:true};
  const denied=await client.callTool({name:'explorer_write',arguments:{...args,confirm:false}});assert.equal(denied.isError,true);assert.deepEqual(ops,['explorer_read']);
  const receipt=await client.callTool({name:'explorer_write',arguments:args});assert.equal(receipt.structuredContent.status,'applied');assert.equal(receipt.structuredContent.requestId,args.requestId);
  assert.deepEqual(ops,['explorer_read','explorer_write']);assert.equal(reader.executions,0);
 }finally{await reader?.close();await client.close();await service.stop();}
});
