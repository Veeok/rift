// Builds VoltValidation081126.md and VoltResults081126.json from every saved run in test/results/.
// Final status per test = latest attempt on the CURRENT product revision; older attempts are history.
// Tests without a current-revision attempt are "not-run". Score = 100 * passed / all required tests.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AREAS, CATALOG, CORRECTIONS, INVALIDATED, REQUIREMENTS } from "./catalog.mjs";
import { RESULTS, ROOT, ddmmyy, revision } from "./lib.mjs";

const STAMP = ddmmyy(); // DDMMYY of the report date
const rev = revision();
const runs = readdirSync(RESULTS)
	.filter((f) => /^(mock|gen|live-.*)-\d{4}-.*\.json$/.test(f))
	.map((f) => ({ file: f, ...JSON.parse(readFileSync(join(RESULTS, f), "utf8")) }))
	.sort((a, b) => a.startedAt.localeCompare(b.startedAt));

const attempts = new Map(CATALOG.map((t) => [t.id, []]));
for (const run of runs) for (const r of run.results) attempts.get(r.id)?.push({ ...r, status: INVALIDATED[run.runId] ? "invalidated" : r.status, invalidReason: INVALIDATED[run.runId], runId: run.runId, revision: run.revision, file: run.file });

const tests = CATALOG.map((t) => {
	const all = attempts.get(t.id);
	const current = all.filter((a) => a.revision === rev && a.status !== "invalidated");
	const final = current.at(-1);
	return {
		id: t.id,
		area: t.area,
		kind: t.kind,
		baseline: t.baseline,
		title: t.title,
		requirements: t.req,
		expected: t.expected,
		status: final ? final.status : "not-run",
		actual: final?.actual ?? null,
		assertions: final?.assertions ?? [],
		evidence: final ? { resultsFile: `test/results/${final.file}`, runId: final.runId, extra: final.evidence ?? null } : null,
		history: all.map((a) => ({ runId: a.runId, revision: a.revision, status: a.status, invalidReason: a.invalidReason, at: a.at, failedAssertions: a.assertions.filter((x) => !x.pass).map((x) => ({ name: x.name, detail: x.detail })), exception: a.actual?.exception?.split("\n")[0] })),
	};
});

const count = (list) => {
	const c = { total: list.length, passed: 0, failed: 0, blocked: 0, notRun: 0 };
	for (const t of list) c[{ pass: "passed", fail: "failed", blocked: "blocked", "not-run": "notRun" }[t.status]]++;
	c.percent = c.total ? Math.floor((1000 * c.passed) / c.total) / 10 : 0;
	return c;
};
const areas = Object.keys(AREAS).map((a) => {
	const list = tests.filter((t) => t.area === a);
	return { area: a, name: AREAS[a], all: count(list), mock: count(list.filter((t) => t.kind === "mock")), live: count(list.filter((t) => t.kind === "live")) };
});
const overall = { all: count(tests), mock: count(tests.filter((t) => t.kind === "mock")), live: count(tests.filter((t) => t.kind === "live")), baseline: count(tests.filter((t) => t.baseline)) };
const score = overall.all.total ? (100 * overall.all.passed) / overall.all.total : 0;
const validated = overall.all.passed === overall.all.total;
const scoreText = validated ? "100%" : `${(Math.floor(score * 10) / 10).toFixed(1)}%`;

const reqMap = Object.entries(REQUIREMENTS).map(([id, text]) => {
	const ts = tests.filter((t) => t.requirements.includes(id));
	return { id, text, tests: ts.map((t) => t.id), statuses: ts.map((t) => t.status) };
});
const unmapped = reqMap.filter((r) => r.tests.length === 0).map((r) => r.id);

const json = {
	generatedAt: new Date().toISOString(),
	productRevision: rev,
	verdict: validated ? "VALIDATED" : "NOT VALIDATED",
	score: { formula: "100 * passed / all required tests (blocked and not-run stay in the denominator)", value: Number(score.toFixed(2)), display: scoreText },
	overall,
	areas,
	requirements: reqMap,
	unmappedRequirements: unmapped,
	runs: runs.map((r) => ({ runId: r.runId, suite: r.suite, revision: r.revision, startedAt: r.startedAt, finishedAt: r.finishedAt, file: `test/results/${r.file}`, tests: r.results.length })),
	corrections: CORRECTIONS,
	tests,
};
writeFileSync(join(ROOT, `VoltResults${STAMP}.json`), JSON.stringify(json, null, 2));

const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const brief = (v) => {
	if (v == null) return "";
	const s = typeof v === "string" ? v : JSON.stringify(v);
	return s.length > 220 ? s.slice(0, 217) + "..." : s;
};
const row = (c) => `${c.passed}/${c.total} | ${c.percent}% | ${c.failed} | ${c.blocked} | ${c.notRun}`;
let md = `# Volt-to-OpenCode validation (${STAMP})\n\n`;
md += `**Verdict: ${json.verdict}**. Score ${scoreText} = 100 × ${overall.all.passed} passed ÷ ${overall.all.total} required tests. Blocked and not-run tests stay in the denominator.\n\n`;
md += `Product revision \`${rev}\` (sha256 over \`src/**\` and \`luau/bootstrap.template.luau\`). Final status uses only attempts on this revision. Every earlier attempt is kept under each test's history and in \`VoltResults${STAMP}.json\`.\n\n`;
md += `## Totals\n\n| Scope | Passed/Total | % | Failed | Blocked | Not run |\n|---|---|---|---|---|---|\n`;
md += `| **Overall** | ${row(overall.all)} |\n| Mock (automated) | ${row(overall.mock)} |\n| Live (Roblox + Volt) | ${row(overall.live)} |\n| Baseline 100 | ${row(overall.baseline)} |\n\n`;
md += `## Per area\n\n| Area | All: P/T | % | F | B | NR | Mock: P/T | % | F | B | NR | Live: P/T | % | F | B | NR |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const a of areas) md += `| ${a.area} ${a.name} | ${row(a.all)} | ${row(a.mock)} | ${a.live.total ? row(a.live) : "0/0 | - | 0 | 0 | 0"} |\n`;
md += `\n## Requirement and tool coverage\n\n${unmapped.length ? "Unmapped: " + unmapped.join(", ") : "Every requirement and tool maps to at least one test."}\n\n| Req | Description | Tests |\n|---|---|---|\n`;
for (const r of reqMap) md += `| ${r.id} | ${esc(r.text)} | ${r.tests.map((id, i) => `${id} (${r.statuses[i]})`).join(", ")} |\n`;
md += `\n## Test results\n\n| ID | Kind | Title | Expected | Actual (summary) | Status | Evidence |\n|---|---|---|---|---|---|---|\n`;
for (const t of tests) md += `| ${t.id} | ${t.kind}${t.baseline ? "" : " (added)"} | ${esc(t.title)} | ${esc(t.expected)} | ${esc(brief(t.actual))} | **${t.status}** | ${t.evidence ? `\`${t.evidence.resultsFile}\`${t.evidence.extra ? " · " + esc(brief(t.evidence.extra)) : ""}` : "-"} |\n`;
md += `\n## Test and product corrections\n\n| Test | Kind | Change | Reason |\n|---|---|---|---|\n`;
for (const c of CORRECTIONS) md += `| ${c.id} | ${c.kind} | ${esc(c.change)} | ${esc(c.reason)} |\n`;
md += `\n## Failure history (all revisions)\n\n`;
const hist = tests.filter((t) => t.history.some((h) => h.status !== "pass"));
if (!hist.length) md += "No failed or blocked attempts recorded.\n";
for (const t of hist) {
	md += `- **${t.id}** (final: ${t.status})\n`;
	for (const h of t.history.filter((x) => x.status !== "pass")) md += `  - ${h.runId} rev ${h.revision}: ${h.status}${h.invalidReason ? " (" + esc(h.invalidReason) + ")" : ""}${h.exception ? " · " + esc(h.exception) : ""}${h.failedAssertions.length ? " · " + h.failedAssertions.map((f) => esc(f.name) + (f.detail !== undefined ? " = " + esc(brief(f.detail)) : "")).join("; ") : ""}\n`;
}
md += `\n## Runs\n\n| Run | Suite | Revision | Tests | File |\n|---|---|---|---|---|\n`;
for (const r of json.runs) md += `| ${r.runId} | ${r.suite} | ${r.revision} | ${r.tests} | \`${r.file}\` |\n`;
writeFileSync(join(ROOT, `VoltValidation${STAMP}.md`), md);
console.log(JSON.stringify({ verdict: json.verdict, score: scoreText, overall, revision: rev }, null, 1));
