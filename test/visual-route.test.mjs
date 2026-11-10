import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {CaptureService} from '../dist/capture.js';
import {startService} from '../dist/service.js';
import {connectReader} from './client-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('M6-05 shared MCP preserves explicit image consent and original capture identity (not model vision)',async()=>{
 const token='visual-route-fixture-token-00000000000000000000',apiPort=await port(),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBCkAAAAASUVORK5CYII=','base64');
 const window={id:'1',title:'Synthetic client boundary',pid:100,processName:'RobloxPlayerBeta',width:1,height:1,minimized:false};
 const visual=new CaptureService({async listWindows(){return[window]},async capture(){return{data:png,width:1,height:1}}});
 const gamePort=await port(),service=await startService({port:gamePort,apiPort,token,tokenFile:'unused',tokenError:null,allowExec:false,visual});let child,reader;
 try{
  reader=await connectReader({port:gamePort,token,build:service.status().build.expectedReaderBuild,session:'visual-route-session'});
  child=spawn(process.execPath,[root+'dist/index.js','--shared'],{cwd:root,env:{...process.env,VOLT_BRIDGE_TOKEN:token,VOLT_BRIDGE_API_PORT:String(apiPort)},stdio:['pipe','pipe','pipe']});
  let seq=0,buffer='';const waiting=new Map();child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;for(let n;(n=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);if(!line)continue;const m=JSON.parse(line);waiting.get(m.id)?.(m);}});
  const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>reject(new Error('MCP response timeout')),10000);waiting.set(id,m=>{clearTimeout(t);waiting.delete(id);resolve(m)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'image-route-test',version:'1'}});
  const call=async(name,args)=>(await rpc('tools/call',{name,arguments:args})).result;
  const preview=await call('preview_capture',{windowId:'1'});assert.ok(preview.content.every(c=>c.type!=='image'));const meta=JSON.parse(preview.content[0].text);assert.equal(meta.sessionId,'visual-route-session');assert.equal(meta.serviceBuild,service.status().build.serviceBuild);
  const denied=await call('share_capture',{captureId:meta.captureId,confirm:false});assert.equal(denied.isError,true);assert.ok(denied.content.every(c=>c.type!=='image'));
  const unsupported=await call('share_capture',{captureId:meta.captureId,confirm:true,routeSupportsImages:false});assert.equal(unsupported.isError,true);
  const shared=await call('share_capture',{captureId:meta.captureId,confirm:true});const image=shared.content.find(c=>c.type==='image'),identity=JSON.parse(shared.content[0].text);assert.ok(Buffer.from(image.data,'base64').equals(png));assert.equal(image.mimeType,'image/png');assert.equal(identity.capturedAt,meta.capturedAt);assert.equal(identity.sessionId,meta.sessionId);assert.equal(identity.serviceBuild,meta.serviceBuild);assert.equal(identity.routeImageSupport,'unverified');
 }finally{if(child){child.stdin.end();await new Promise(r=>child.once('exit',r));}await reader?.close();await service.stop();}
});
