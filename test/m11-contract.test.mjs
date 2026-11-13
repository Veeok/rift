import test from 'node:test';
import assert from 'node:assert/strict';
import * as result from '../dist/tool-result.js';
import {readScriptResult} from '../dist/read-script-result.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';

test('C01 C03 C08 metadata aliases and tagged values remain decoded',()=>{
 const meta={ok:true,session:{id:'s',connectionId:'c'},observedAt:'now',nextOffset:2,items:[{value:{t:'Vector3',x:1,y:2,z:3}}]};
 const r=result.toolResult(meta);assert.deepEqual(r.structuredContent.metadata,{ok:true,session:meta.session,observedAt:'now',nextOffset:2});assert.deepEqual(r.structuredContent.items,meta.items);assert.deepEqual(JSON.parse(r.content[0].text),meta);
 assert.equal(JSON.stringify(r.structuredContent).split('Vector3').length-1,1);
 assert.deepEqual(r.structuredContent.items[0].value,{t:'Vector3',x:1,y:2,z:3});assert.ok(!('type' in r.structuredContent.items[0].value));
});
test('C02 C09 exact source, empty, pending and supplied nontext blocks',()=>{
 for(const source of ['a\r\nΩ\n','',undefined]){const r=readScriptResult({status:source===undefined?'pending':'complete'},source);assert.equal(r.structuredContent.sourceText,source??null);assert.equal(r.content.length,source===undefined?1:2);if(source!==undefined)assert.equal(r.content[1].text,source);}
 const image={type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII='};const r=result.toolResult({ok:true},{content:[image]});assert.deepEqual(r.content,[image]);assert.equal(r.content[0].mimeType,'image/png');assert.equal(r.content[0].data,image.data);assert.ok(!Object.hasOwn(r.structuredContent,'sourceText'));
});
test('C04 C05 C06 typed media and partial errors retained',()=>{
 const meta={ok:true,partial:true,items:[{id:'1'},{error:{code:'stale'}}]};const content=[{type:'text',text:'raw'}, {type:'image',mimeType:'image/jpeg',data:'/9k='}];
 const r=result.toolResult(meta,{isError:true,content});assert.equal(r.isError,true);assert.deepEqual(r.content,content);assert.deepEqual(r.structuredContent.metadata,{ok:true,partial:true});assert.deepEqual(r.structuredContent.items,meta.items);
});
test('C07 bounded prefix measures complete serialized UTF8 envelope and reports omissions',()=>{
 const meta={offset:10,items:Array.from({length:30},(_,i)=>({id:i,value:'Ω'.repeat(20)})),errors:[{code:'stale'}]};
 const r=result.boundedToolResult(meta,1400);const m=r.structuredContent;
 assert.ok(Buffer.byteLength(JSON.stringify(r),'utf8')<=1400);assert.ok(m.items.length>0&&m.items.length<30);assert.deepEqual(m.items,meta.items.slice(0,m.items.length));assert.equal(m.omittedCount,30-m.items.length);assert.equal(m.nextOffset,10+m.items.length);assert.equal(m.partialReason,'response_size');assert.deepEqual(m.errors,meta.errors);
});
test('C07 impossible first item and non-list overflow fail explicitly',()=>{
 assert.throws(()=>result.boundedToolResult({items:[{value:'x'.repeat(20000)}]},700),RangeError);
 assert.throws(()=>result.boundedToolResult({object:'x'.repeat(10000)},700),RangeError);
});
test('C07 preserves prior partial reason and omission count',()=>{
 const meta={offset:5,partial:true,partialReason:'deadline',omittedCount:3,items:Array.from({length:20},(_,i)=>({i,value:'Ω'.repeat(20)}))};
 const r=result.boundedToolResult(meta,1400);assert.equal(r.structuredContent.previousPartialReason,'deadline');assert.equal(r.structuredContent.omittedCount,3+20-r.structuredContent.items.length);
});
test('C07 preserves kept per-item errors and replaces upstream cursor after prefix reduction',()=>{
 const items=Array.from({length:30},(_,i)=>i===0?{index:i,error:{code:'stale'}}:{index:i,value:'Ω'.repeat(25)});
 const resultValue=result.boundedToolResult({offset:17,nextOffset:999,hasMore:true,partial:true,partialReason:'deadline',items},1500);
 const m=resultValue.structuredContent;assert.ok(m.items.length>0&&m.items.length<items.length);assert.deepEqual(m.items,items.slice(0,m.items.length));assert.equal(m.items[0].error.code,'stale');assert.equal(m.nextOffset,17+m.items.length);assert.equal(m.hasMore,true);assert.equal(m.partial,true);assert.equal(m.previousPartialReason,'deadline');
});
test('C08 nested source coverage and limits retain semantics without bulk fields',()=>{
 const payload={source:{coverage:{cached:3,missing:2},limits:{maxPages:4},items:[1],data:'large',properties:{x:1}},coverage:{complete:false,items:[1]},limits:{visited:50,properties:{secret:'payload'}},items:[{id:1}],data:'huge',properties:{x:1}};
 const r=result.toolResult(payload);assert.deepEqual(r.structuredContent.metadata.source,{coverage:{cached:3,missing:2},limits:{maxPages:4}});assert.deepEqual(r.structuredContent.metadata.coverage,{complete:false});assert.deepEqual(r.structuredContent.metadata.limits,{visited:50});assert.equal(r.structuredContent.data,'huge');assert.equal(r.structuredContent.metadata.items,undefined);
});
test('C03 C04 synthetic stdio fixture carries exact tagged vector and full PNG bytes',async()=>{
 const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./m11-codemode-fixture.mjs',import.meta.url))],stderr:'pipe'});
 const client=new Client({name:'fixture-proof',version:'1'},{capabilities:{}});
 try{await client.connect(transport);
  const inspection=await client.callTool({name:'contract_fixture',arguments:{state:'inspection'}});const vector=inspection.structuredContent.items[0].properties.Position;
  assert.deepEqual(vector,{t:'Vector3',x:1,y:2,z:3});assert.ok(!Object.hasOwn(vector,'type'));
  const image=(await client.callTool({name:'contract_fixture',arguments:{state:'image'}})).content[1];
  assert.deepEqual(image,{type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII='});
 }finally{await client.close();}
});
