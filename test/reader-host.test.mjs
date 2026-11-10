// Real rendered reader through Lune, real WebSocket bridge and the normal shared service.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {startService} from '../dist/service.js';
import {startMockVolt} from './lib.mjs';
import {until} from './client-fixture.mjs';
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const parse=result=>JSON.parse(result.content[0].text);
test('M9-12 actual reader template streams delayed output through versioned WebSocket frames to source trace',async()=>{
 const token='reader-host-credential-000000000000000000000',readerPort=await port(),svc=await startService({port:readerPort,apiPort:await port(),token,tokenFile:'unused',tokenError:null,allowExec:true});let reader;
 const source='task.delay(0.2, function()\n    warn("WIRE_DELAYED_MARKER")\nend)\nprint("WIRE_RETURNED_MARKER")\nreturn "scheduled"';
 try{reader=await startMockVolt({ctrlPort:await port(),bridgePort:readerPort,token,runtimeConfig:{token,port:readerPort,allowExec:true}});await until(()=>svc.status().session,10000);assert.ok(svc.status().capabilities.includes('exec_output_v1'),'actual reader must report verified capture');const result=parse(await svc.call('execute_luau',{source,confirm:true,deadlineMs:10000}));assert.equal(result.output,'WIRE_RETURNED_MARKER');assert.equal(result.status,'completed');const returnedAt=Date.now();await until(()=>svc.activity.feed({sessionId:svc.status().session.id}).items.some(row=>row.message==='WIRE_DELAYED_MARKER'),5000);const rows=parse(await svc.call('get_logs',{})).items,late=rows.find(row=>row.message==='WIRE_DELAYED_MARKER');assert.equal(late.runId,result.runId);assert.equal(late.attribution,'run');assert.ok(Date.parse(late.receivedAt)>returnedAt,'late output must arrive after the tool returned');const found=parse(await svc.call('search_source',{query:'WIRE_DELAYED_MARKER'}));const hit=found.items.find(item=>item.scriptId==='exec:'+result.runId);assert.ok(hit,'approved execution text must be searchable');assert.equal(hit.line,2);assert.equal(hit.sourceKind,'provided_execution');assert.equal(hit.revision,createHash('sha256').update(source).digest('hex'));const read=await svc.call('read_script',{script:{id:hit.scriptId},startLine:hit.line,maxLines:1});assert.match(read.content[1].text,/warn\("WIRE_DELAYED_MARKER"\)/);}finally{await reader?.stop();await svc.stop();}
});
