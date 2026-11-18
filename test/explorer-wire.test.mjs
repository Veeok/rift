import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startService} from '../dist/service.js';
import {connectReader} from './client-fixture.mjs';
const token='EXPLORER_WIRE_SYNTHETIC_TOKEN_01234567890123456789';
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;}
test('fixed authenticated explorer routes share typed MCP operations while browser generic writes refuse',async()=>{
 await fs.mkdir('test/.tmp',{recursive:true});const temp=await fs.mkdtemp(path.resolve('test/.tmp/explorer-wire-'));
 const apiPort=await port(),readerPort=await port(),origin='http://127.0.0.1:'+apiPort;
 const service=await startService({port:readerPort,apiPort,token,tokenFile:'unused',tokenError:null,allowExec:true,protectionFile:temp+'/prefs.json'});let reader;const calls=[];
 try{
  reader=await connectReader({port:readerPort,token,build:service.status().build.expectedReaderBuild,capabilities:['explorer_v1','explorer_write_v1'],handler:message=>{calls.push(message);return {binding:message.args.binding,view:message.args.view,items:[],status:'applied',schemaVersion:1};}});
  const binding={readerSession:reader.session,connectionId:service.bridge.reader.connectionId};
  const headers={authorization:'Bearer '+token,'content-type':'application/json',origin};
  const read=await fetch(origin+'/api/explorer/read',{method:'POST',headers,body:JSON.stringify({binding,view:'roots'})});assert.equal(read.status,200);assert.equal((await read.json()).structuredContent.view,'roots');
  const args={binding,requestId:'browser-edit-1',target:{id:'fixture:1'},field:{kind:'property',name:'Name'},expected:{type:'string',value:'A'},value:{type:'string',value:'B'},schemaVersion:1,confirm:true};
  const noOrigin=await fetch(origin+'/api/explorer/write',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(args)});assert.equal(noOrigin.status,403);
  const generic=await fetch(origin+'/api/tools/explorer_write',{method:'POST',headers,body:JSON.stringify(args)});assert.equal(generic.status,403);
  const edit=await fetch(origin+'/api/explorer/write',{method:'POST',headers,body:JSON.stringify(args)});assert.equal(edit.status,200);assert.equal((await edit.json()).structuredContent.status,'applied');
  assert.deepEqual(calls.map(c=>c.op),['explorer_read','explorer_write']);assert.equal(reader.executions,0);
  const audit=service.activity.feed({sessionId:reader.session});assert.ok(audit.items.some(row=>row.source==='explorer_edit'&&row.details.requestId==='browser-edit-1'&&row.details.status==='applied'),'confirmed edit audit receipt missing');
  const bad=await service.call('explorer_write',{...args,source:'arbitrary'});assert.equal(bad.isError,true);assert.equal(calls.length,2);
 }finally{await reader?.close();await service.stop();}
});
