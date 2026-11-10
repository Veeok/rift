// Catches evidence inflation: unbound runs, TODOs, duplicate IDs and stale export results.
import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
function fixture(){
 const scratch=join(root,'test','.tmp');mkdirSync(scratch,{recursive:true});const dir=mkdtempSync(join(scratch,'report-'));
 for(const folder of ['tools','test/results','dist','src','studio','dashboard','luau','.checkpoints/milestones101126','.publication/rift-public'])mkdirSync(join(dir,folder),{recursive:true});
 writeFileSync(join(dir,'.publication/rift-public/README.md'),'candidate\n');const exportDigest=createHash('sha256').update('README.md').update('candidate\n').digest('hex');
 copyFileSync(join(root,'tools','milestone-report.mjs'),join(dir,'tools','milestone-report.mjs'));
 for(const name of ['build','config','limits','service','activity','source-search','bridge','tools','redact','decompile','exec','catalog','log'])copyFileSync(join(root,'dist',name+'.js'),join(dir,'dist',name+'.js'));
 for(const file of ['src/sample.ts','dashboard/index.html','dashboard/app.js','dashboard/style.css','luau/bootstrap.template.luau','tools/capture-window.ps1','tools/prepare-publication.mjs','tools/test-publication-docs.mjs','tools/preservation.mjs','setup.ps1','rift.cmd','tsconfig.json'])writeFileSync(join(dir,file),'fixture\n');
 writeFileSync(join(dir,'package.json'),'{"type":"module"}');writeFileSync(join(dir,'test','sample.test.mjs'),"test('M3-01 fixture case',()=>{});\n");
 const invoke=(...args)=>spawnSync(process.execPath,[join(dir,'tools','milestone-report.mjs'),...args],{cwd:dir,encoding:'utf8',timeout:20000});
 const identityRun=invoke('--identity');assert.equal(identityRun.status,0,identityRun.stderr);const identity=JSON.parse(identityRun.stdout);
 const put=(name,value)=>writeFileSync(join(dir,'test','results',name),typeof value==='string'?value:JSON.stringify(value));
 const tap=(body,stamp=identity)=>{const rows=body.match(/^(?:not )?ok \d+ - /gm)??[],failed=(body.match(/^not ok /gm)??[]).length;put('NativeFinal101126.tap',`# RIFT_TEST_BUILD ${JSON.stringify(stamp)}\nTAP version 13\n${body}\n1..${rows.length}\n# tests ${rows.length}\n# pass ${rows.length-failed}\n# fail ${failed}\n# cancelled 0\n# skipped 0\n# todo 0\n`);put('NativeFinal101126.exit','0');};
 const report=()=>{const result=invoke();assert.equal(result.status,0,result.stderr);return JSON.parse(readFileSync(join(dir,'RiftMilestones101126.json'),'utf8'));};
 return{dir,invoke,identity,put,tap,report,exportDigest};
}
test('reporter keeps missing/mismatched native evidence unrun and retains earlier failed attempts',()=>{
 const f=fixture();f.put('EarlierRed.log','not ok 1 - M3-01 fixture case\n');f.tap('ok 1 - M3-01 fixture case',{...f.identity,artifactDigest:'different'});
 const r=f.report(),item=r.tests.find(t=>t.id==='M3-01');assert.equal(item.status,'unrun');assert.equal(r.totals.uniqueOverall.total,17);assert.equal(r.totals.uniqueOverall.passed,0);assert.ok(item.history.some(h=>h.status==='fail'));
 f.tap('ok 1 - M3-01 fixture case');const next=f.report();assert.equal(next.tests.find(t=>t.id==='M3-01').status,'pass');assert.equal(next.totals.uniqueOverall.passed,1);assert.equal(next.tests.filter(t=>t.id==='M3-01').length,1);
});
test('reporter never treats TAP TODO as a passing required case',()=>{
 const f=fixture();f.tap('ok 1 - M3-01 fixture case # TODO awaiting the real check');const r=f.report();assert.equal(r.tests.find(t=>t.id==='M3-01').status,'unrun');assert.equal(r.totals.uniqueOverall.passed,0);
});
test('reporter refuses duplicate required IDs within the final run',()=>{
 const f=fixture();f.tap('not ok 1 - M3-01 fixture case\nok 2 - M3-01 fixture case');const run=f.invoke();assert.notEqual(run.status,0);assert.match(run.stderr,/duplicate.*M3-01/i);
});
test('reporter will not label an unbound export result as this build passing',()=>{
 const f=fixture(),result={passed:12,total:12,credentialScan:'PASS',personalDataScan:'PASS',exportManifestDigest:f.exportDigest};f.put('PublicationFinal101126.json',result);assert.equal(f.report().tests.find(t=>t.id==='M8-EX01').status,'unrun');
 f.put('PublicationFinal101126.json',{...result,build:f.identity});assert.equal(f.report().tests.find(t=>t.id==='M8-EX01').status,'pass');
});
test('reporter ignores quoted test examples when discovering required declarations',()=>{
 const f=fixture();writeFileSync(join(f.dir,'test','example.test.mjs'),"const example = \"test('M3-02 not a declaration',()=>{});\";\n");const r=f.report();assert.equal(r.totals.uniqueOverall.total,17);assert.ok(!r.tests.some(t=>t.id==='M3-02'));
});
test('reporter credits normal OpenCode entry-point evidence only for its measured build',()=>{
 const f=fixture();f.put('EntryPointsFinal101126.json',{passed:2,total:2});assert.equal(f.report().tests.find(t=>t.id==='M3-OC01')?.status,'unrun');f.put('EntryPointsFinal101126.json',{passed:2,total:2,build:f.identity});assert.equal(f.report().tests.find(t=>t.id==='M3-OC01')?.status,'pass');
});
test('reporter distinguishes approved dedicated GitHub publication from untouched parent history',()=>{
 const f=fixture();f.put('GitHubDelivery101126.json',{approved:true,published:true,commits:1,pushes:1,repository:'https://github.com/Veeok/rift',commit:'0123456789012345678901234567890123456789'});const r=f.report();assert.equal(r.constraints.publication,true);assert.equal(r.constraints.commits,1);assert.equal(r.constraints.pushes,1);assert.equal(r.constraints.parentWorkspaceCommits,0);assert.equal(r.publicationDelivery.repository,'https://github.com/Veeok/rift');
});
test('reporter binds actual live observations and retains blocked cases in the six-case denominator',()=>{
 const f=fixture(),proof={tests:[{id:'LIVE-E2E-01',status:'pass',observed:'Actual CLI/MCP/browser identity matched.'},{id:'LIVE-E2E-02',status:'blocked',observed:'Reviewed reader has no observed background feed.'}]};f.put('LiveClientFinal101126.json',proof);assert.notEqual(f.report().tests.find(t=>t.id==='LIVE-E2E-01').status,'pass');f.put('LiveClientFinal101126.json',{...proof,build:f.identity});const r=f.report();assert.equal(r.totals.live.total,6);assert.equal(r.totals.live.passed,1);assert.equal(r.totals.live.blocked,1);assert.equal(r.totals.live.pending,4);
 f.put('LiveClientFinal101126.json',{build:f.identity,tests:[...proof.tests,proof.tests[0]]});assert.notEqual(f.invoke().status,0);
});
test('reporter preserves human browser-attempt histories without treating string methods as timestamps',()=>{
 const f=fixture();f.put('BrowserChecks101126.json',{serviceBuild:f.identity.serviceBuild,sourceHashes:Object.fromEntries(['index.html','app.js','style.css'].map(name=>['dashboard/'+name,createHash('sha256').update(readFileSync(join(f.dir,'dashboard',name))).digest('hex')])),tests:[{id:'M57-B01',status:'pass',history:['Page-list attempt timed out.','Visible page observed after approval.']}]});const item=f.report().tests.find(t=>t.id==='M57-B01');assert.equal(item.status,'pass');assert.ok(item.history.some(h=>h.observed?.includes('timed out')));
});
test('reporter rejects same-service browser passes when observed frontend hashes are missing or changed',()=>{
 const f=fixture(),proof={serviceBuild:f.identity.serviceBuild,tests:[{id:'M57-B01',status:'pass'}]};f.put('BrowserChecks101126.json',proof);assert.equal(f.report().tests.find(t=>t.id==='M57-B01').status,'unrun');
 proof.sourceHashes=Object.fromEntries(['index.html','app.js','style.css'].map(name=>['dashboard/'+name,createHash('sha256').update(readFileSync(join(f.dir,'dashboard',name))).digest('hex')]));f.put('BrowserChecks101126.json',proof);assert.equal(f.report().tests.find(t=>t.id==='M57-B01').status,'pass');writeFileSync(join(f.dir,'dashboard/app.js'),'changed frontend');assert.equal(f.report().tests.find(t=>t.id==='M57-B01').status,'unrun');
});
test('reporter refuses incomplete native TAP and missing runner success even with milestone passes',()=>{
 const f=fixture();f.put('NativeFinal101126.tap',`# RIFT_TEST_BUILD ${JSON.stringify(f.identity)}\nok 1 - M3-01 fixture case\nnot ok 2 - wrapper failed\n`);f.put('NativeFinal101126.exit','0');let r=f.report();assert.equal(r.tests.find(t=>t.id==='M3-01').status,'unrun');assert.ok(r.blockers.some(b=>b.id==='NATIVE_SUITE'));
 f.tap('ok 1 - M3-01 fixture case');f.put('NativeFinal101126.exit','1');r=f.report();assert.equal(r.tests.find(t=>t.id==='M3-01').status,'unrun');assert.ok(r.blockers.some(b=>b.id==='NATIVE_SUITE'));
});
test('reporter refuses mixed TAP/spec duplicate attempts rather than overwriting a failure',()=>{
 const f=fixture();f.tap('not ok 1 - M3-01 fixture case\n✔ M3-01 fixture case');assert.notEqual(f.invoke().status,0);
});
test('reporter keeps skipped native meta or wrapper checks incomplete',()=>{
 const f=fixture();writeFileSync(join(f.dir,'test/meta.test.mjs'),"import test from 'node:test';\ntest('required meta check',()=>{});\n");const identity=JSON.parse(f.invoke('--identity').stdout);
 f.tap('ok 1 - M3-01 fixture case\nok 2 - required meta check # SKIP',identity);const path=join(f.dir,'test/results/NativeFinal101126.tap');writeFileSync(path,readFileSync(path,'utf8').replace('# pass 2','# pass 1').replace('# skipped 0','# skipped 1'));assert.ok(f.report().blockers.some(b=>b.id==='NATIVE_SUITE'));
});
test('reporter invalidates export evidence after exporter or verification procedure changes',()=>{
 const f=fixture();f.put('PublicationFinal101126.json',{passed:12,total:12,credentialScan:'PASS',personalDataScan:'PASS',build:f.identity,exportManifestDigest:f.exportDigest});assert.equal(f.report().tests.find(t=>t.id==='M8-EX01').status,'pass');writeFileSync(join(f.dir,'.publication/rift-public/README.md'),'unverified candidate');assert.equal(f.report().tests.find(t=>t.id==='M8-EX01').status,'unrun');writeFileSync(join(f.dir,'.publication/rift-public/README.md'),'candidate\n');writeFileSync(join(f.dir,'tools/prepare-publication.mjs'),'changed export scanner');assert.equal(f.report().tests.find(t=>t.id==='M8-EX01').status,'unrun');
});
test('reporter verifies baseline dependency hashes and keeps unrun generation cases in the broader catalog',()=>{
 const f=fixture(),path='src/bridge.ts',proof='.checkpoints/milestones101126/StandaloneReuse101126.json',paths=[...['bridge','config','decompile','exec','index','limits','log','redact','setup','tools'].map(n=>'src/'+n+'.ts'),...['run-mock','run-refinement','run-loader','exec.test','lib','catalog'].map(n=>'test/'+n+'.mjs')];const files=paths.map(path=>{writeFileSync(join(f.dir,path),'fixture\n');return{path,sha256:createHash('sha256').update('fixture\n').digest('hex')};});writeFileSync(join(f.dir,proof),JSON.stringify({passed:true,files,readerTemplateSha256:createHash('sha256').update(readFileSync(join(f.dir,'luau/bootstrap.template.luau'))).digest('hex')}));
 const suites=Object.entries({mock:99,refinement:7,loader:7,execution:14}).map(([suite,total])=>({suite,passed:total,total,tests:Array.from({length:total},(_,n)=>({id:'BASE-'+suite+'-'+n,status:'pass'}))}));
 const baseline={passed:true,totals:{passed:127,total:127},suites,excludedModelCases:Array.from({length:10},(_,n)=>({id:'GEN-'+String(n+1).padStart(2,'0'),status:'unrun'})),catalogWithUnrunGeneration:{passed:127,total:137,unrun:10},reuseVerified:true,reuseVerification:{evidence:proof}};f.put('BaselineFinal101126.json',baseline);assert.ok(!f.report().blockers.some(b=>b.id==='BASELINE'));
 const reduced={...baseline,totals:{passed:1,total:1},suites:[{suite:'mock',passed:1,total:1,tests:[{id:'BASE-1',status:'pass'}]}],excludedModelCases:[{id:'GEN-01',status:'unrun'}],catalogWithUnrunGeneration:{passed:1,total:2,unrun:1}};f.put('BaselineFinal101126.json',reduced);assert.ok(f.report().blockers.some(b=>b.id==='BASELINE'));f.put('BaselineFinal101126.json',baseline);writeFileSync(join(f.dir,path),'changed baseline dependency');assert.ok(f.report().blockers.some(b=>b.id==='BASELINE'));
});
test('reporter reuses browser evidence only when all UI and HTTP component bytes still match',()=>{
 const f=fixture();const paths=['dashboard/index.html','dashboard/app.js','dashboard/style.css',...['service','activity','source-search','bridge','tools','redact','config','decompile','exec','catalog','limits','log'].map(name=>'dist/'+name+'.js')];const files=Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(join(f.dir,path))).digest('hex')]));
 f.put('BrowserChecks101126.json',{serviceBuild:'recorded-prior-build',reuseVerification:{sourceServiceBuild:'recorded-prior-build',targetServiceBuild:f.identity.serviceBuild,targetArtifactDigest:f.identity.artifactDigest,files},tests:[{id:'M57-B01',status:'pass',history:[]}]});const item=f.report().tests.find(t=>t.id==='M57-B01');assert.equal(item.status,'pass');assert.equal(item.evidenceBuild,'recorded-prior-build');assert.equal(item.acceptedForBuild,f.identity.serviceBuild);
 writeFileSync(join(f.dir,'dashboard','app.js'),'changed UI');assert.equal(f.report().tests.find(t=>t.id==='M57-B01').status,'unrun');
});
