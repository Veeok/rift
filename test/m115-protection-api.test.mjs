import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startService} from '../dist/service.js';
const token='SYNTHETIC_ONLY_CREDENTIAL_012345678901234567890';
const off={schemaVersion:1,preload:false,memory:false,virtual:false,unlocker:false};
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;}
async function fixture(name){await fs.mkdir('test/.tmp',{recursive:true});const dir=await fs.mkdtemp(path.resolve('test/.tmp/'+name+'-'));const apiPort=await port();const service=await startService({port:await port(),apiPort,token,tokenFile:'unused',tokenError:null,allowExec:true,logLevel:'error',protectionFile:path.join(dir,'preferences.json')});return {service,dir,url:'http://127.0.0.1:'+apiPort};}
test('fixed protection routes enforce auth, exact Origin, strict booleans, unavailable categories and body limit',async()=>{
 const f=await fixture('m115-api');const headers={authorization:'Bearer '+token,'content-type':'application/json',origin:f.url};
 try{
  assert.equal((await fetch(f.url+'/api/protection')).status,401);
  let r=await fetch(f.url+'/api/protection',{headers});assert.equal(r.status,200);assert.deepEqual((await r.json()).preferences,off);
  const write=(input,extra={})=>fetch(f.url+'/api/protection',{method:'PATCH',headers:{...headers,...extra},body:JSON.stringify(input)});
  assert.equal((await write(off,{origin:'https://evil.invalid'})).status,403);
  assert.equal((await write({...off,proof:'supported'})).status,400);
  assert.equal((await write({...off,memory:true})).status,400);
  r=await write({...off,preload:true});assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
  r=await fetch(f.url+'/api/protection',{headers});const status=await r.json();assert.equal(status.preferences.preload,true);assert.equal(status.runtime.preload.support,'unverified');assert.equal(status.runtime.preload.inUse,false);
  r=await fetch(f.url+'/api/protection',{method:'PATCH',headers,body:JSON.stringify(off)+' '.repeat(1025)});assert.equal(r.status,413);
  const forbidden=await fetch(f.url+'/api/tools/execute_luau',{method:'POST',headers,body:'{"source":"x","confirm":true,"allowUnprotected":true}'});assert.equal(forbidden.status,403);
 }finally{await f.service.stop();}
});
test('cookie-authenticated saves persist, while corrupt stored input exposes Error instead of fake Off success',async()=>{
 const f=await fixture('m115-cookie');try{
  const login=await fetch(f.url+'/api/login',{method:'POST',headers:{origin:f.url,'content-type':'application/json'},body:JSON.stringify({token})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  let r=await fetch(f.url+'/api/protection',{method:'PATCH',headers:{origin:f.url,cookie,'content-type':'application/json'},body:JSON.stringify({...off,preload:true})});assert.equal(r.status,200);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.dir,'preferences.json'),'utf8')).preload,true);
  await fs.writeFile(path.join(f.dir,'preferences.json'),'{');r=await fetch(f.url+'/api/protection',{headers:{cookie}});const j=await r.json();
  assert.equal(j.error.code,'invalid_preferences');assert.equal(j.runtime.preload.state,'Error');assert.equal(j.runtime.preload.inUse,false);
 }finally{await f.service.stop();}
});
