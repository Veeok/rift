import test from 'node:test';
import assert from 'node:assert/strict';
import {BridgeError} from '../dist/bridge.js';
let module;try{module=await import('../dist/explorer.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const binding={readerSession:'session-1',connectionId:'c1'};
function fixture(){
 assert.equal(typeof module?.registerExplorerTools,'function','structured explorer tools missing');
 const tools=new Map(),calls=[];const bridge={reader:{session:'session-1',connectionId:'c1',capabilities:['explorer_v1','explorer_write_v1']},request:async(op,args)=>{calls.push({op,args});return {binding,view:args.view,schemaVersion:1,items:[],status:op==='explorer_write'?'applied':undefined};}};
 module.registerExplorerTools({registerTool:(name,config,handler)=>tools.set(name,{config,handler})},bridge,true);
 return {tools,calls,bridge,read:args=>tools.get('explorer_read').handler(args),write:args=>tools.get('explorer_write').handler(args)};
}
const write=()=>({binding,requestId:'request-0001',target:{id:'session:1'},field:{kind:'property',name:'Name'},expected:{type:'string',value:'Before'},value:{type:'string',value:'After'},schemaVersion:1,confirm:true});
test('read protocol is bounded, typed and session-bound before dispatch',async()=>{
 const f=fixture();await f.read({binding,view:'roots'});assert.equal(f.calls[0].op,'explorer_read');
 await f.read({binding:{...binding,connectionId:'foreign'},view:'roots'});assert.equal(f.calls.length,1);
 assert.equal(module.explorerReadSchema.safeParse({binding,view:'children',target:{path:['Workspace']}}).success,false);
 assert.equal(module.explorerReadSchema.safeParse({binding,view:'roots',source:'arbitrary'}).success,false);
 assert.equal(module.explorerReadSchema.safeParse({binding,view:'properties'}).success,false);
 assert.equal(module.explorerReadSchema.safeParse({binding,view:'children'}).success,false);
});
test('write requires explicit confirm, capability, finite typed data and no arbitrary routes',async()=>{
 const f=fixture();for(const args of [{...write(),confirm:false},{...write(),value:{type:'number',value:NaN}},{...write(),field:{kind:'method',name:'Destroy'}}])assert.equal(module.explorerWriteSchema.safeParse(args).success,false);
 f.bridge.reader.capabilities=['explorer_v1'];const result=await f.write(write());assert.equal(result.isError,true);assert.equal(f.calls.length,0);
});
test('a changed connection after dispatch makes write outcome unknown rather than retrying',async()=>{
 const f=fixture();f.bridge.request=async()=>{f.calls.push('write');f.bridge.reader={...f.bridge.reader,connectionId:'new'};return {status:'applied',binding};};
 const result=await f.write(write());assert.equal(result.structuredContent.status,'unknown_outcome');assert.equal(f.calls.length,1);
});
test('transport timeout returns a retained request reference without automatic write retry',async()=>{
 const f=fixture();f.bridge.request=async()=>{f.calls.push('write');throw new BridgeError('deadline_exceeded','deadline',true);};
 const result=await f.write(write());assert.equal(result.structuredContent.status,'unknown_outcome');assert.equal(result.structuredContent.requestId,'request-0001');assert.equal(f.calls.length,1);
});
test('read-only host never registers the write tool',()=>{
 const f=fixture(),names=[];module.registerExplorerTools({registerTool:name=>names.push(name)},f.bridge,false);assert.deepEqual(names,['explorer_read']);
});
test('a reader write capability cannot present editable UI when the host disabled writes',async()=>{
 const tools=new Map(),f=fixture();f.bridge.request=async()=>({binding,view:'properties',items:[],writeEnabled:true});
 module.registerExplorerTools({registerTool:(name,config,handler)=>tools.set(name,{handler})},f.bridge,false);
 const result=await tools.get('explorer_read').handler({binding,view:'properties',target:{id:'session:1'}});
 assert.equal(result.structuredContent.writeEnabled,false);
});
test('nil read from the reader can be echoed back as an expected value',()=>{
 for(const expected of [{type:'nil'},{type:'nil',value:null}])assert.equal(module.explorerWriteSchema.safeParse({...write(),field:{kind:'attribute',name:'Added'},expected}).success,true);
 assert.equal(module.explorerWriteSchema.safeParse({...write(),expected:{type:'nil',value:0}}).success,false);
});
test('reader response binding is checked rather than relabelled as current evidence',async()=>{
 const f=fixture();f.bridge.request=async()=>({binding:{...binding,connectionId:'foreign'},items:[],status:'applied'});
 assert.equal((await f.read({binding,view:'roots'})).isError,true);
 assert.equal((await f.write(write())).structuredContent.status,'unknown_outcome');
});
