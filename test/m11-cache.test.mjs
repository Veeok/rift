import test from 'node:test';
import assert from 'node:assert/strict';
import {DecompileService,cacheKey} from '../dist/decompile.js';

const info={object:{id:'session:1',name:'Fixture',className:'LocalScript',path:'Fixture'},hash:'h1',decompileSupport:'supported'};
function fixture(request){const state={connectionId:'c1'};const bridge={session:'session',get reader(){return {session:'session',connectionId:state.connectionId};},onSessionChange(){},request};return {state,service:new DecompileService(bridge)};}

test('M11 cache preserves exact source bytes independently from normalized display lines',async()=>{
 const raw='-- Ω\r\nreturn true\r\n';const f=fixture(async()=>({source:raw,hash:'h1'}));
 await f.service.start('session',info,undefined).done;const entry=f.service.lookup(cacheKey('session',info,undefined));
 assert.equal(entry.sourceText,raw);assert.equal(entry.connectionId,'c1');assert.deepEqual(entry.lines,['-- Ω','return true','']);
});
test('M11 same-session new connection cannot read the previous connection cache',async()=>{
 const f=fixture(async()=>({source:'return 1',hash:'h1'}));await f.service.start('session',info,undefined).done;
 assert.equal(f.service.cachedEntries('session').length,1);f.state.connectionId='c2';
 assert.equal(f.service.lookup(cacheKey('session',info,undefined)),null);assert.equal(f.service.cachedEntries('session').length,0);
});
test('M11 same-session reconnect cannot reuse an old pending job or cache its late result',async()=>{
 let enter;const entered=new Promise(r=>{enter=r;});let finish;let onLate;let calls=0;
 const f=fixture(async(_op,_args,options)=>{calls++;if(calls===1){onLate=options.onLate;enter();return new Promise(r=>{finish=r;});}return {source:'new connection',hash:'h1'};});
 const old=f.service.start('session',info,undefined);await entered;f.state.connectionId='c2';
 const current=f.service.start('session',info,undefined);assert.notEqual(current.id,old.id);await current.done;
 finish({source:'old connection',hash:'h1'});await old.done;onLate({source:'late old connection',hash:'h1'});
 const entry=f.service.lookup(cacheKey('session',info,undefined));assert.equal(entry.sourceText,'new connection');assert.equal(entry.connectionId,'c2');assert.equal(f.service.getJob(old.id),null);
});
