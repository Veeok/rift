// Live phases (real Roblox client + Volt). Requires test/live-host.mjs running.
//   node test/run-live.mjs pre                      AUTH-L1 OBJ-L1 SER-L1 AST-L1 DEC-L1 CAC-L1
//   node test/run-live.mjs gen L1|L3                OpenCode generates a script from live data
//   node test/run-live.mjs manual GEN-L2|GEN-L3 <reportFile>   record the user's manual Volt execution
//   node test/run-live.mjs rec                      REC-L1 REC-L2 REC-L3
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOG } from "./catalog.mjs";
import { RESULTS, ROOT, TMP, Recorder, ddmmyy, templateBuild, luauSyntaxCheck, portOpen, sleep, waitFor, acquireGenerationLock } from "./lib.mjs";

const OPENCODE = "C:/LOCAL_USER\\AppData\\Roaming\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe";
const STATE = join(TMP, "live-state.json");
const EXPORTS = join(ROOT, "exports");
const phase = process.argv[2];
if (phase === 'gen' || phase === 'gen-rescore') {
	const releaseGeneration = acquireGenerationLock();
	process.once('exit', releaseGeneration);
}
const rec = new Recorder("live-" + phase + (process.argv[3] ? "-" + process.argv[3] : ""), CATALOG);
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const saveState = () => writeFileSync(STATE, JSON.stringify(state, null, 2));
const host = async (path, body) => (await fetch("http://127.0.0.1:38960" + path, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined })).json();
const call = (name, args = {}, timeoutMs) => host("/call", { name, args, timeoutMs });
const status = async () => (await host("/status")).status;
const nameOf = (n) => (typeof n === "string" ? n : n?.v);
const errCode = (r) => r.json?.error?.code ?? (r.isError ? "error" : null);

async function readScript(ref, extra = {}) {
	let r = await call("read_script", { script: ref, waitMs: 25000, maxLines: 400, ...extra }, 120000);
	const t0 = Date.now();
	while (r.json?.status === "pending" && Date.now() - t0 < 300000) r = await call("read_script", { jobId: r.json.jobId, waitMs: 25000, maxLines: 400 }, 120000);
	return r;
}

if (phase === "pre") {
	const st = await waitFor(async () => {
		const s = await status();
		return s?.connected && s;
	}, 180000, 1000);
	await rec.run("AUTH-L1", async (check) => {
		const caps = st?.reader?.capabilities ?? [];
		check("connected", st?.connected === true, st?.listener);
		check("executor name reported", st?.reader?.executor?.name && st.reader.executor.name !== "unknown", st?.reader?.executor);
		check("placeId > 0", st?.reader?.place?.placeId > 0, st?.reader?.place);
		check("capabilities include decompile/getproperties/getscripts", ["decompile", "getproperties", "getscripts"].every((c) => caps.includes(c)), caps);
		check("live status op answered", !!st?.live?.observedAt, st?.live);
		check("live reader runs the final reader build", st?.reader?.readerBuild === templateBuild(), { reported: st?.reader?.readerBuild, expected: templateBuild() });
		state.session = st?.reader?.session;
		state.place = st?.reader?.place;
		state.executor = st?.reader?.executor;
		return { actual: { reader: st?.reader, live: st?.live } };
	});
	await rec.run("OBJ-L1", async (check) => {
		const root = await call("list_children", { limit: 200 });
		const names = root.json?.items?.map((i) => nameOf(i.name)) ?? [];
		const parts = await call("search_instances", { root: { path: ["Workspace"] }, className: "BasePart", limit: 10, maxVisited: 20000 });
		check("root lists Workspace", names.includes("Workspace"), names.slice(0, 30));
		check("search ok", parts.json?.ok === true, parts.json?.error);
		check(">=1 BasePart", (parts.json?.items?.length ?? 0) >= 1, parts.json?.items?.length);
		state.partId = parts.json?.items?.[0]?.id;
		return { actual: { rootNames: names, firstParts: parts.json?.items?.slice(0, 3), visited: parts.json?.visited, partial: parts.json?.partialReason } };
	});
	await rec.run("SER-L1", async (check) => {
		const r = await call("inspect_instance", { target: { id: state.partId }, maxProperties: 300 });
		const p = r.json?.properties ?? {};
		const failed = Object.entries(p).filter(([, v]) => v && typeof v === "object" && v.error === "serialize_failed").map(([k]) => k);
		check("inspect ok", r.json?.ok === true, r.json?.error);
		check("Size is Vector3", p.Size?.t === "Vector3", p.Size);
		check("CFrame is CFrame", p.CFrame?.t === "CFrame" && p.CFrame.c?.length === 12, p.CFrame);
		check("no serialize_failed", failed.length === 0, failed);
		const types = [...new Set(Object.values(p).map((v) => (v && typeof v === "object" ? v.t : typeof v)))];
		return { actual: { object: r.json?.object, propertyCount: r.json?.propertyCount, types, errors: r.json?.errors } };
	});
	await rec.run("AST-L1", async (check) => {
		const found = [];
		for (const cls of ["Decal", "Texture", "Sound", "MeshPart", "SpecialMesh", "ImageLabel", "ImageButton", "ParticleEmitter"]) {
			if (found.length >= 2) break;
			const s = await call("search_instances", { className: cls, classMatch: "exact", limit: 25, maxVisited: 60000 });
			for (const it of s.json?.items ?? []) {
				if (found.length >= 2) break;
				const r = await call("inspect_instance", { target: { id: it.id }, maxProperties: 300 });
				const a = (r.json?.assets ?? []).find((x) => /^\d+$/.test(x.assetId ?? ""));
				if (a && r.json?.pathInfo?.unique && r.json?.pathInfo?.rooted) found.push({ id: it.id, className: it.className, name: nameOf(it.name), path: it.path, segments: r.json.pathInfo.segments.map(nameOf), property: a.name, assetId: a.assetId, uri: a.uri });
			}
		}
		check(">=1 asset-bearing instance with numeric assetId", found.length >= 1, found);
		state.assets = found;
		return { actual: found };
	});
	await rec.run("DEC-L1", async (check) => {
		let pick = null;
		for (const cls of ["LocalScript", "ModuleScript"]) {
			const l = await call("list_scripts", { className: cls, limit: 50, includeHash: true, refresh: true });
			pick ??= (l.json?.items ?? []).find((i) => i.decompileSupport === "supported" && i.hashAvailable && !i.detached);
			state.scriptCounts = { ...(state.scriptCounts ?? {}), [cls]: l.json?.total };
		}
		check("client script found", !!pick, state.scriptCounts);
		const r = pick ? await readScript({ id: pick.id }) : null;
		check("read_script complete", r?.json?.status === "complete", r?.json?.status ?? r?.json?.error);
		check("non-empty source", (r?.texts?.[1] ?? "").trim().length > 0, r?.texts?.[1]?.length);
		state.script = pick && { id: pick.id, path: pick.path, className: pick.className, hash: r?.json?.hash };
		return { actual: { script: pick && { path: pick.path, className: pick.className }, source: r?.json?.source, firstLines: (r?.texts?.[1] ?? "").split("\n").slice(0, 5), elapsedMs: r?.json?.decompileElapsedMs, cacheHit: r?.json?.cache?.hit } };
	});
	await rec.run("CAC-L1", async (check) => {
		const r = await readScript({ id: state.script?.id });
		check("second read complete", r.json?.status === "complete", r.json?.status ?? r.json?.error);
		check("cache hit", r.json?.cache?.hit === true, r.json?.cache);
		return { actual: r.json?.cache };
	});
	saveState();
}

if (phase === "gen") {
	const label = process.argv[3];
	const target = label === "L1" ? state.assets?.[0] : (state.assets?.[1] ?? state.assets?.[0]);
	const prompt =
		"Inspect my running Roblox client through the volt tools and write me a Luau script to run manually in Volt. " +
		`The script should find the ${target.className} named "${target.name}" (observed at ${target.path}) and print its ${target.property} asset id` +
		(label === "L3" ? `, its ClassName, and the name of its parent` : "") +
		". Follow the project instructions for where and how to save it.";
	await host("/stop");
	await waitFor(async () => !(await portOpen(38917)), 10000, 250);
	const t0 = Date.now();
	const before = new Set(existsSync(EXPORTS) ? readdirSync(EXPORTS) : []);
	const child = spawn(OPENCODE, ["run", "--standalone", "--format", "json", "--archived", "--auto", "--agent", "volt-gen", "--title", `volt-live-${label}`, prompt], { cwd: join(ROOT, "test", "genproj-live"), stdio: ["ignore", "pipe", "pipe"] });
	child.stdout.setEncoding("utf8");
	let out = "";
	child.stdout.on("data", (d) => (out += d));
	child.stderr.on("data", () => {});
	const code = await Promise.race([new Promise((r) => child.on("exit", r)), sleep(20 * 60_000).then(() => (child.kill(), "timeout"))]);
	const runFile = join(RESULTS, `${rec.runId}-opencode.jsonl`);
	writeFileSync(runFile, out);
	await waitFor(async () => !(await portOpen(38917)), 15000, 500);
	await host("/start");
	const back = await waitFor(async () => (await status())?.connected, 120000, 1000);
	// A run's output = new .luau exports that its own transcript references (other runs may write concurrently).
	const files = (existsSync(EXPORTS) ? readdirSync(EXPORTS) : []).filter((n) => !before.has(n) && n.endsWith(".luau") && statSync(join(EXPORTS, n)).mtimeMs >= t0 - 1000 && out.includes(n));
	const file = files[0] && join(EXPORTS, files[0]);
	const text = file ? readFileSync(file, "utf8") : "";
	const genChecks = [];
	const check0 = (name, cond, detail) => (genChecks.push({ name, pass: !!cond, detail }), !!cond);
	check0("OpenCode run exited 0", code === 0, code);
	check0("exactly one new export", files.length === 1, files);
	const stamp = file ? ddmmyy(statSync(file).mtimeMs) : "";
	check0(`name <topic>_${stamp}.luau (DDMMYY of the write date)`, new RegExp(`^[a-z0-9_]+_${stamp}(_\\d+)?\\.luau$`).test(files[0] ?? ""), files[0]);
	check0("no bridge ids", file && !/\b[0-9A-Fa-f]{8}:\d+\b/.test(text));
	check0("references the observed object name", text.includes(`"${target.name}"`) || text.includes(`'${target.name}'`));
	check0("references observed path segments", target.segments.slice(0, -1).every((s) => text.includes(s)), target.segments);
	const syn = file ? luauSyntaxCheck(file) : { syntaxErrors: ["no file"] };
	check0("no Luau syntax errors", syn.syntaxErrors.length === 0, syn.syntaxErrors);
	check0("Volt reader reconnected to the restarted host bridge", !!back);
	state["gen" + label] = { file, target, prompt, expected: target.assetId, checks: genChecks, runFile, code };
	saveState();
	if (label === "L1") {
		await rec.run("GEN-L1", async (check) => {
			for (const c of genChecks) check(c.name, c.pass, c.detail);
			return { actual: { file, target: target.path, expectedAssetId: target.assetId }, evidence: runFile };
		});
	}
	console.log(`\nGenerated: ${file}\nExpected manual output includes asset id ${target.assetId}`);
}

if (phase === "gen-rescore") {
	// Re-evaluate GEN-L1/GEN-L3 checks from a saved run (no new model call): same transcript, same exports.
	const label = process.argv[3];
	const saved = JSON.parse(readFileSync(process.argv[4], "utf8"));
	const g = saved.state["gen" + label];
	const out = readFileSync(g.runFile, "utf8");
	const target = g.target;
	const files = (existsSync(EXPORTS) ? readdirSync(EXPORTS) : []).filter((n) => n.endsWith(".luau") && out.includes(n));
	const file = files[0] && join(EXPORTS, files[0]);
	const text = file ? readFileSync(file, "utf8") : "";
	const genChecks = [];
	const check0 = (name, cond, detail) => (genChecks.push({ name, pass: !!cond, detail }), !!cond);
	check0("OpenCode run exited 0", g.code === 0, g.code);
	check0("exactly one new export (referenced by this run's transcript)", files.length === 1, files);
	const stamp = file ? ddmmyy(statSync(file).mtimeMs) : "";
	check0(`name <topic>_${stamp}.luau (DDMMYY of the write date)`, new RegExp(`^[a-z0-9_]+_${stamp}(_\\d+)?\\.luau$`).test(files[0] ?? ""), files[0]);
	check0("no bridge ids", file && !/\b[0-9A-Fa-f]{8}:\d+\b/.test(text));
	check0("references the observed object name", text.includes(`"${target.name}"`) || text.includes(`'${target.name}'`));
	check0("references observed path segments", target.segments.slice(0, -1).every((s) => text.includes(s)), target.segments);
	const syn = file ? luauSyntaxCheck(file) : { syntaxErrors: ["no file"] };
	check0("no Luau syntax errors", syn.syntaxErrors.length === 0, syn.syntaxErrors);
	const reconnect = g.checks.find((c) => /reconnected/.test(c.name));
	check0("Volt reader reconnected to the restarted host bridge (as recorded)", reconnect?.pass, reconnect);
	state["gen" + label] = { ...g, file, checks: genChecks, rescoredFrom: process.argv[4] };
	saveState();
	if (label === "L1") {
		await rec.run("GEN-L1", async (check) => {
			for (const c of genChecks) check(c.name, c.pass, c.detail);
			return { actual: { file, target: target.path, expectedAssetId: target.assetId, rescoredFrom: process.argv[4] }, evidence: g.runFile };
		});
	}
	console.log(`\nGenerated: ${file}\nExpected manual output includes asset id ${target.assetId}`);
}

if (phase === "manual") {
	const id = process.argv[3];
	const report = readFileSync(process.argv[4], "utf8");
	const g = id === "GEN-L2" ? state.genL1 : state.genL3;
	await rec.run(id, async (check) => {
		if (id === "GEN-L3") for (const c of g.checks) check("generation: " + c.name, c.pass, c.detail);
		check("user executed the script manually in Volt", /executed|ran|run/i.test(report), report.slice(0, 200));
		check("reported output contains expected asset id " + g.expected, report.includes(g.expected), report.slice(0, 500));
		if (id === "GEN-L3") check("reported output contains ClassName " + g.target.className, report.includes(g.target.className));
		check("no error reported", !/\berror\b|attempt to index|nil value/i.test(report.replace(/no error/gi, "")), report.slice(0, 500));
		return { actual: { report }, evidence: g.file };
	});
}

if (phase === "rec") {
	await rec.run("REC-L1", async (check) => {
		const s0 = await status();
		await host("/stop");
		await sleep(3000);
		await host("/start");
		const t0 = Date.now();
		const back = await waitFor(async () => (await status())?.connected, 90000, 1000);
		const s1 = await status();
		check("reconnected within 90 s", !!back, Date.now() - t0);
		check("same session", s1?.reader?.session === state.session && s0?.reader?.session === state.session, { before: s0?.reader?.session, after: s1?.reader?.session });
		return { actual: { ms: Date.now() - t0, connectionId: s1?.reader?.connectionId, session: s1?.reader?.session } };
	});
	await rec.run("REC-L2", async (check) => {
		const a = state.assets[0];
		const r = await call("inspect_instance", { target: { path: a.segments }, maxProperties: 300 });
		const got = (r.json?.assets ?? []).find((x) => x.name === a.property);
		check("inspect ok", r.json?.ok === true, r.json?.error);
		check("same asset id", got?.assetId === a.assetId, { want: a.assetId, got: got?.assetId });
		check("same object id (session kept)", r.json?.object?.id === a.id, { want: a.id, got: r.json?.object?.id });
		return { actual: got };
	});
	await rec.run("REC-L3", async (check) => {
		const r = await readScript({ id: state.script?.id }, { refresh: true });
		check("complete", r.json?.status === "complete", r.json?.status ?? r.json?.error);
		check("non-empty", (r.texts?.[1] ?? "").trim().length > 0);
		check("fresh decompile (not cache)", r.json?.cache?.hit === false);
		return { actual: { source: r.json?.source, elapsedMs: r.json?.decompileElapsedMs } };
	});
}

if (phase === "rerun") {
	await rec.run("REC-L4", async (check) => {
		const s0 = await status();
		const watchStart = new Date().toISOString();
		console.log(`waiting up to 5 min for the bootstrap re-run (current session ${s0?.reader?.session}, connection ${s0?.reader?.connectionId})`);
		const s1 = await waitFor(async () => {
			const s = await status();
			return s?.connected && s.reader.session !== s0?.reader?.session && s;
		}, 300000, 1000);
		await sleep(2000);
		const log = (await host("/log")).log;
		// Connection ids restart per bridge process, so only consider lines written after the watch started,
		// and the close must precede the new session's authentication.
		const ts = (l) => l.match(/^\[volt-bridge (\S+) /)?.[1] ?? "";
		const recent = log.split("\n").filter((l) => ts(l) >= watchStart);
		const closedLine = recent.find((l) => l.includes(`reader ${s0?.reader?.connectionId} inactive`));
		const authLine = recent.find((l) => l.includes(`reader authenticated: ${s1?.reader?.connectionId} session=${s1?.reader?.session}`));
		check("close logged after watch start and before new auth", !!closedLine && !!authLine && ts(closedLine) <= ts(authLine), { closedLine, authLine });
		check("new session authenticated", !!s1, s1?.reader);
		check("previous connection closed normally (1000)", /reader closed \(1000/.test(closedLine ?? ""), closedLine);
		check("generation increased", s1?.reader?.generation > s0?.reader?.generation, { before: s0?.reader?.generation, after: s1?.reader?.generation });
		check("exactly one reader active", (await status())?.connected === true && (await status())?.reader?.session === s1?.reader?.session);
		state.session = s1?.reader?.session;
		return { actual: { before: s0?.reader && { session: s0.reader.session, connectionId: s0.reader.connectionId, generation: s0.reader.generation }, after: s1?.reader && { session: s1.reader.session, connectionId: s1.reader.connectionId, generation: s1.reader.generation }, closedLine } };
	});
	saveState();
}

const file = rec.save({ state: { ...state } });
console.log(`results: ${file}`);
process.exit(0);
