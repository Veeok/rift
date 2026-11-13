// Lead-owned integration checks; external reader is synthetic, normal catalog/service/schema run.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {createCatalog} from '../dist/catalog.js';
import {startService} from '../dist/service.js';
import {connectReader} from './client-fixture.mjs';

const token='m11-integration-synthetic-credential-00000000';
const session='a11b22c3-0000-4000-8000-000000000001';
const object={t:'Instance',id:'a11b22c3:1',name:'Duplicate.Name',className:'Folder',path:'game.Workspace["Duplicate.Name"]'};
const payload={observedAt:'2026-11-13T00:00:00.000Z',items:[{object,depth:0,properties:{Name:'Duplicate.Name',Position:{t:'Vector3',x:1,y:2,z:3}}}],visited:1,returned:1,hasMore:false,partial:false,limitsReached:[]};
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
function core(capabilities=['inspection_v1']){const calls=[];const bridge={session,reader:{session,connectionId:'fixture-c1',placeId:0,jobId:'fixture',capabilities},request:async(op,args)=>{calls.push({op,args});return payload;}};return {calls,catalog:createCatalog(bridge,{},{isEnabled:false})};}

test('M11-N01 registry exposes bounded native operations and validates richer-only queries',async()=>{
 const f=core();for(const name of ['get_subtree','inspect_instances'])assert.ok(f.catalog.has(name),'Missing M11 tool '+name);
 const search=f.catalog.get('search_instances');const args=search.schema.parse({tags:{all:['M11']},maxVisited:5});
 const result=await search.handler(args);assert.notEqual(result.isError,true);assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.tags.all[0],'M11');
});
test('M11-N01 unsupported old reader returns an actionable capability error without traversal',async()=>{
 const f=core([]);const tool=f.catalog.get('get_subtree');assert.ok(tool,'Missing get_subtree registration');
 const result=await tool.handler(tool.schema.parse({target:{path:['Workspace']}}));
 assert.equal(result.isError,true);assert.equal(f.calls.length,0);assert.match(JSON.stringify(result),/inspection_v1|reader.*updat|unsupported/i);
});
test('M11-N02 shared service HTTP carries structured identity and isolated item errors',async()=>{
 const readerPort=await port(),svc=await startService({port:readerPort,apiPort:await port(),token,tokenFile:'unused',tokenError:null,allowExec:false,logLevel:'error'});let reader;
 try{
  reader=await connectReader({port:readerPort,token,session,build:svc.status().build.expectedReaderBuild,capabilities:['inspection_v1'],handler:()=>({...payload,items:[{index:0,object,properties:{Name:'Duplicate.Name'}},{index:1,error:{code:'not_found',message:'streamed out'}}],partial:true,partialReason:'item_errors'})});
  const response=await fetch(`http://127.0.0.1:${svc.apiPort}/api/tools/inspect_instances`,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({targets:[{id:object.id},{path:['Workspace','Missing']}],properties:['Name']})});
  assert.equal(response.status,200);const result=await response.json();assert.notEqual(result.isError,true,JSON.stringify(result));
  const decoded=result.structuredContent;assert.ok(decoded,'Missing structuredContent');assert.equal(decoded.items.length,2);assert.equal(decoded.items[1].error.code,'not_found');assert.equal(decoded.partial,true);
  assert.equal(decoded.session.readerSession,session);assert.equal(decoded.items[0].properties.Name,'Duplicate.Name');
  assert.ok(svc.catalog.has('discover_source'));assert.ok(svc.catalog.has('get_source_excerpt'));
 }finally{await reader?.close();await svc.stop();}
});

test('M11 search bounds the complete UTF-8 envelope to the requested budget',async()=>{
 const bridge={session,reader:{session,connectionId:'c1',capabilities:['inspection_v1']},request:async()=>({...payload,offset:0,items:Array.from({length:10},(_,i)=>({id:'a11b22c3:'+i,name:'漢'.repeat(90)}))})};
 const search=createCatalog(bridge,{},{isEnabled:false}).get('search_instances');
 const result=await search.handler(search.schema.parse({name:'漢',maxResponseChars:2048}));
 assert.notEqual(result.isError,true);assert.ok(Buffer.byteLength(JSON.stringify(result),'utf8')<=2048);
 const data=result.structuredContent;assert.ok(data.items.length>0&&data.items.length<10);assert.equal(data.nextOffset,data.items.length);assert.equal(data.partial,true);
});

test('M11 richer search rejects a response from a reconnected reader',async()=>{
 const bridge={session,reader:{session,connectionId:'c1',capabilities:['inspection_v1']},request:async()=>{bridge.reader={...bridge.reader,connectionId:'c2'};return payload;}};
 const tool=createCatalog(bridge,{},{isEnabled:false}).get('search_instances');
 const result=await tool.handler(tool.schema.parse({visible:true}));
 assert.equal(result.isError,true);assert.equal(result.structuredContent.error.code,'stale_session');
});

test('M11 discovery budgets its complete shared envelope without losing coverage or cursor',async()=>{
 const readerPort=await port(),svc=await startService({port:readerPort,apiPort:await port(),token,tokenFile:'unused',tokenError:null,allowExec:false,logLevel:'error'});let reader;
 try{
  const rows=Array.from({length:10},(_,i)=>({id:'a11b22c3:s'+i,name:'漢'.repeat(90)+i,className:'LocalScript',path:'game.Workspace.'+i}));
  reader=await connectReader({port:readerPort,token,session,build:svc.status().build.expectedReaderBuild,capabilities:['inspection_v1','getscripts'],handler:({op})=>{assert.equal(op,'list_scripts');return {items:rows,total:10,hasMore:false,cache:{builtObservedAt:'fixed-inventory'}};}});
  const result=await svc.call('discover_source',{maxResponseChars:4000});
  assert.notEqual(result.isError,true,JSON.stringify(result));assert.ok(Buffer.byteLength(JSON.stringify(result),'utf8')<=4000);
  const data=result.structuredContent;assert.equal(data.coverage.missing,10);assert.equal(data.inventory.complete,true);assert.ok(data.items.length>0&&data.items.length<10);assert.equal(data.hasMore,true);assert.equal(data.nextOffset,data.items.length);assert.equal(data.omissions.responseLimit,10-data.items.length);
 }finally{await reader?.close();await svc.stop();}
});
