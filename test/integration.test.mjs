import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {startService} from '../dist/service.js';
import {connectReader,until} from './client-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),token='rift-integration-credential-000000000000000000';
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function fixture(){
 const apiPort=await port(),gamePort=await port(),svc=await startService({port:gamePort,apiPort,token,tokenFile:'unused',tokenError:null,allowExec:false});const url=`http://127.0.0.1:${apiPort}`;
 const request=async(path,body)=>{const r=await fetch(url+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{code:r.status,value:await r.json()};};
 const reader=options=>connectReader({port:gamePort,token,build:svc.status().build.expectedReaderBuild,...options});return{svc,request,reader,apiPort,gamePort};
}
function subprocess(f,args){return new Promise((resolve,reject)=>{const c=spawn(process.execPath,[root+'dist/'+(args[0]==='mcp'?'index.js':'cli.js'),...(args[0]==='mcp'?['--shared']:args)],{cwd:root,env:{...process.env,VOLT_BRIDGE_TOKEN:token,VOLT_BRIDGE_API_PORT:String(f.apiPort)},stdio:['pipe','pipe','pipe']});if(args[0]==='mcp'){resolve(c);return;}let stdout='',stderr='';c.stdout.on('data',x=>stdout+=x);c.stderr.on('data',x=>stderr+=x);c.on('error',reject);c.on('exit',code=>resolve({code,stdout,stderr}));});}
function rpc(c){let seq=0,buf='';const pending=new Map();c.stdout.setEncoding('utf8');c.stdout.on('data',chunk=>{buf+=chunk;for(let n;(n=buf.indexOf('\n'))>=0;){const line=buf.slice(0,n);buf=buf.slice(n+1);if(!line)continue;const msg=JSON.parse(line);pending.get(msg.id)?.(msg);}});return(method,params)=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>reject(new Error('MCP timeout')),10000);pending.set(id,msg=>{clearTimeout(t);pending.delete(id);resolve(msg)});c.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
const parsed=result=>JSON.parse(result.content[0].text);
test('M3-06 shared MCP, Windows CLI and dashboard API see the same reader session',async()=>{
 const f=await fixture();let c,r;
 try{r=await f.reader({});const api=(await f.request('status')).value;c=await subprocess(f,['mcp']);const call=rpc(c);assert.ok((await call('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'coexistence',version:'1'}})).result);const mcp=await call('tools/call',{name:'get_status',arguments:{waitForReaderMs:0}}),cli=await subprocess(f,['status','--json']);assert.equal(cli.code,0);const j=JSON.parse(cli.stdout),m=parsed(mcp.result);assert.equal(j.session.id,api.session.id);assert.equal(m.rift.session.id,api.session.id);assert.equal(m.rift.build.serviceBuild,api.build.serviceBuild);assert.equal(j.state,'healthy');assert.ok(api.freshness.ageMs>=0);assert.ok(!JSON.stringify([j,m,api]).includes(token));}
 finally{if(c){c.stdin.end();await new Promise(resolve=>c.once('exit',resolve));}await r?.close();await f.svc.stop();}
});
test('M3-07 connected wrong reader build is distinct from healthy and no client',async()=>{
 const f=await fixture();let r;try{r=await f.reader({build:'wrong-build'});const st=(await f.request('status')).value;assert.equal(st.state,'build_mismatch');assert.equal(st.session.id,r.session);assert.equal(st.build.reportedReaderBuild,'wrong-build');assert.equal(st.build.matching,false);assert.equal((await subprocess(f,['status','--json'])).code,4);}finally{await r?.close();await f.svc.stop();}
});
test('M9-07 HTTP feed receives delayed reader-protocol output, redacts it and resumes its cursor',async()=>{
 const f=await fixture();let r;try{r=await f.reader({});const cursor=parsed((await f.request('tools/get_logs',{})).value).nextCursor;const done=new Promise(resolve=>setTimeout(()=>{r.log('delayed warning '+token,'warn');resolve();},10));await done;await until(()=>f.svc.status().activity.lastSequence===1);const j=parsed((await f.request('tools/get_logs',{cursor})).value);assert.equal(j.items.length,1);assert.equal(j.items[0].runId,null);assert.equal(j.items[0].attribution,'session-wide');assert.ok(j.items[0].message.includes('[REDACTED]'));assert.equal(parsed((await f.request('tools/get_logs',{cursor:j.nextCursor})).value).items.length,0);}finally{await r?.close();await f.svc.stop();}
});
test('M9-08 reader reconnect does not relabel old logs or accept the old session cursor',async()=>{
 const f=await fixture();let a,b;try{a=await f.reader({session:'client-fixture-one'});a.log('first-client');await until(()=>f.svc.status().activity.lastSequence===1);const first=parsed((await f.request('tools/get_logs',{})).value);await a.close();await until(()=>!f.svc.status().session);b=await f.reader({session:'client-fixture-two'});b.log('second-client');await until(()=>f.svc.status().activity.lastSequence===1);const next=parsed((await f.request('tools/get_logs',{})).value);assert.deepEqual(next.items.map(x=>x.message),['second-client']);assert.equal((await f.request('tools/get_logs',{cursor:first.nextCursor})).value.isError,true);assert.equal(f.svc.activity.feed({sessionId:'client-fixture-one'}).current,false);}finally{await a?.close();await b?.close();await f.svc.stop();}
});
test('M10-06 client inspection and authorized cache search trace source revisions without implicit decompilation',async()=>{
 const f=await fixture();let r,decompiles=0;let hash='bytecode-one',source='local ready = true\nwarn("HUD clipped warning")';const object={id:'client-f:script',name:'HUD',className:'LocalScript',path:'PlayerScripts/HUD'};
 try{r=await f.reader({handler:m=>{if(m.op==='script_info')return{object,hash,decompileSupport:'supported'};if(m.op==='decompile'){decompiles++;return{source,hash,observedAt:new Date().toISOString()};}if(m.op==='list_scripts')return{items:[object],total:1,hasMore:false,cache:{builtObservedAt:'one-inventory'}};if(m.op==='inspect_instance')return{object:{id:'client-f:label',name:'StatusLabel',className:'TextLabel',path:'PlayerGui/StatusLabel'},properties:{TextFits:false}};return{};}});
  const read=(await f.request('tools/read_script',{script:{path:['PlayerScripts','HUD']}})).value;assert.match(read.content[1].text,/HUD clipped warning/);const found=parsed((await f.request('tools/search_source',{query:'HUD clipped warning'})).value);assert.equal(found.items[0].line,2);assert.equal(found.items[0].sourceKind,'cached_reconstructed');const revision=found.items[0].revision;
  const inspected=(await f.request('tools/inspect_instance',{target:{id:'client-f:label'}})).value;assert.notEqual(inspected.isError,true);assert.equal(parsed(inspected).properties.TextFits,false);
  hash='bytecode-two';source='print("HUD fixed")';assert.equal(parsed((await f.request('tools/search_source',{query:'clipped warning'})).value).items.length,0);assert.equal(decompiles,1,'search must not decompile missing/changed source');await f.request('tools/read_script',{script:{path:['PlayerScripts','HUD']},refresh:true});const changed=parsed((await f.request('tools/search_source',{query:'fixed'})).value);assert.notEqual(changed.items[0].revision,revision);
 }finally{await r?.close();await f.svc.stop();}
});
