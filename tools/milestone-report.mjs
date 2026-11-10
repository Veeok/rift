// Build-bound acceptance reconciliation. Never executes a model, client, browser or test suite.
import {readFileSync,writeFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildIdentity} from '../dist/build.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),results=join(root,'test','results');
const read=path=>readFileSync(join(root,path),'utf8');
const json=path=>existsSync(join(root,path))?JSON.parse(read(path)):null;
const declared=new Map(),definitions=createHash('sha256');let expectedNativeEntries=0;
for(const file of readdirSync(join(root,'test')).filter(f=>f.endsWith('.mjs')).sort()){
 const source=read('test/'+file);definitions.update(file).update(source);
 if(!file.endsWith('.test.mjs'))continue;
 expectedNativeEntries+=/from\s*['"]node:test['"]/.test(source)?[...source.matchAll(/^\s*test\(\s*['"]/gm)].length:1;
 for(const match of source.matchAll(/^\s*test\(\s*(['"])(M(?:3|4|57|6|8|9|10)-[A-Z0-9-]+)\s+([^\r\n]*?)\1/gm)){
  const id=match[2];if(declared.has(id))throw new Error('Duplicate declared case '+id);
  declared.set(id,{id,title:match[3],milestones:[id.startsWith('M57-')?'M5/M7':id.split('-')[0]],kind:'automated',subtype:'native',status:'unrun',evidence:null,history:[]});
 }
}
const artifact=createHash('sha256');
function fingerprint(folder){for(const entry of readdirSync(join(root,folder),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(folder,entry.name);if(entry.isDirectory())fingerprint(path);else artifact.update(path.replaceAll('\\','/')).update(readFileSync(join(root,path)));}}
for(const folder of ['src','dashboard'])fingerprint(folder);
for(const path of ['luau/bootstrap.template.luau','tools/capture-window.ps1','tools/prepare-publication.mjs','tools/test-publication-docs.mjs','tools/preservation.mjs','tools/milestone-report.mjs','setup.ps1','rift.cmd','package.json','tsconfig.json'])artifact.update(path).update(existsSync(join(root,path))?readFileSync(join(root,path)):'not distributed');
const build={...buildIdentity(),artifactDigest:artifact.digest('hex'),testDefinitionDigest:definitions.digest('hex')};
const matches=identity=>identity?.serviceBuild===build.serviceBuild&&identity?.artifactDigest===build.artifactDigest&&identity?.testDefinitionDigest===build.testDefinitionDigest;
if(process.argv.includes('--identity')){console.log(JSON.stringify({...build,observedAt:new Date().toISOString()}));process.exit(0);}
function add(id,title,milestones,kind,subtype,evidence,status='unrun'){declared.set(id,{id,title,milestones,kind,subtype,evidence,status,history:[]});}
for(let n=1;n<=8;n++)add('M57-B'+String(n).padStart(2,'0'),'Actual dashboard browser case '+n,['M5/M7'],'automated','browser','test/results/BrowserChecks101126.json','pending');
add('M3-OC01','Normal Windows/OpenCode setup, registration and shared transport entry points',['M3','M4'],'automated','entrypoints','test/results/EntryPointsFinal101126.json');
add('M8-EX01','Deterministic credential-free export, reviewed reader parity and preservation',['M8'],'automated','export','test/results/PublicationFinal101126.json');
for(const [id,milestones,title]of[
 ['LIVE-E2E-01',['M3'],'Observe the same actual connected Rift client in OpenCode, CLI and dashboard'],
 ['LIVE-E2E-02',['M9'],'Observe supported delayed client output after its initiating request returns'],
 ['LIVE-E2E-03',['M10'],'Trace actual diagnostic text to an authorized cached source line and revision'],
 ['LIVE-E2E-04',['M6'],'Explicitly select/preview/crop the actual client window and verify the configured image route'],
 ['LIVE-E2E-05',['M3','M6','M9','M10'],'Reconnect the actual client without relabelling old logs, handles or captures'],
 ['LIVE-LOG-01',['M9'],'Verify actual output-source capabilities and attribution without assuming native-console support'],
])add(id,title,milestones,'live',null,'test/results/LiveClientAvailability101126.json','pending');
function observations(text,unique=false){
 const out=new Map();
 for(const match of text.matchAll(/^(ok|not ok) \d+ - (M(?:3|4|57|6|8|9|10)-[A-Z0-9-]+)\b[^\r\n]*/gm)){
  if(unique&&out.has(match[2]))throw new Error('Duplicate required case in final run: '+match[2]);
  out.set(match[2],/#\s+(?:SKIP|TODO)\b/i.test(match[0])?'unrun':match[1]==='ok'?'pass':'fail');
 }
 for(const match of text.matchAll(/^[✔✖✓×]\s+(M(?:3|4|57|6|8|9|10)-[A-Z0-9-]+)\b[^\r\n]*/gm)){if(unique&&out.has(match[1]))throw new Error('Duplicate required case in final run: '+match[1]);out.set(match[1],/#\s+(?:SKIP|TODO)\b/i.test(match[0])?'unrun':/[✖×]/.test(match[0])?'fail':'pass');}
 return out;
}
function stamp(text){try{return JSON.parse(/^# RIFT_TEST_BUILD (\{[^\r\n]+\})/m.exec(text)?.[1]??'null');}catch{return null;}}
for(const file of readdirSync(results).filter(f=>/\.(tap|log)$/.test(f)).sort()){
 const text=readFileSync(join(results,file),'utf8'),identity=stamp(text);
 for(const[id,status]of observations(text)){const item=declared.get(id);if(item)item.history.push({status,evidence:'test/results/'+file,build:identity?.serviceBuild??null,definitionBound:!!identity,at:identity?.observedAt??statSync(join(results,file)).mtime.toISOString(),timeBasis:identity?'run identity':'artifact modification time'});}
}
const finalPath='test/results/NativeFinal101126.tap',finalText=existsSync(join(root,finalPath))?read(finalPath):'',nativeIdentity=stamp(finalText),nativeBound=matches(nativeIdentity);
const nativeSuite=Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(key=>[key,Number(new RegExp('^# '+key+' (\\d+)$','m').exec(finalText)?.[1]??NaN)]));
const nativeRows=[...finalText.matchAll(/^(ok|not ok) \d+ - [^\r\n]+/gm)],nativePlan=/^1\.\.(\d+)\s*$/m.exec(finalText);
const nativeComplete=!!nativePlan&&Number(nativePlan[1])===expectedNativeEntries&&nativeRows.length===expectedNativeEntries&&nativeSuite.tests===expectedNativeEntries&&nativeSuite.pass===nativeSuite.tests&&existsSync(join(root,'test/results/NativeFinal101126.exit'))&&read('test/results/NativeFinal101126.exit').trim()==='0'&&!nativeRows.some(row=>row[1]==='not ok'||/#\s+(?:SKIP|TODO)\b/i.test(row[0]))&&!/^Bail out!/m.test(finalText)&&nativeSuite.fail===0&&nativeSuite.cancelled===0&&nativeSuite.skipped===0&&nativeSuite.todo===0;
for(const[id,status]of observations(finalText,true)){const item=declared.get(id);if(item?.subtype==='native'){item.status=nativeBound&&nativeComplete?status:'unrun';item.evidence=finalPath;item.evidenceBuild=nativeIdentity?.serviceBuild??null;if(!nativeBound||!nativeComplete)item.blocker='Missing/mismatched source/test identity or incomplete/unsuccessful final native suite.';}}
const browser=json('test/results/BrowserChecks101126.json');
const browserComponents=['dashboard/index.html','dashboard/app.js','dashboard/style.css',...['service','activity','source-search','bridge','tools','redact','config','decompile','exec','catalog','limits','log'].map(name=>'dist/'+name+'.js')];
const reuse=browser?.reuseVerification;
const browserReusable=!!reuse&&reuse.sourceServiceBuild===browser.serviceBuild&&reuse.targetServiceBuild===build.serviceBuild&&reuse.targetArtifactDigest===build.artifactDigest&&browserComponents.every(path=>typeof reuse.files?.[path]==='string'&&existsSync(join(root,path))&&createHash('sha256').update(readFileSync(join(root,path))).digest('hex')===reuse.files[path]);
const browserCurrent=browser?.serviceBuild===build.serviceBuild&&browserComponents.slice(0,3).every(path=>typeof browser.sourceHashes?.[path]==='string'&&createHash('sha256').update(readFileSync(join(root,path))).digest('hex')===browser.sourceHashes[path]);
if(browser){const seen=new Set();for(const row of browser.tests??[]){if(seen.has(row.id))throw new Error('Duplicate browser case '+row.id);seen.add(row.id);const item=declared.get(row.id);if(item?.subtype!=='browser')continue;
 item.status=['pass','fail','pending','blocked','unrun'].includes(row.status)?row.status:'unrun';item.observed=row.observed??null;item.evidence=row.evidence??item.evidence;item.evidenceBuild=browser.serviceBuild??null;item.history=(row.history??[]).map(history=>typeof history==='string'?{status:/timed out|denied|blocked/i.test(history)?'pending':'observed',observed:history}:history);
 if(item.status==='pass'&&!browserCurrent&&!browserReusable){item.status='unrun';item.blocker='Browser observation is not bound to these UI and service bytes; recheck compatibility.';}
 if(item.status==='pass'){item.acceptedForBuild=build.serviceBuild;if(browserReusable)item.reuseNotice='UI and HTTP component bytes match; original observed build is retained.';}
}}
const liveProof=json('test/results/LiveClientFinal101126.json');
if(liveProof){const seen=new Set();for(const row of liveProof.tests??[]){if(seen.has(row.id))throw new Error('Duplicate live case '+row.id);seen.add(row.id);const item=declared.get(row.id);if(item?.kind!=='live')continue;
 item.status=matches(liveProof.build)&&['pass','fail','pending','blocked','unrun'].includes(row.status)?row.status:'unrun';item.observed=row.observed??null;item.evidence=row.evidence??'test/results/LiveClientFinal101126.json';item.evidenceBuild=liveProof.build?.serviceBuild??null;item.history=(row.history??[]).map(h=>typeof h==='string'?{status:'observed',observed:h}:h);if(!matches(liveProof.build))item.blocker='Actual-client evidence is not bound to this source/test build.';
}}
function exportDigest(){const base=join(root,'.publication/rift-public');if(!existsSync(base))return null;const hash=createHash('sha256');function visit(folder=''){for(const entry of readdirSync(join(base,folder),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(folder,entry.name).replaceAll('\\','/');if(entry.name==='.git'||path==='reports/RiftMilestones101126.json')continue;if(entry.isSymbolicLink())throw new Error('Export symlink refused');if(entry.isDirectory())visit(path);else hash.update(path).update(readFileSync(join(base,path)));}}visit();return hash.digest('hex');}
for(const [id,path]of[['M8-EX01','test/results/PublicationFinal101126.json'],['M3-OC01','test/results/EntryPointsFinal101126.json']]){
  const proof=json(path),item=declared.get(id);if(!proof)continue;
  item.evidenceBuild=proof.build?.serviceBuild??null;item.checks=proof.total;
  item.history.push(...(proof.history??[]).map(h=>typeof h==='string'?{status:'observed',observed:h}:h));
  item.status=!matches(proof.build)||(id==='M8-EX01'&&proof.exportManifestDigest!==exportDigest())?'unrun':proof.passed>0&&proof.passed===proof.total&&(id!=='M8-EX01'||proof.credentialScan==='PASS'&&proof.personalDataScan==='PASS')?'pass':'fail';
 if(item.status==='unrun')item.blocker='Evidence is not bound to this source/test build.';
}
for(const file of readdirSync(results).filter(f=>/^Publication.*\.log$/.test(f))){if(/AssertionError|Error:/.test(readFileSync(join(results,file),'utf8')))declared.get('M8-EX01').history.push({status:'fail',evidence:'test/results/'+file,at:statSync(join(results,file)).mtime.toISOString(),build:null});}
for(const item of declared.values())item.history.sort((a,b)=>(a.at??'').localeCompare(b.at??''));
const tests=[...declared.values()],count=items=>({passed:items.filter(i=>i.status==='pass').length,total:items.length,failed:items.filter(i=>i.status==='fail').length,pending:items.filter(i=>i.status==='pending').length,blocked:items.filter(i=>i.status==='blocked').length,unrun:items.filter(i=>i.status==='unrun').length});
const milestones=Object.fromEntries(['M3','M4','M5/M7','M6','M8','M9','M10'].map(id=>[id,{automated:count(tests.filter(t=>t.kind==='automated'&&t.milestones.includes(id))),live:count(tests.filter(t=>t.kind==='live'&&t.milestones.includes(id)))}]));
const totals={automated:count(tests.filter(t=>t.kind==='automated')),live:count(tests.filter(t=>t.kind==='live')),uniqueOverall:count(tests)};
const blockers=tests.filter(t=>t.status!=='pass').map(t=>({id:t.id,status:t.status,reason:t.blocker??t.observed??(t.kind==='live'?'Actual client observation pending; no synthetic substitute.':'See linked evidence; missing observation is not a pass.')}));
const preservation=json('test/results/PreservationFinal101126.json'),baseline=json('test/results/BaselineFinal101126.json'),availability=json('test/results/LiveClientAvailability101126.json'),publicationDelivery=json('test/results/GitHubDelivery101126.json');
if(!preservation?.passed)blockers.push({id:'PRESERVATION',status:'unrun',reason:'Fresh preservation verification is required.'});
const baselinePaths=[...['bridge','config','decompile','exec','index','limits','log','redact','setup','tools'].map(n=>'src/'+n+'.ts'),...['run-mock','run-refinement','run-loader','exec.test','lib','catalog'].map(n=>'test/'+n+'.mjs')];
const baselineProof=baseline?.reuseVerification?.evidence==='.checkpoints/milestones101126/StandaloneReuse101126.json'?json(baseline.reuseVerification.evidence):null;
const baselineRows=baseline?.suites?.flatMap(s=>s.tests??[])??[],generation=baseline?.excludedModelCases??[];
// This frozen standalone inventory is separate from the changing M3–M10 native suite.
const baselineInventory={mock:99,refinement:7,loader:7,execution:14},generationIds=Array.from({length:10},(_,n)=>'GEN-'+String(n+1).padStart(2,'0'));
const baselineCounts=baseline?.passed===true&&baselineRows.length===127&&baseline.suites?.length===4&&Object.entries(baselineInventory).every(([name,total])=>baseline.suites.some(s=>s.suite===name&&s.total===total&&s.passed===total&&s.tests?.length===total))&&new Set(baselineRows.map(t=>t.id)).size===baselineRows.length&&baselineRows.every(t=>t.status==='pass')&&baseline.totals?.passed===127&&baseline.totals?.total===127&&generation.length===10&&generationIds.every(id=>generation.filter(t=>t.id===id&&t.status==='unrun').length===1)&&generation.every(t=>!baselineRows.some(b=>b.id===t.id))&&baseline.catalogWithUnrunGeneration?.passed===127&&baseline.catalogWithUnrunGeneration?.total===137&&baseline.catalogWithUnrunGeneration?.unrun===10;
const baselineReusable=baselineProof?.passed===true&&baselinePaths.every(path=>baselineProof.files?.some(f=>f.path===path&&existsSync(join(root,path))&&f.sha256===createHash('sha256').update(readFileSync(join(root,path))).digest('hex')))&&baselineProof.readerTemplateSha256===createHash('sha256').update(readFileSync(join(root,'luau/bootstrap.template.luau'))).digest('hex');
if(!baselineCounts||!baselineReusable)blockers.push({id:'BASELINE',status:'unrun',reason:'Baseline counts/catalog or measured dependency-hash reuse no longer match.'});
if(!nativeComplete)blockers.push({id:'NATIVE_SUITE',status:'unrun',reason:'Require a complete matching TAP plan, every native/meta/wrapper entry, terminal summary and successful runner exit.'});
const report={schemaVersion:1,document:'RiftMilestones101126',scopeVersion:'windows-client-2',scope:'Windows CLI/setup, local dashboard, normal OpenCode and existing Rift client; no separate editor/demo dependency.',status:blockers.length?'VALIDATION_PENDING':'COMPLETE_LOCAL_VERIFICATION',observedAt:new Date().toISOString(),build,totals,milestones,nativeSuite,
 counting:'Each case ID counts once. Repeated runs/assertions add history only. Shared live IDs can appear in multiple milestone rows; uniqueOverall deduplicates them. Baselines are separate, not extra new-milestone credit.',tests,baseline,preservation,availability,blockers,browserProvenance:{observedServiceBuild:browser?.serviceBuild??null,observedSourceHashes:browser?.sourceHashes??null,reusedForBuild:browserReusable?build.serviceBuild:null,verification:reuse??null},
 supersededAcceptance:{reason:'Owner removed the separate editor/demo requirement from the entire deliverable; historical definitions/evidence are preserved, not silently repassed.',withdrawnIds:['M4-05','M9-S01','M3-R01','M3-R02','M10-R03'],archive:'.checkpoints/milestones101126/SupersededEditorScope/'},
 historicalEvidence:{product:'7d15dc2b9de37e86',reader:'bdbf0a0fc595',reportedAutomated:'125/125',reportedLive:'12/12',reuse:'Historical M2 only. No new shared-service/client/image-route live pass is inherited.'},
  publicationDelivery,constraints:{headlessModelTestCalls:0,commits:publicationDelivery?.commits??0,pushes:publicationDelivery?.pushes??0,publication:publicationDelivery?.published===true,publicationApproved:publicationDelivery?.approved===true,parentWorkspaceCommits:0,originalCheckoutModified:preservation?.originalSourceUnchanged===true?false:null,nativeDelegation:'Astra implementation/review and configured go-gameplay browser QA; cancelled Fable task earns no review credit.'}};
writeFileSync(join(root,'RiftMilestones101126.json'),JSON.stringify(report,null,2)+'\n');
const table=Object.entries(milestones).map(([id,m])=>`| ${id} | ${m.automated.passed}/${m.automated.total} | ${m.live.passed}/${m.live.total} | ${m.automated.failed+m.live.failed} | ${m.automated.pending+m.live.pending+m.automated.blocked+m.live.blocked+m.automated.unrun+m.live.unrun} |`).join('\n');
const markdown=[
 '# Rift M3–M10 — Windows/OpenCode delivery, 101126',
  `Status: **${report.status}**. ${publicationDelivery?.published?'Published source candidate; remaining live checks are not implied to pass.':publicationDelivery?.approved?'Source candidate; owner approved the dedicated GitHub update, not yet pushed.':'Local, uncommitted and unpublished candidate.'} ${report.scope}`,
 `Build: \`${build.serviceBuild}\`; reader: \`${build.expectedReaderBuild}\`.`,
 '| Milestone | Automated passed/total | Live passed/total | Failed | Pending/unrun |\n|---|---:|---:|---:|---:|\n'+table,
 `Unique required cases: **${totals.uniqueOverall.passed}/${totals.uniqueOverall.total} passed**; automated ${totals.automated.passed}/${totals.automated.total}, live ${totals.live.passed}/${totals.live.total}. ${report.counting}`,
 '## Evidence',
  `- Native: \`${finalPath}\`; source/test binding ${nativeBound?'matches':'MISSING/MISMATCHED'}, complete suite ${nativeComplete?'verified':'PENDING'}, ${nativeSuite.pass??0}/${nativeSuite.tests??0} Node entries passed. Node entries include report meta checks and the legacy execution wrapper; only declared milestone IDs enter the milestone totals.\n- Normal Windows/OpenCode: \`test/results/EntryPointsFinal101126.json\`.\n- Browser: \`test/results/BrowserChecks101126.json\`; synthetic reader data is not a live-client pass.\n- Export: \`test/results/PublicationFinal101126.json\`; preservation: \`test/results/PreservationFinal101126.json\`.`,
 `Non-model baseline: ${baseline?.totals?.passed??0}/${baseline?.totals?.total??0}; broader catalog including separately unrun generation cases: ${baseline?.catalogWithUnrunGeneration?.passed??0}/${baseline?.catalogWithUnrunGeneration?.total??0}, ${baseline?.catalogWithUnrunGeneration?.unrun??0} unrun. See the reuse/provenance fields in \`test/results/BaselineFinal101126.json\`. Failed and interrupted attempts remain in history.`,
 '## Delivered locally',
 'One explicit service owner; status/doctor CLI; private journaled Windows setup; original activity-first local dashboard; bounded cursor logs; revision-aware literal cache search; explicit client-window preview/crop/typed-image sharing; reversible migration and credential-free local source export. No extra editor, playtest demo, plugin or server companion is needed. See docs/Milestones101126.md, docs/Capabilities101126.md and docs/Migration101126.md.',
 '## Windows quick start',
 '```powershell\npwsh -NoProfile -File ".\\tools\\rift-bridge\\setup.ps1" -ConfigPath ".\\.opencode\\opencode.json" -Apply -InstallDependencies\n.\\tools\\rift-bridge\\rift.cmd serve\n# second terminal:\n.\\tools\\rift-bridge\\rift.cmd status --json\n.\\tools\\rift-bridge\\rift.cmd doctor --json\n```',
  'Dependency installation requires the explicit opt-in flag; no install or parent-workspace commit was performed by the lead. Dedicated GitHub publication status is recorded separately. Stop a legacy standalone owner before starting serve. Reuse the existing local credential/reader; never expose it in URLs, screenshots or reports.',
 '## Consolidated remaining checklist',
  (tests.some(t=>t.subtype==='browser'&&t.status!=='pass')?'Complete the pending actual-browser IDs with approved browser tools; static/HTTP checks are not browser observations.\n\n':'Browser validation is complete for the recorded component bytes; its synthetic reader is separate from actual-client evidence.\n\n')+tests.filter(t=>t.kind==='live'&&t.status!=='pass').map(t=>`- ${t.id}: **${t.status}** — ${t.observed??t.title}`).join('\n')+'\n\nDo not reexecute an already connected reader or rotate credentials without a specific need. Record only newly observed live evidence; model-test budget remains zero. Dedicated GitHub approval/status is recorded separately.',
 'Outstanding IDs: '+(blockers.map(b=>'`'+b.id+'`').join(', ')||'none')+'.',
];
writeFileSync(join(root,'RiftMilestones101126.md'),markdown.join('\n\n')+'\n');
console.log(JSON.stringify({status:report.status,build,totals,blockers:blockers.map(b=>b.id)},null,2));
