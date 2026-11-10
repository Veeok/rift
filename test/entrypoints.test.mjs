// Owner scope correction: normal Windows/OpenCode/client entry points, no separate demo runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startService} from '../dist/service.js';
import {planSetup} from '../dist/windows-setup.js';
import {CaptureService} from '../dist/capture.js';
import {apiPort} from '../dist/service-client.js';
const root=fileURLToPath(new URL('../',import.meta.url));
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('M3-08 normal Rift service requires only its reader connection, not a separate demo runtime',async()=>{
 const token='entrypoint-test-token-0000000000000000000000',apiPort=await port(),svc=await startService({port:await port(),apiPort,token,tokenFile:'unused',tokenError:null,allowExec:false});
 try{assert.equal(svc.status().state,'no_client');assert.doesNotMatch(svc.doctor().recovery,/Studio|playtest|companion/i);for(const path of ['/api/studio','/api/studio_sources'])assert.equal((await fetch(`http://127.0.0.1:${apiPort}${path}`,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:'{}'})).status,404);}finally{await svc.stop();}
});
test('M4-07 setup depends only on the reader template and preserves unrelated demo folders',()=>{
 const tmp=join(root,'test','.tmp');mkdirSync(tmp,{recursive:true});const dir=mkdtempSync(join(tmp,'normal-setup-'));mkdirSync(join(dir,'luau'));writeFileSync(join(dir,'luau','bootstrap.template.luau'),'__VOLT_BRIDGE_TOKEN__ __VOLT_BRIDGE_URL__ __VOLT_BRIDGE_BUILD__');mkdirSync(join(dir,'studio'));writeFileSync(join(dir,'studio','FixtureInstall.template.luau'),'unrelated legacy content');
 const plan=planSetup({root:dir,configFile:join(dir,'opencode.json')});assert.ok(plan.changes.some(c=>c.path.endsWith('rift-bootstrap.local.luau')));assert.ok(plan.changes.every(c=>!/(RiftFixture|RiftSource|plugin)/i.test(c.path)));
});
test('M6-06 window enumeration selects Roblox client processes without an editor dependency',async()=>{
 const base={id:'1',title:'Client',pid:1,width:1,height:1,minimized:false};const service=new CaptureService({async listWindows(){return[{...base,processName:'RobloxPlayerBeta'},{...base,id:'2',processName:'RobloxStudioBeta'},{...base,id:'3',processName:'Other'}];},async capture(){throw new Error('Enumeration must not capture automatically');}});
 assert.deepEqual((await service.listWindows()).map(w=>w.id),['1']);
});
test('M3-09 explicit process API ports override local defaults across compatibility aliases',()=>{
 const tmp=join(root,'test','.tmp');mkdirSync(tmp,{recursive:true});const dir=mkdtempSync(join(tmp,'api-port-')),envFile=join(dir,'.env');writeFileSync(envFile,'RIFT_API_PORT=42320\n');
 assert.equal(apiPort({VOLT_BRIDGE_API_PORT:'50123'},envFile),50123);assert.equal(apiPort({},envFile),42320);assert.equal(apiPort({RIFT_API_PORT:'50124',VOLT_BRIDGE_API_PORT:'50123'},envFile),50124);
});
