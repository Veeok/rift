import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
let module;try{module=await import('../dist/protection-store.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const off={schemaVersion:1,preload:false,memory:false,virtual:false,unlocker:false};
const root=await fs.mkdtemp(path.resolve('test/.tmp/m115-store-').replaceAll('\\','/')).catch(async e=>{if(e.code!=='ENOENT')throw e;await fs.mkdir('test/.tmp',{recursive:true});return fs.mkdtemp(path.resolve('test/.tmp/m115-store-'));});
function store(name){assert.equal(typeof module?.ProtectionStore,'function','protection store is missing');return new module.ProtectionStore(path.join(root,name,'preferences.json'));}
test('a missing file defaults Off without creating resources or saving anything',async()=>{
 const s=store('absent'),r=await s.snapshot();assert.deepEqual(r.preferences,off);assert.equal(r.error,null);
 await assert.rejects(fs.stat(path.join(root,'absent')),{code:'ENOENT'});
});
test('queued save and snapshot use complete committed preferences in invocation order',async()=>{
 const s=store('ordered'),on={...off,preload:true};const a=s.save(on),b=s.snapshot(),c=s.save(off),d=s.snapshot();
 assert.equal((await a).ok,true);assert.deepEqual((await b).preferences,on);assert.equal((await c).ok,true);assert.deepEqual((await d).preferences,off);
});
test('invalid saves have no filesystem effects and failed reads remain explicit',async()=>{
 const s=store('invalid');assert.equal((await s.save({...off,preload:'true'})).ok,false);await assert.rejects(fs.stat(path.join(root,'invalid')),{code:'ENOENT'});
 await fs.mkdir(path.join(root,'invalid'));await fs.writeFile(path.join(root,'invalid/preferences.json'),'{');
 const r=await s.snapshot();assert.equal(r.error.code,'invalid_preferences');assert.deepEqual(r.preferences,off);
});
