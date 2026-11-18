import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createPreviewApi} from '../tools/preview-api.mjs';
test('synthetic preview explorer is usable without ever dispatching to a client',async()=>{
 const middleware=createPreviewApi(),server=http.createServer((req,res)=>middleware(req,res,()=>{res.writeHead(404);res.end();}));await new Promise(r=>server.listen(0,'127.0.0.2',r));const origin='http://127.0.0.2:'+server.address().port;
 const call=async(view,args)=>{const res=await fetch(origin+'/api/explorer/'+view,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(args)});return {status:res.status,data:await res.json()};};
 const binding={readerSession:'synthetic-session-1',connectionId:'synthetic-connection-1'};
 try{
  const roots=await call('read',{binding,view:'roots'});assert.equal(roots.status,200);assert.equal(roots.data.structuredContent.synthetic,true);const root=roots.data.structuredContent.items[0];assert.ok(root.id);
  const children=await call('read',{binding,view:'children',target:{id:root.id}});const target=children.data.structuredContent.items[0];
  const props=await call('read',{binding,view:'properties',target:{id:target.id}});const field=props.data.structuredContent.properties.find(p=>p.name==='Text');
  const args={binding,target:{id:target.id},requestId:'preview-edit-1',field:{kind:'property',name:'Text'},expected:field.value,value:{type:'string',value:'Changed synthetic label'},schemaVersion:1,confirm:true};
  const refused=await call('write',{...args,confirm:false});assert.equal(refused.status,400);
  const edit=await call('write',args);assert.equal(edit.data.structuredContent.status,'applied');
  const again=await call('write',args);assert.equal(again.data.structuredContent.status,'applied');
  const stale=await call('read',{binding:{...binding,connectionId:'foreign'},view:'roots'});assert.equal(stale.status,409);
 }finally{await new Promise(r=>server.close(r));}
});
