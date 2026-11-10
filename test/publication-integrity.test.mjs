// Export reports must describe observed results, not turn a file's existence into success.
import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
test('exporter preserves observed loader identity and refuses a failed historical live success claim',()=>{
 const tmp=join(root,'test/.tmp');mkdirSync(tmp,{recursive:true});const dir=mkdtempSync(join(tmp,'export-proof-'));
 for(const folder of ['tools','src','luau','test/results','docs','dashboard'])mkdirSync(join(dir,folder),{recursive:true});
 copyFileSync(join(root,'tools/prepare-publication.mjs'),join(dir,'tools/prepare-publication.mjs'));
 for(const name of ['package.json','package-lock.json','tsconfig.json','.gitignore','.env.example','AGENT_INSTRUCTIONS.md','opencode.example.jsonc','setup.ps1','rift.cmd','README.md','tools/capture-window.ps1','tools/milestone-report.mjs','luau/bootstrap.template.luau'])writeFileSync(join(dir,name),'fixture __VOLT_BRIDGE_BUILD__\n');
 for(const name of ['VoltResults091126.json','RefinementResults091126.json'])writeFileSync(join(dir,name),JSON.stringify({tests:[],overall:{passed:0,total:0}}));
 const record={revision:'historical-revision',readerBuild:'observed-reader',startedAt:'2026-01-01T00:00:00.000Z',results:[{id:'FIXTURE-01',status:'pass',assertions:[{name:'measured result',pass:true}]}]};
 for(const suite of ['mock','refinement','loader','live-pre'])writeFileSync(join(dir,'test/results',suite+'-fixture.json'),JSON.stringify({...record,suite,...(suite==='live-pre'?{results:[{id:'LIVE-FIXTURE',status:'fail',assertions:[{name:'failed observation',pass:false}]}]}:{})}));
 const run=spawnSync(process.execPath,[join(dir,'tools/prepare-publication.mjs')],{cwd:dir,encoding:'utf8',timeout:10000});assert.equal(run.status,0,run.stderr);
 const report=JSON.parse(readFileSync(join(dir,'.publication/rift-public/reports/GitHubLoader091126.json'),'utf8'));
 assert.doesNotMatch(report.liveGitHubLoader,/^Verified/);assert.equal(report.readerBuild,'observed-reader');assert.equal(report.livePassed,0);assert.equal(report.liveTotal,1);assert.equal(report.matchesCurrentReader,false);
});
