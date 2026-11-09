// Phase 3 report: preserves Opus's validation files and all prior attempts.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG, REQUIREMENTS, INVALIDATED } from './catalog.mjs';
import { ROOT, RESULTS, revision, templateBuild, ddmmyy } from './lib.mjs';

const rev=revision(), stamp=ddmmyy();
const baseline=JSON.parse(readFileSync(join(ROOT,'VoltResults091126.json'),'utf8'));
const runs=readdirSync(RESULTS).filter(f=>/^(mock|gen|live-.*|refinement)-\d{4}-.*\.json$/.test(f))
 .map(file=>({file,...JSON.parse(readFileSync(join(RESULTS,file),'utf8'))}))
 .filter(r=>Array.isArray(r.results)).sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
const tests=CATALOG.map(t=>{
 const history=runs.flatMap(run=>run.results.filter(a=>a.id===t.id).map(a=>({...a,revision:run.revision,runId:run.runId,file:run.file,invalidated:INVALIDATED[run.runId]??null})));
 const current=history.filter(a=>a.revision===rev&&!a.invalidated).at(-1);
 return {...t,status:current?.status??'not-run',actual:current?.actual??null,assertions:current?.assertions??[],
  evidence:current?{file:`test/results/${current.file}`,extra:current.evidence,at:current.at}:null,
  inherited:baseline.tests.find(b=>b.id===t.id)?.status??null,history};
});
const counts=list=>{
 const c={passed:0,total:list.length,failed:0,blocked:0,notRun:0};
 for(const t of list)c[{pass:'passed',fail:'failed',blocked:'blocked','not-run':'notRun'}[t.status]]++;
 c.percent=c.total?Math.floor(10000*c.passed/c.total)/100:0;return c;
};
const areas=[...new Set(CATALOG.map(t=>t.area))].map(area=>({area,all:counts(tests.filter(t=>t.area===area)),mock:counts(tests.filter(t=>t.area===area&&t.kind==='mock')),live:counts(tests.filter(t=>t.area===area&&t.kind==='live'))}));
const limits={
 R28:'Traversal/queues/serialized output are bounded. Native GetChildren/getscripts/getproperties allocate their own full snapshots and cannot be preempted by the bridge; the harness does not prove a universal native allocation/frame-time budget.',
 R38:'GEN-09 exercises instruction-like names and attributes. A separate decompiled-source prompt-injection workflow is not in this required suite; game text is always marked untrusted, but universal prompt-injection immunity is not claimed.',
};
const coverage=Object.entries(REQUIREMENTS).map(([id,requirement])=>{
 const ts=tests.filter(t=>t.req.includes(id));
 return {id,requirement,coverage:!ts.length?'missing':limits[id]||ts.some(t=>t.status!=='pass')?'partial':'covered',tests:ts.map(t=>t.id),limitation:limits[id]??null};
});
const total=counts(tests);
const report={generatedAt:new Date().toISOString(),revision:rev,readerBuild:templateBuild(),verdict:total.passed===total.total?'VALIDATED required suite':'NOT VALIDATED',
 scoreFormula:'100 * passed / all required tests; blocked and not-run remain in denominator',overall:total,mock:counts(tests.filter(t=>t.kind==='mock')),live:counts(tests.filter(t=>t.kind==='live')),areas,
 inherited:{revision:baseline.productRevision,passed:117,total:117,newlyExecuted:false,files:['VoltValidation091126.md','VoltResults091126.json']},
 scope:'Existing read-only bridge/reader only. CLI/dashboard/setup redesign/renaming deferred until the refinement gate.',coverage,tests};
writeFileSync(join(ROOT,`RefinementResults${stamp}.json`),JSON.stringify(report,null,2));
const esc=x=>String(x??'').replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
const row=c=>`${c.passed}/${c.total} | ${c.percent}% | ${c.failed} | ${c.blocked} | ${c.notRun}`;
let md=`# Phase 3 refinement ${stamp}\n\n**${report.verdict}**. Current product \`${rev}\`; reader build \`${report.readerBuild}\`. Score **${total.percent}% = 100 × ${total.passed}/${total.total}**. Unrun/blocked tests remain in the denominator.\n\n`;
md+='## Recovery and ownership\n\n- Current code initially matched inherited product `dcf4bf2be4db38c8`, reader `751daab2d900`; fresh build passed and all 117 saved passing records matched their referenced result files/assertions. Those results are inherited, not new checks of the refined revision.\n- Repository-wide instructions and existing handoff were read. No HARNESS.md or bridge-specific AGENTS.md was found. This is shared tooling, not a game-source/Studio task. No Studio operations were performed. Unrelated dirty/deleted game files were preserved; the entire bridge is untracked, so `git diff` alone cannot represent this change.\n- Claude-Mem search/timeline/selected observations and Headroom-backed session context recovered the previous work. Tool access confirmed memory, Serena and Context7. Live bridge is driven over its existing local test host, not Roblox Studio.\n- Node 25.8.0, OpenCode 2.2.6, official MCP SDK 1.32.2 unchanged. No installs. Inherited test pins were Claude Opus; owner explicitly approved only the two test-agent pins switching to `openai/gpt-6.1-sol`, confirmed in model catalog. Global/default provider settings untouched.\n- Budget: 17 prior calls approved / 16 reported used; owner approved +4 (five available), then +2 to repeat ambiguous mock A/B while retaining C. Total approval 23, up to seven new calls. No fallback or automatic model rotation.\n\n';
md+='## Gap table (presented before production edits)\n\n| Priority | Gap | Regression / fix |\n|---|---|---|\n';
for(const [p,g,t]of[
 ['High','Concurrent authentication could admit two takeover readers','AUTH-11: recheck the current reader after every awaited probe; ignore inactive-transport messages'],
 ['High','Opaque browser Origin null accepted','AUTH-12: reject opaque browser Origin before handshake'],
 ['High','Hash changed during native decompile cached under old hash','CAC-12: reject bytecode_changed, preserve retryable flag, never cache under stale key'],
 ['Medium','Reader source truncation lost in MCP/cache','DEC-11: preserve sourceTruncated, partial and source_limit metadata'],
 ['Medium','Trimmed last page kept hasMore false','AST-11: hasMore true with continuation offset'],
 ['Medium','Depth pruning not disclosed','OBJ-11: partial/max_depth only for a non-leaf frontier'],
 ['Medium','Generation output isolation not enforced','GEN-11: shared exclusive filesystem lease; both real runners refuse overlap before model calls'],
 ['Low','README contradicted historical live tests','Update evidence status, get_status options and refinement behaviour without setup redesign'],
])md+=`| ${p} | ${g} | ${t} |\n`;
md+='\nEach added behaviour was seen failing before its fix; RED/GREEN attempts are preserved in test/results/refinement-*.json. The reconnect fallback, reconnect-aware get_status, Enum normalization and build stamp are retained. No generated script is executed by the bridge.\n\n';
md+='## Inventory\n\n| MCP tool | Reader operation(s) | Inputs / modes |\n|---|---|---|\n| get_status | status | automatic startup wait; explicit 0..30000 ms wait; listener-only when disconnected |\n| list_children | list_children | game root / session id / exact path segments; IsA class; offset, limit 1..200 |\n| search_instances | search_instances | root id/path; contains/exact/prefix; case sensitivity; IsA/exact class; depth/visit/deadline; offset/limit |\n| inspect_instance | inspect_instance | id/path; selected/all readable properties; attributes/tags/assets toggles; depth/string/property bounds |\n| list_scripts | list_scripts | cached getscripts/loaded/running union; loaded/running/class/name/path filters; refresh/hash; offset/limit |\n| read_script | script_info, decompile | id/path or jobId poll; refresh/options; wait 0..25000; startLine/maxLines; session+hash+options cache |\n\n';
md+='References use ids within one reader session or arrays of exact child names; `{}` means game. Duplicate names are separately identified by ids and disclosed path ambiguity. String-path metadata is not parsed/executed. Errors include bad_ref/not_found/stale_object_id/unknown_object_id, not_connected/disconnected/send_failed, queue_full/reader_busy, deadline_exceeded/wait_expired, unknown_op, unsupported_script/not_a_script/decompile_failed/bytecode_changed, unknown_job/stale_job/cache_evicted, too_large and encode/serialization errors. The dispatcher has no eval, mutation, remote or hook operation.\n\n';
md+='## Requirement coverage\n\nCovered means exercised by the listed scenarios, not exhaustive correctness for every Roblox value/game. Partial classifications disclose workflow/measurement limits.\n\n| Requirement | Coverage | Supporting test IDs / limitation |\n|---|---|---|\n';
for(const c of coverage)md+=`| ${c.id}: ${esc(c.requirement)} | ${c.coverage} | ${c.tests.join(', ')}${c.limitation?' — '+esc(c.limitation):''} |\n`;
md+='\n## Current-revision results (newly executed only)\n\n| Area | Passed/total | % | Failed | Blocked | Not run | Mock P/T | Live P/T |\n|---|---|---|---|---|---|---|---|\n';
for(const a of areas)md+=`| ${a.area} | ${row(a.all)} | ${a.mock.passed}/${a.mock.total} | ${a.live.passed}/${a.live.total} |\n`;
md+=`| **Overall** | ${row(total)} | ${report.mock.passed}/${report.mock.total} | ${report.live.passed}/${report.live.total} |\n\n`;
md+='## Test results and evidence\n\nFull expected/actual/assertions and all attempts are in RefinementResults'+stamp+'.json; preserved raw runs and transcripts remain under test/results/.\n\n| Test | Kind | Status | Expected | Actual | Evidence |\n|---|---|---|---|---|---|\n';
for(const t of tests){const actual=JSON.stringify(t.actual);md+=`| ${t.id} | ${t.kind} | ${t.status} | ${esc(t.expected)} | ${esc(actual?.slice(0,260))} | ${t.evidence?.file??'not run on current revision'} |\n`;}
md+='\n## Inherited test changes, rescoring and isolation\n\nAll prior CORRECTIONS and invalidated attempts remain in the inherited catalog/reports. Prior Vector3 key-order correction was valid; search scoping corrected the expected fixture count; Windows backoff timing was increased with extra assertions; UTF-8 streaming was fixed in the test client. GEN rescoring reran saved generated artifacts rather than a new AI call and is labelled as inherited. Two stale-log REC-L4 passes remain invalidated. Substring transcript attribution remains a secondary filter, not proof of write ownership; the new shared generation lease now prevents cross-suite output overlap. The refined cycle runs model jobs sequentially.\n\nThe first Sol mock A/B calls correctly asked which of two Door.1 models to select and saved no file (8 failed GEN cases retained). With explicit owner approval, the request was clarified to select the model tagged Door; no asset id, expected result, assertion or denominator was relaxed. Only A/B are rerun; passing disconnected C is reused on the same product revision. See CORRECTIONS in test/catalog.mjs and all fresh gen-* records.\n\n';
md+='## Verification boundaries / next gate\n\nThe complete required suite is 124 tests (117 preserved + 7 additive regressions). After implementation changes, old-revision successes are not counted as current passes. Fresh live claims require build b06652975e46, and generated scripts require owner manual execution. No broad claim of prompt-injection immunity, native decompiler cancellation, or universally bounded native snapshot allocation is made. CLI/dashboard are not implemented by this refinement report.\n';
writeFileSync(join(ROOT,`Refinement${stamp}.md`),md);
console.log(JSON.stringify({verdict:report.verdict,revision:rev,overall:total,mock:report.mock,live:report.live},null,2));
