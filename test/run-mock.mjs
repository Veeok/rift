// Automated (mock) validation suite for volt-bridge. Run: node test/run-mock.mjs
// Uses: real bridge process over MCP stdio; Node stub readers; the real Luau reader under the
// Lune mock Volt; a fake bridge to drive the real reader with arbitrary ops; unit checks on dist/.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import { join, resolve } from "node:path";
import { CATALOG } from "./catalog.mjs";
import { RESULTS, ROOT, TMP, Recorder, templateBuild, fakeBridge, portOpen, sleep, startBridge, startMockVolt, stubReader, testToken, waitFor } from "./lib.mjs";

const P = { bridge: 38931, ctrl: 38932, conflict: 38933, fake: 38934, ctrl2: 38935, notoken: 38936, wait: 38937 };
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const rec = new Recorder("mock", CATALOG);
const { file: tokenFile, token } = testToken();
const logs = { bridge: "", lune: "" };
const T = async (id, fn) => (!only || only.test(id) ? rec.run(id, fn) : null);
const errCode = (r) => r.json?.error?.code ?? (r.rpcError ? "rpc:" + r.rpcError.code : r.isError ? "schema/" + (r.texts[0] ?? "").slice(0, 80) : null);

// ======================= Phase A: build, setup, stub-reader tests =======================
await T("SET-01", async (check) => {
	const r = spawnSync("npm run build", { cwd: ROOT, shell: true, encoding: "utf8" });
	const out = (r.stdout + r.stderr).trim();
	check("exit code 0", r.status === 0, r.status);
	check("no TS diagnostics", !/error TS\d+/.test(out));
	return { actual: { exit: r.status }, evidence: out.slice(-400) };
});

await T("SET-02", async (check) => {
	const tf = join(TMP, `set02-token-${Date.now()}`);
	const out = join(TMP, "set02-bootstrap.luau");
	const r = spawnSync(process.execPath, ["dist/setup.js", "--out", out], { cwd: ROOT, encoding: "utf8", env: { ...process.env, VOLT_BRIDGE_TOKEN_FILE: tf, VOLT_BRIDGE_PORT: "" } });
	const tok = existsSync(tf) ? readFileSync(tf, "utf8").trim() : "";
	const boot = existsSync(out) ? readFileSync(out, "utf8") : "";
	check("exit 0", r.status === 0, r.stderr);
	check("reports created", /token:\s+created/.test(r.stdout), r.stdout);
	check("token is 43-char base64url", /^[A-Za-z0-9_-]{43}$/.test(tok));
	check("bootstrap contains token", boot.includes(`token = "${tok}"`));
	check("bootstrap url default", boot.includes('url = "ws://127.0.0.1:38917/volt"'));
	check("no placeholders", !/__VOLT_BRIDGE_(URL|TOKEN|BUILD)__/.test(boot));
	check("build stamp = template sha256 prefix", boot.includes(`readerBuild = "${templateBuild()}"`), templateBuild());
	const r2 = spawnSync(process.execPath, ["dist/setup.js", "--out", out], { cwd: ROOT, encoding: "utf8", env: { ...process.env, VOLT_BRIDGE_TOKEN_FILE: tf, VOLT_BRIDGE_PORT: "" } });
	check("second run reuses token", /token:\s+reused/.test(r2.stdout) && readFileSync(tf, "utf8").trim() === tok);
	return { actual: { stdout: r.stdout.replace(tok, "<token>") }, evidence: `token file ${tf}; bootstrap ${out}` };
});

await T("SET-03", async (check) => {
	const out = join(TMP, "set03-bootstrap.luau");
	const r = spawnSync(process.execPath, ["dist/setup.js", "--port", "40123", "--out", out], { cwd: ROOT, encoding: "utf8", env: { ...process.env, VOLT_BRIDGE_TOKEN_FILE: tokenFile } });
	check("exit 0", r.status === 0, r.stderr);
	check("url uses 40123", readFileSync(out, "utf8").includes('url = "ws://127.0.0.1:40123/volt"'));
	const bad = spawnSync(process.execPath, ["dist/setup.js", "--port", "80", "--out", out], { cwd: ROOT, encoding: "utf8", env: { ...process.env, VOLT_BRIDGE_TOKEN_FILE: tokenFile } });
	check("invalid port exits non-zero", bad.status !== 0, bad.status);
	check("range error message", /1024-65535/.test(bad.stderr), bad.stderr.split("\n").find((l) => l.includes("Error")));
	return { actual: { goodExit: r.status, badExit: bad.status }, evidence: r.stdout.trim() };
});

let B = await startBridge({ port: P.bridge, tokenFile, log: (s) => (logs.bridge += s) });

await T("SET-04", async (check) => {
	const res = B.init.result;
	check("protocol 2025-11-25", res.protocolVersion === "2025-11-25", res.protocolVersion);
	check("serverInfo Rift", res.serverInfo?.name === "Rift", res.serverInfo);
	check("instructions mention untrusted", /untrusted/i.test(res.instructions ?? ""));
	check("instructions forbid embedding ids", /never embed/i.test(res.instructions ?? ""));
	return { actual: { protocolVersion: res.protocolVersion, serverInfo: res.serverInfo, instructionsChars: res.instructions?.length } };
});

await T("SET-05", async (check) => {
	const tools = (await B.rpc("tools/list", {})).result.tools;
	const names = tools.map((x) => x.name).sort();
	const expected = ["get_status", "inspect_instance", "list_children", "list_scripts", "read_script", "search_instances"];
	check("exactly six expected tools", JSON.stringify(names) === JSON.stringify(expected), names);
	check("all readOnlyHint", tools.every((x) => x.annotations?.readOnlyHint === true));
	check("none destructive", tools.every((x) => x.annotations?.destructiveHint === false));
	return { actual: { names, annotations: tools.map((x) => [x.name, x.annotations]) } };
});

await T("SET-07", async (check) => {
	const ip = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === "IPv4" && !a.internal)?.address;
	const loop = await portOpen(P.bridge, "127.0.0.1");
	const ext = ip ? await portOpen(P.bridge, ip) : null;
	const ns = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" }).stdout.split(/\r?\n/).filter((l) => l.includes(`:${P.bridge} `) && /LISTENING/.test(l));
	check("loopback accepts", loop === true);
	check("non-loopback interface available", !!ip, ip);
	check("non-loopback refuses", ext === false, { ip, ext });
	check("OS listener local address is 127.0.0.1 only", ns.length > 0 && ns.every((l) => l.includes(`127.0.0.1:${P.bridge}`)), ns);
	return { actual: { loop, ip, ext }, evidence: ns.map((l) => l.trim()) };
});

await T("REQ-11", async (check) => {
	const Bw = await startBridge({ port: P.wait, tokenFile });
	// No reader: explicit 0 answers immediately; explicit 3000 waits ~3 s.
	let t0 = Date.now();
	const s0 = (await Bw.call("get_status", { waitForReaderMs: 0 })).json;
	const ms0 = Date.now() - t0;
	t0 = Date.now();
	const s3 = (await Bw.call("get_status", { waitForReaderMs: 3000 })).json;
	const ms3 = Date.now() - t0;
	check("waitForReaderMs 0: immediate, not connected", s0.connected === false && ms0 < 1000, ms0);
	check("waitForReaderMs 3000: waited ~3 s, not connected", s3.connected === false && ms3 >= 2900 && ms3 < 5000 && s3.waitedForReaderMs >= 2900, { ms3, waited: s3.waitedForReaderMs });
	// Fresh bridge (<60 s): get_status without args waits for a reader that connects 4 s later.
	setTimeout(() => stubReader({ port: P.wait, token, session: "ffffeeee-0000-4000-8000-0000000000ff" }), 4000);
	t0 = Date.now();
	const sa = (await Bw.call("get_status", {}, 40000)).json;
	const msa = Date.now() - t0;
	check("automatic startup wait returns connected", sa.connected === true, sa.listener);
	check("waited until the reader arrived (3-10 s)", msa >= 3000 && msa <= 10000 && sa.waitedForReaderMs >= 3000, { msa, waited: sa.waitedForReaderMs });
	check("no wait when already connected", ((await Bw.call("get_status", {})).json.waitedForReaderMs ?? -1) === 0);
	await Bw.stop();
	return { actual: { ms0, ms3, msa, waited: sa.waitedForReaderMs, session: sa.reader?.session } };
});

await T("REQ-01", async (check) => {
	const r = await B.call("list_children", {});
	check("isError", r.isError);
	check("code not_connected", errCode(r) === "not_connected", errCode(r));
	check("retryable", r.json?.error?.retryable === true);
	return { actual: r.json };
});

await T("AUTH-01", async (check) => {
	const s = stubReader({ port: P.bridge, token });
	await s.waitAuth();
	const st = await B.status();
	check("auth_ok", !!s.authOk, s.authFail);
	check("connectionId present", /^c\d+$/.test(s.authOk?.connectionId ?? ""));
	check("session echoed", s.authOk?.session === s.session);
	check("status connected", st.connected === true);
	check("status session", st.reader?.session === s.session);
	check("status place/executor", st.reader?.place?.placeId === 99 && st.reader?.executor?.name === "stub");
	s.close();
	await s.closedP;
	await waitFor(async () => !(await B.status()).connected, 3000);
	return { actual: { authOk: s.authOk, reader: st.reader } };
});

await T("AUTH-02", async (check) => {
	const s = stubReader({ port: P.bridge, token: "x".repeat(43) });
	await s.closedP;
	check("bad_token", s.authFail?.code === "bad_token", s.authFail);
	check("fatal", s.authFail?.fatal === true);
	check("close 4001", s.closed?.code === 4001, s.closed);
	check("not connected", (await B.status()).connected === false);
	return { actual: { authFail: s.authFail, closed: s.closed } };
});

await T("AUTH-03", async (check) => {
	const s = stubReader({ port: P.bridge, token, auth: false });
	await s.opened;
	s.send({ v: 1, type: "res", id: "x", ok: true, result: {} });
	await Promise.race([s.closedP, sleep(3000)]);
	check("auth_required", s.authFail?.code === "auth_required", s.authFail);
	check("socket closed", !!s.closed);
	return { actual: { authFail: s.authFail, closed: s.closed } };
});

await T("AUTH-04", async (check) => {
	const t0 = Date.now();
	const s = stubReader({ port: P.bridge, token, auth: false });
	await Promise.race([s.closedP, sleep(9000)]);
	const ms = Date.now() - t0;
	check("auth_timeout", s.authFail?.code === "auth_timeout", s.authFail);
	check("closed within 7 s", !!s.closed && ms <= 7000, ms);
	check("closed after ~5 s", ms >= 4500, ms);
	return { actual: { authFail: s.authFail, ms } };
});

await T("AUTH-05", async (check) => {
	const s = stubReader({ port: P.bridge, token, protocol: 2 });
	await Promise.race([s.closedP, sleep(3000)]);
	check("protocol_mismatch", s.authFail?.code === "protocol_mismatch", s.authFail);
	check("fatal", s.authFail?.fatal === true);
	return { actual: s.authFail };
});

await T("AUTH-06", async (check) => {
	const s = stubReader({ port: P.bridge, token, nonceOverride: "wrong" });
	await Promise.race([s.closedP, sleep(3000)]);
	check("bad_nonce", s.authFail?.code === "bad_nonce", s.authFail);
	return { actual: s.authFail };
});

await T("AUTH-07", async (check) => {
	const s = stubReader({ port: P.bridge, token, headers: { Origin: "http://evil.example" } });
	await Promise.race([s.closedP, sleep(3000)]);
	check("closed 1008", s.closed?.code === 1008, s.closed);
	check("no hello", !s.messages.some((m) => m.type === "hello"));
	return { actual: { closed: s.closed, messages: s.messages } };
});

await T("AUTH-08", async (check) => {
	const s = stubReader({ port: P.bridge, token, path: "/other" });
	await Promise.race([s.closedP, sleep(3000)]);
	check("not opened / errored", !!s.error || !!s.unexpected, { error: s.error, unexpected: s.unexpected });
	check("no messages", s.messages.length === 0);
	return { actual: { error: s.error, closed: s.closed } };
});

await T("AUTH-09", async (check) => {
	const a = stubReader({ port: P.bridge, token, session: "aaaaaaaa-0000-4000-8000-00000000000a" });
	await a.waitAuth();
	const b = stubReader({ port: P.bridge, token, session: "bbbbbbbb-0000-4000-8000-00000000000b" });
	await Promise.race([b.closedP, sleep(8000)]);
	const st = await B.status();
	check("first authenticated", !!a.authOk);
	check("second reader_busy", b.authFail?.code === "reader_busy", b.authFail);
	check("busy is fatal", b.authFail?.fatal === true);
	check("first still active", st.connected && st.reader.session === a.session, st.reader?.session);
	a.close();
	await a.closedP;
	return { actual: { second: b.authFail, active: st.reader?.session } };
});

// Generic stub with manual control
async function withStub(opts, fn) {
	const s = stubReader({ port: P.bridge, token, ...opts });
	await s.waitAuth();
	try {
		return await fn(s);
	} finally {
		s.close();
		await Promise.race([s.closedP, sleep(2000)]);
		await waitFor(async () => !(await B.status()).connected, 3000);
	}
}

await T("REQ-02", (check) =>
	withStub({}, async () => {
		const t0 = Date.now();
		const r = await B.call("list_children", {}, 30000);
		const ms = Date.now() - t0;
		check("deadline_exceeded", errCode(r) === "deadline_exceeded", errCode(r));
		check("after 14-18 s", ms >= 14000 && ms <= 18000, ms);
		return { actual: { code: errCode(r), ms } };
	}),
);

await T("REQ-03", (check) =>
	withStub({}, async (s) => {
		const calls = [0, 1, 2, 3, 4].map((o) => B.call("list_children", { offset: o, limit: 1 }));
		await waitFor(() => s.reqs.length >= 5, 5000, 20);
		for (const q of [...s.reqs].reverse()) s.reply(q.id, { items: [], offset: q.args.offset, marker: "m" + q.args.offset });
		const res = await Promise.all(calls);
		const ids = s.reqs.map((q) => q.id);
		check("5 requests seen", s.reqs.length === 5);
		check("ids unique", new Set(ids).size === 5, ids);
		check("each call got its own result", res.every((r, i) => r.json?.marker === "m" + i), res.map((r) => r.json?.marker));
		return { actual: { ids, markers: res.map((r) => r.json?.marker) } };
	}),
);

await T("REQ-04", (check) =>
	withStub({ onReq: (m, s) => s.replyError(m.id, "not_found", "path segment 2 not found") }, async () => {
		const r = await B.call("list_children", { target: { path: ["Workspace", "Nope"] } });
		check("isError", r.isError);
		check("code not_found", errCode(r) === "not_found", errCode(r));
		check("message kept", /segment 2/.test(r.json?.error?.message ?? ""));
		return { actual: r.json };
	}),
);

await T("REQ-05", (check) =>
	withStub({}, async (s) => {
		const held = Array.from({ length: 16 }, (_, i) => B.call("list_children", { offset: i }));
		await waitFor(() => s.reqs.length >= 16, 5000, 20);
		const t0 = Date.now();
		const r17 = await B.call("list_children", { offset: 99 });
		const ms = Date.now() - t0;
		for (const q of s.reqs) s.reply(q.id, { items: [] });
		await Promise.all(held);
		check("16 in flight at reader", s.reqs.length === 16, s.reqs.length);
		check("17th queue_full", errCode(r17) === "queue_full", errCode(r17));
		check("immediate (<1 s)", ms < 1000, ms);
		return { actual: { code: errCode(r17), ms } };
	}),
);

await T("REQ-07", (check) =>
	withStub({}, async (s) => {
		const a = await B.call("list_children", { limit: 500 });
		const b = await B.call("search_instances", { name: "x", maxVisited: 100001 });
		check("limit 500 rejected", a.isError, a.texts[0]?.slice(0, 120));
		check("maxVisited 100001 rejected", b.isError, b.texts[0]?.slice(0, 120));
		check("reader received nothing", s.reqs.length === 0, s.reqs.length);
		return { actual: { a: a.texts[0]?.slice(0, 200), b: b.texts[0]?.slice(0, 200) } };
	}),
);

await T("REQ-08", (check) =>
	withStub({}, async (s) => {
		const r = await B.call("inspect_instance", { target: { id: "ffffffff:1" } });
		check("stale_object_id", errCode(r) === "stale_object_id", errCode(r));
		check("no round trip", s.reqs.length === 0);
		return { actual: r.json };
	}),
);

await T("REQ-09", (check) =>
	withStub({ onReq: (m, s) => s.reply(m.id, { items: [], ok2: true }) }, async (s) => {
		s.send({ v: 1, type: "chunk", id: "zzz.9", seq: 1, data: "junk" });
		s.send({ v: 1, type: "res", id: "zzz.9", ok: true, result: {} });
		await sleep(200);
		const r = await B.call("list_children", {});
		check("still connected", (await B.status()).connected);
		check("next call ok", r.json?.ok === true && r.json?.ok2 === true, r.json);
		return { actual: r.json };
	}),
);

await T("REQ-10", (check) =>
	withStub({ onReq: (m, s) => s.reply(m.id, { items: [] }) }, async (s) => {
		s.send("{bad json");
		await sleep(200);
		const r = await B.call("list_children", {});
		check("still connected", (await B.status()).connected);
		check("next call ok", r.json?.ok === true, r.json);
		return { actual: r.json };
	}),
);

await T("REC-03", (check) =>
	withStub({}, async (s) => {
		const p = B.call("list_children", {});
		await waitFor(() => s.reqs.length >= 1, 3000, 20);
		const t0 = Date.now();
		s.ws.terminate();
		const r = await p;
		const ms = Date.now() - t0;
		check("disconnected", errCode(r) === "disconnected", errCode(r));
		check("within 2 s", ms <= 2000, ms);
		return { actual: { code: errCode(r), ms } };
	}),
);

await T("REC-09", async (check) => {
	const a = stubReader({ port: P.bridge, token, session: "cccccccc-0000-4000-8000-00000000000c" });
	await a.waitAuth();
	a.autoPong = false;
	const t0 = Date.now();
	const b = stubReader({ port: P.bridge, token, session: "dddddddd-0000-4000-8000-00000000000d" });
	await b.waitAuth(10000);
	const ms = Date.now() - t0;
	await Promise.race([a.closedP, sleep(3000)]);
	const st = await B.status();
	check("new reader accepted", !!b.authOk, b.authFail);
	check("after probe (>=3 s)", ms >= 2900, ms);
	check("old closed 4006", a.closed?.code === 4006, a.closed);
	check("new session active", st.reader?.session === b.session);
	b.close();
	await b.closedP;
	await waitFor(async () => !(await B.status()).connected, 3000);
	return { actual: { ms, oldClose: a.closed, active: st.reader?.session } };
});

await T("REC-10", async (check) => {
	const S = "eeeeeeee-0000-4000-8000-00000000000e";
	const a = stubReader({ port: P.bridge, token, session: S });
	await a.waitAuth();
	const a2 = stubReader({ port: P.bridge, token, session: S });
	await a2.waitAuth();
	await Promise.race([a.closedP, sleep(3000)]);
	const st = await B.status();
	check("second transport accepted", !!a2.authOk);
	check("old closed 4005", a.closed?.code === 4005, a.closed);
	check("same session active", st.reader?.session === S && st.reader?.connectionId === a2.authOk?.connectionId);
	a2.close();
	await a2.closedP;
	await waitFor(async () => !(await B.status()).connected, 3000);
	return { actual: { oldClose: a.closed, active: st.reader } };
});

await T("AST-10", (check) =>
	withStub(
		{
			onReq: (m, s) =>
				s.reply(m.id, {
					offset: m.args.offset ?? 0,
					limit: 200,
					total: 200,
					items: Array.from({ length: 200 }, (_, i) => ({ t: "Instance", id: "a1b2c3d4:" + i, name: "N".repeat(1000), className: "Part", path: "game.Workspace.X" })),
				}),
		},
		async () => {
			const r = await B.call("list_children", { offset: 10, limit: 200 });
			const len = r.texts[0]?.length ?? 0;
			check("ok", r.json?.ok === true);
			check("<= 120000 chars", len <= 120000, len);
			check("partial response_size", r.json?.partial === true && r.json?.partialReason === "response_size");
			check("nextOffset = offset + items", r.json?.nextOffset === 10 + (r.json?.items?.length ?? -1), { nextOffset: r.json?.nextOffset, items: r.json?.items?.length });
			return { actual: { len, items: r.json?.items?.length, nextOffset: r.json?.nextOffset } };
		},
	),
);

await T("SET-08", async (check) => {
	const blocker = net.createServer();
	await new Promise((r) => blocker.listen(P.conflict, "127.0.0.1", r));
	const B3 = await startBridge({ port: P.conflict, tokenFile });
	const s1 = await B3.status();
	const tools = (await B3.rpc("tools/list", {})).result.tools.length;
	check("state error", s1.listener.state === "error", s1.listener);
	check("code EADDRINUSE", s1.listener.code === "EADDRINUSE");
	check("explains fix", /VOLT_BRIDGE_PORT/.test(s1.listener.message ?? ""));
	check("MCP still serves", tools === 6);
	await new Promise((r) => blocker.close(r));
	const t0 = Date.now();
	const ok = await waitFor(async () => (await B3.status()).listener.state === "listening", 20000, 500);
	check("listening after release within 20 s", !!ok, Date.now() - t0);
	const code = await B3.stop();
	return { actual: { before: s1.listener, recoveredMs: Date.now() - t0, exit: code } };
});

await T("SET-09", async (check) => {
	const B4 = await startBridge({ port: P.notoken, tokenFile: join(TMP, "does-not-exist-token") });
	const s = await B4.status();
	const tools = (await B4.rpc("tools/list", {})).result.tools.length;
	check("state disabled", s.listener.state === "disabled", s.listener);
	check("reason names token file", /does-not-exist-token/.test(s.listener.reason ?? ""));
	check("tools/list works", tools === 6);
	check("port closed", (await portOpen(P.notoken)) === false);
	await B4.stop();
	return { actual: s.listener };
});

await T("SET-11", async (check) => {
	const txt = readFileSync(join(ROOT, "opencode.example.jsonc"), "utf8");
	const json = JSON.parse(txt.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
	const v = json.mcp?.servers?.rift;
	check("parses as JSONC", !!json);
	check("type local", v?.type === "local");
	check("node command to dist/index.js", v?.command?.[0] === "node" && /dist\\index\.js$/.test(v?.command?.[1] ?? ""));
	check("disabled false", v?.disabled === false);
	check("example keeps execution opt-in", v?.environment?.VOLT_BRIDGE_ALLOW_EXEC === undefined, v?.environment?.VOLT_BRIDGE_ALLOW_EXEC);
	check("example uses rift rather than a legacy volt entry", !!v && json.mcp?.servers?.volt === undefined);
	check("no model/provider keys", !("model" in json) && !("providers" in json) && !("provider" in json));
	check("instructions array", Array.isArray(json.instructions));
	// A worktree may inspect the preserved original registration explicitly, without copying/editing it.
	const cfgPath = process.env.RIFT_BASELINE_CONFIG ? resolve(process.env.RIFT_BASELINE_CONFIG) : join(ROOT, "..", "..", ".opencode", "opencode.json");
	const cfgText = readFileSync(cfgPath, "utf8");
	const cfg = JSON.parse(cfgText);
	const servers = Object.keys(cfg.mcp?.servers ?? {});
	const rift = cfg.mcp?.servers?.rift;
	check("owner-approved rift server is registered", !!rift, servers);
	check(
		"rift is local, enabled and opts into execution",
		rift?.type === "local" && rift?.disabled === false && rift?.environment?.VOLT_BRIDGE_ALLOW_EXEC === "1",
		rift?.environment ?? null,
	);
	check("no server entry named volt remains", !servers.includes("volt"), servers);
	check("no bridge token stored in the config", !/VOLT_BRIDGE_TOKEN/.test(cfgText));
	return { actual: { server: v, instructions: json.instructions, servers, allowExec: rift?.environment?.VOLT_BRIDGE_ALLOW_EXEC, registrationScope: process.env.RIFT_BASELINE_CONFIG ? "explicit preserved baseline config (read-only)" : "local project config" } };
});

await T("SET-10", async (check) => {
	const s = stubReader({ port: P.bridge, token });
	await s.waitAuth();
	await T("SET-06", async (c2) => {
		c2("lines captured", B.stdoutLines.length > 20, B.stdoutLines.length);
		c2("all lines JSON-RPC 2.0", B.nonJsonLines.length === 0, B.nonJsonLines.slice(0, 3));
		c2("diagnostics on stderr", /listening on ws:\/\/127\.0\.0\.1/.test(B.stderr));
		return { actual: { stdoutLines: B.stdoutLines.length, nonJson: B.nonJsonLines.length, stderrLines: B.stderr.split("\n").length } };
	});
	const t0 = Date.now();
	const code = await B.stop();
	const ms = Date.now() - t0;
	await Promise.race([s.closedP, sleep(2000)]);
	check("exit 0", code === 0, code);
	check("within 5 s", ms <= 5000, ms);
	check("reader got bye", s.messages.some((m) => m.type === "bye"));
	check("port closed", (await portOpen(P.bridge)) === false);
	return { actual: { code, ms, readerClose: s.closed } };
});

// ======================= Phase B: real Luau reader under Lune mock =======================
await B.stop(); // idempotent: phase teardown must not depend on SET-10 running
B = await startBridge({ port: P.bridge, tokenFile, log: (s) => (logs.bridge += s) });
let MV = await startMockVolt({ ctrlPort: P.ctrl, bridgePort: P.bridge, token, log: (s) => (logs.lune += s) });
const connected = await waitFor(async () => (await B.status()).connected, 15000);
if (!connected) console.error("Lune reader did not connect:\n" + MV.out.slice(-3000));
let st0 = await B.status();
let SESSION = st0.reader?.session;
const pfx = () => SESSION?.slice(0, 8) + ":";
const call = (n, a, ms) => B.call(n, a, ms);
const kids = async (path, extra = {}) => (await call("list_children", { target: path ? { path } : undefined, limit: 200, ...extra })).json;
const byName = (items, n) => items?.filter((i) => (typeof i.name === "string" ? i.name : i.name?.v) === n) ?? [];
const inspect = async (path, extra = {}) => (await call("inspect_instance", { target: { path }, ...extra })).json;
async function readAll(ref, maxLines = 2000, extra = {}) {
	let start = 1;
	const parts = [];
	let first = null;
	let pages = 0;
	for (;;) {
		let r = await call("read_script", { script: ref, startLine: start, maxLines, waitMs: 20000, ...extra }, 60000);
		while (r.json?.status === "pending") r = await call("read_script", { jobId: r.json.jobId, startLine: start, maxLines, waitMs: 20000 }, 60000);
		if (r.isError) return { error: r.json?.error, json: r.json };
		first ??= r.json;
		parts.push(r.texts[1]);
		pages++;
		if (r.json.source.nextStartLine == null) break;
		start = r.json.source.nextStartLine;
		extra = {};
	}
	return { text: parts.join("\n"), first, pages };
}

await T("OBJ-01", async (check) => {
	const j = await kids(null);
	const names = j?.items?.map((i) => i.name) ?? [];
	const wsItem = byName(j?.items, "Workspace")[0];
	check("connected to real reader", !!SESSION, st0.reader);
	check("services listed", ["Workspace", "Players", "ReplicatedStorage"].every((n) => names.includes(n)), names);
	check("session-prefixed ids", j.items.every((i) => i.id.startsWith(pfx())));
	check("className/path", wsItem?.className === "Workspace" && wsItem?.path === "game.Workspace", wsItem);
	check("hasChildren", wsItem?.hasChildren === true);
	check("observedAt + session", !!j.observedAt && j.session?.readerSession === SESSION);
	check("reader reports the current build", st0.reader?.readerBuild === templateBuild(), { reported: st0.reader?.readerBuild, expected: templateBuild() });
	return { actual: { names, workspace: wsItem, observedAt: j.observedAt, readerBuild: st0.reader?.readerBuild } };
});

await T("OBJ-02", async (check) => {
	const pages = [];
	for (const off of [0, 100, 200]) pages.push((await call("list_children", { target: { path: ["Workspace", "Many"] }, offset: off, limit: 100 })).json);
	const ids = new Set(pages.flatMap((p) => p.items.map((i) => i.id)));
	const names = pages.flatMap((p) => p.items.map((i) => i.name));
	check("sizes 100/100/50", pages.map((p) => p.items.length).join() === "100,100,50", pages.map((p) => p.items.length));
	check("nextOffset 100/200/none", pages[0].nextOffset === 100 && pages[1].nextOffset === 200 && pages[2].nextOffset === undefined, pages.map((p) => p.nextOffset));
	check("hasMore t/t/f", pages.map((p) => p.hasMore).join() === "true,true,false");
	check("total 250", pages.every((p) => p.total === 250));
	check("250 unique ids", ids.size === 250);
	check("P001..P250 order", names[0] === "P001" && names[249] === "P250");
	return { actual: { sizes: pages.map((p) => p.items.length), unique: ids.size } };
});

await T("OBJ-03", async (check) => {
	const j = await kids(["Workspace", "Map"]);
	const d = byName(j.items, "Door.1");
	check("two Door.1", d.length === 2, d.length);
	check("both flagged duplicateName", d.every((x) => x.duplicateName === true));
	check("distinct ids", d.length === 2 && d[0].id !== d[1].id);
	check("unique siblings not flagged", byName(j.items, "Lamp")[0]?.duplicateName === undefined);
	return { actual: d };
});

await T("OBJ-04", async (check) => {
	const door = await inspect(["Workspace", "Map", "Door.1"], { maxProperties: 5 });
	const weirdName = 'Weird "name" [x].\n';
	const weird = await inspect(["Workspace", "Map", weirdName], { maxProperties: 5 });
	check("Door.1 resolved whole", door.object?.name === "Door.1" && door.object?.className === "Model", door.object);
	check("Door.1 path bracketed", door.object?.path === 'game.Workspace.Map["Door.1"]', door.object?.path);
	check("weird resolved", weird.ok === true && weird.object?.name === weirdName, weird.error ?? weird.object);
	check("weird path escaped", weird.object?.path === 'game.Workspace.Map["Weird \\"name\\" [x].\\010"]', weird.object?.path);
	check("segments exact", weird.pathInfo?.segments?.[2] === weirdName);
	return { actual: { door: door.object, weird: weird.object } };
});

await T("OBJ-05", async (check) => {
	const r = await call("list_children", { target: { path: ["Workspace", "Nope", "X"] } });
	check("not_found", errCode(r) === "not_found", errCode(r));
	check("names segment 2", /segment 2/.test(r.json?.error?.message ?? ""), r.json?.error);
	return { actual: r.json };
});

await T("OBJ-06", async (check) => {
	const map = { path: ["Workspace", "Map"] };
	const a = (await call("search_instances", { root: map, name: "door" })).json;
	const b = (await call("search_instances", { name: "Door.1", nameMatch: "exact", caseSensitive: true })).json;
	const c = (await call("search_instances", { root: { path: ["Workspace", "Many"] }, name: "P00", nameMatch: "prefix" })).json;
	const e = (await call("search_instances", { name: "door.1", nameMatch: "exact", caseSensitive: true })).json;
	check("contains ci -> 2", a.items.length === 2, a.items.map((i) => i.name));
	check("exact cs -> 2", b.items.length === 2);
	check("exact cs wrong case -> 0", e.items.length === 0);
	check("prefix -> 9", c.items.length === 9, c.items.length);
	return { actual: { contains: a.items.length, exact: b.items.length, prefix: c.items.length } };
});

await T("OBJ-07", async (check) => {
	const a = (await call("search_instances", { root: { path: ["Workspace", "Map"] }, className: "BasePart", limit: 200 })).json;
	const b = (await call("search_instances", { root: { path: ["Workspace", "Map"] }, className: "BasePart", classMatch: "exact" })).json;
	const names = a.items.map((i) => i.name).sort();
	check("isa finds parts incl MeshPart", ["Frame", "Lamp", "PlainNote", "Statue"].every((n) => names.includes(n)), names);
	check("no non-parts", a.items.every((i) => ["Part", "MeshPart"].includes(i.className)));
	check("exact BasePart -> 0", b.items.length === 0);
	return { actual: { isa: names, exact: b.items.length } };
});

await T("OBJ-08", async (check) => {
	const a = (await call("search_instances", { root: { path: ["Workspace", "Deep"] }, name: "Bottom", nameMatch: "exact", maxDepth: 10 })).json;
	const a2 = (await call("search_instances", { root: { path: ["Workspace", "Deep"] }, name: "Bottom", nameMatch: "exact", maxDepth: 64 })).json;
	const b = (await call("search_instances", { root: { path: ["Workspace", "Many"] }, className: "Part", maxVisited: 5 })).json;
	check("depth 10 cannot reach Bottom", a.items.length === 0 && a.visited <= 12, { items: a.items.length, visited: a.visited });
	check("depth 64 reaches Bottom", a2.items.length === 1);
	check("maxVisited partial", b.partial === true && b.partialReason === "max_visited", b);
	check("visited 5", b.visited === 5);
	return { actual: { depthLimited: a.visited, partial: b.partialReason } };
});

await T("OBJ-09", async (check) => {
	const pages = [];
	for (const off of [0, 100, 200]) pages.push((await call("search_instances", { root: { path: ["Workspace", "Many"] }, className: "Part", classMatch: "exact", offset: off, limit: 100 })).json);
	const ids = pages.flatMap((p) => p.items.map((i) => i.id));
	check("sizes 100/100/50", pages.map((p) => p.items.length).join() === "100,100,50", pages.map((p) => p.items.length));
	check("disjoint", new Set(ids).size === ids.length);
	check("hasMore t/t/f", pages.map((p) => p.hasMore).join() === "true,true,false", pages.map((p) => p.hasMore));
	check("nextOffset 100/200", pages[0].nextOffset === 100 && pages[1].nextOffset === 200);
	return { actual: { sizes: pages.map((p) => p.items.length) } };
});

await T("OBJ-10", async (check) => {
	const a = await kids(["Workspace", "Map", "Door.1", "Frame"], { className: "Decal" });
	const b = await kids(["Workspace", "Map"], { className: "BasePart" });
	check("Decal -> [Sign]", a.items.length === 1 && a.items[0].name === "Sign", a.items);
	check("BasePart on Map -> 3", b.items.length === 3 && b.total === 3, b.items.map((i) => i.name));
	return { actual: { decal: a.items.map((i) => i.name), parts: b.items.map((i) => i.name) } };
});

const probe = await inspect(["Workspace", "TypeProbe"], { maxProperties: 300, maxStringLength: 500 });
const PP = probe?.properties ?? {};
await T("SER-01", async (check) => {
	check("Vector3", PP.Vec3?.t === "Vector3" && PP.Vec3.x === 1 && PP.Vec3.y === 2 && PP.Vec3.z === 3 && Object.keys(PP.Vec3).length === 4, PP.Vec3);
	check("Vector2", PP.Vec2?.t === "Vector2" && PP.Vec2.x === 4 && PP.Vec2.y === 5, PP.Vec2);
	check("Vector3int16", PP.V3i16?.t === "Vector3int16" && PP.V3i16.z === 3, PP.V3i16);
	return { actual: { Vec3: PP.Vec3, Vec2: PP.Vec2, V3i16: PP.V3i16 } };
});
await T("SER-02", async (check) => {
	check("CFrame components", PP.CF?.t === "CFrame" && JSON.stringify(PP.CF.c) === "[1,2,3,1,0,0,0,1,0,0,0,1]", PP.CF);
	return { actual: PP.CF };
});
await T("SER-03", async (check) => {
	check("Color3", PP.Col?.t === "Color3" && PP.Col.r === 1 && PP.Col.g === 0 && PP.Col.b === 0, PP.Col);
	check("hex ff0000", String(PP.Col?.hex).toLowerCase() === "ff0000", PP.Col?.hex);
	check("BrickColor", PP.Brick?.t === "BrickColor" && PP.Brick.name === "Bright red" && PP.Brick.number === 21, PP.Brick);
	return { actual: { Col: PP.Col, Brick: PP.Brick } };
});
await T("SER-04", async (check) => {
	const near = (a, b) => Math.abs(a - b) < 1e-6;
	check("UDim", PP.U?.t === "UDim" && PP.U.scale === 0.5 && PP.U.offset === 10, PP.U);
	check("UDim2", PP.U2?.t === "UDim2" && near(PP.U2.x.scale, 0.1) && PP.U2.x.offset === 1 && near(PP.U2.y.scale, 0.2) && PP.U2.y.offset === 2, PP.U2);
	check("Rect", PP.R?.t === "Rect" && PP.R.min.x === 1 && PP.R.min.y === 2 && PP.R.max.x === 3 && PP.R.max.y === 4, PP.R);
	check("NumberRange", PP.NR?.t === "NumberRange" && PP.NR.min === 1 && PP.NR.max === 5, PP.NR);
	return { actual: { U: PP.U, U2: PP.U2, R: PP.R, NR: PP.NR } };
});
await T("SER-05", async (check) => {
	check("EnumItem", PP.Mat?.t === "EnumItem" && PP.Mat.enum === "Material" && PP.Mat.name === "Neon" && PP.Mat.value === 288, PP.Mat);
	return { actual: PP.Mat };
});
await T("SER-06", async (check) => {
	const ref = PP.Ref;
	check("Instance tag", ref?.t === "Instance" && ref.className === "Part" && ref.name === "Frame", ref);
	const again = (await call("inspect_instance", { target: { id: ref?.id }, maxProperties: 3 })).json;
	check("id resolves", again?.object?.name === "Frame" && again.object.path === 'game.Workspace.Map["Door.1"].Frame', again?.object ?? again?.error);
	return { actual: { ref, resolved: again?.object } };
});
await T("SER-07", async (check) => {
	check("nan", PP.NaNv?.t === "number" && PP.NaNv.v === "nan", PP.NaNv);
	check("inf", PP.Inf?.v === "inf" && PP.NegInf?.v === "-inf", { Inf: PP.Inf, NegInf: PP.NegInf });
	return { actual: { NaNv: PP.NaNv, Inf: PP.Inf, NegInf: PP.NegInf } };
});
await T("SER-08", async (check) => {
	check("lossy", PP.BadUtf8?.t === "string" && PP.BadUtf8.lossy === true && PP.BadUtf8.v === "ok\\xFFbad", PP.BadUtf8);
	check("truncated long", PP.Long?.truncated === true && PP.Long.length === 5000 && PP.Long.v.length === 500, { truncated: PP.Long?.truncated, length: PP.Long?.length, vlen: PP.Long?.v?.length });
	return { actual: { BadUtf8: PP.BadUtf8, Long: { length: PP.Long?.length, vlen: PP.Long?.v?.length } } };
});
await T("SER-09", async (check) => {
	const n = PP.Nested;
	check("depth omitted at level 2", n?.t === "table" && n.entries?.a?.t === "table" && n.entries.a.entries?.b?.omitted === "depth", JSON.stringify(n));
	check("big table 50 entries + truncated", PP.Big?.truncated === true && Object.keys(PP.Big?.entries ?? {}).length === 50, { truncated: PP.Big?.truncated, n: Object.keys(PP.Big?.entries ?? {}).length });
	return { actual: { Nested: n, BigCount: Object.keys(PP.Big?.entries ?? {}).length } };
});
await T("SER-10", async (check) => {
	const a = await inspect(["Workspace", "TypeProbe"], { properties: ["Secret", "Vec3"] });
	const b = await inspect(["Workspace", "PropsBroken"]);
	check("Secret unreadable", JSON.stringify(a.unreadableProperties) === '["Secret"]', a.unreadableProperties);
	check("Vec3 still returned", a.properties?.Vec3?.t === "Vector3");
	check("getproperties failure reported", b.ok === true && b.errors?.some((e) => e.part === "properties" && /access violation/.test(e.message)), b.errors);
	check("object still described", b.object?.name === "PropsBroken");
	return { actual: { unreadable: a.unreadableProperties, brokenErrors: b.errors } };
});
await T("SER-11", async (check) => {
	check("NumberSequence keypoints", PP.NS?.t === "NumberSequence" && PP.NS.keypoints?.length === 2, PP.NS);
	check("ColorSequence keypoints", PP.CS?.t === "ColorSequence" && PP.CS.keypoints?.length === 2, PP.CS);
	check("Font family", PP.FontV?.t === "Font" && /GothamSSm/.test(PP.FontV.family ?? ""), PP.FontV);
	check("PhysicalProperties", PP.Phys?.t === "PhysicalProperties" && PP.Phys.density === 1, PP.Phys);
	check("Ray", PP.RayV?.t === "Ray" && PP.RayV.direction?.y === 1, PP.RayV);
	check("Region3", PP.Reg?.t === "Region3" && PP.Reg.size?.x === 2, PP.Reg);
	check("Faces tagged", PP.FacesV?.t === "Faces", PP.FacesV);
	const failed = Object.entries(PP).filter(([, v]) => v && v.error === "serialize_failed").map(([k]) => k);
	check("no serialize_failed", failed.length === 0, failed);
	return { actual: { NS: PP.NS, CS: PP.CS, FontV: PP.FontV, Phys: PP.Phys, Reg: PP.Reg, FacesV: PP.FacesV, failed } };
});

await T("AST-01", async (check) => {
	const j = await inspect(["Workspace", "Map", "Door.1", "Frame", "Sign"]);
	check("one asset from Texture", j.assets?.length === 1 && j.assets[0].source === "property" && j.assets[0].name === "Texture" && j.assets[0].assetId === "1234567890", j.assets);
	return { actual: j.assets };
});
await T("AST-02", async (check) => {
	const j = await inspect(["Workspace", "Map", "Statue"]);
	const mesh = j.assets?.find((a) => a.name === "MeshContent");
	const tex = j.assets?.find((a) => a.name === "TextureID");
	check("Content uri", mesh?.uri === "rbxassetid://424242" && mesh?.assetId === "424242", mesh);
	check("TextureID", tex?.assetId === "434343", tex);
	check("Content property tagged", j.properties?.MeshContent?.t === "Content", j.properties?.MeshContent);
	return { actual: j.assets };
});
await T("AST-03", async (check) => {
	const j = await inspect(["Workspace", "Map", "Lamp"]);
	const a = j.assets?.find((x) => x.source === "attribute");
	check("attribute asset", a?.name === "HumSound" && a?.assetId === "555", j.assets);
	check("Color3 attribute serialized", j.attributes?.Glow?.t === "Color3");
	return { actual: j.assets };
});
await T("AST-04", async (check) => {
	const j = await inspect(["Workspace", "Map", "Speaker"]);
	check("legacy url id", j.assets?.length === 1 && j.assets[0].assetId === "987654", j.assets);
	return { actual: j.assets };
});
await T("AST-05", async (check) => {
	const j = await inspect(["Workspace", "Map", "PlainNote"]);
	check("assets empty", Array.isArray(j.assets) ? j.assets.length === 0 : j.assets !== undefined && Object.keys(j.assets).length === 0, j.assets);
	return { actual: j.assets };
});
await T("AST-06", async (check) => {
	const j = await inspect(["Workspace", "ManyAssets"]);
	check("capped at 100", j.assets?.length === 100, j.assets?.length);
	check("attributeCount 150", j.attributeCount === 150, j.attributeCount);
	return { actual: { assets: j.assets?.length, attributeCount: j.attributeCount } };
});
await T("AST-07", async (check) => {
	const j = await inspect(["Workspace", "Map", "Door.1", "Frame"], { properties: ["Size", "Anchored"] });
	check("exactly Size+Anchored", JSON.stringify(Object.keys(j.properties ?? {}).sort()) === '["Anchored","Size"]', Object.keys(j.properties ?? {}));
	check("values", j.properties?.Anchored === true && j.properties?.Size?.t === "Vector3");
	return { actual: j.properties };
});
await T("AST-08", async (check) => {
	const j = await inspect(["Workspace", "TypeProbe"], { maxProperties: 5 });
	check("shown 5", Object.keys(j.properties ?? {}).length === 5 && j.propertyCount?.shown === 5, j.propertyCount);
	check("omitted >= 20", j.propertyCount?.omitted >= 20, j.propertyCount);
	return { actual: j.propertyCount };
});
await T("AST-09", async (check) => {
	const d = await inspect(["Workspace", "Map", "Door.1"]);
	const n = await inspect(["Workspace", "NoAttrs"]);
	check("tags", JSON.stringify(d.tags) === '["Door","Interactable"]', d.tags);
	check("Locked attribute", d.attributes?.Locked === true && d.attributes?.OpenSpeed === 3.5, d.attributes);
	check("NoAttrs count 0", n.attributeCount === 0 && n.attributes === undefined, { c: n.attributeCount, a: n.attributes });
	check("pathInfo not unique for duplicate", d.pathInfo?.unique === false && d.pathInfo?.ambiguousSegments?.[0]?.sameNameSiblings === 2, d.pathInfo);
	return { actual: { tags: d.tags, attributes: d.attributes, pathInfo: d.pathInfo } };
});

// ---------- Decompilation ----------
const MODS = ["ReplicatedStorage", "Modules"];
await T("DEC-01", async (check) => {
	const r = await call("read_script", { script: { path: [...MODS, "DoorConfig"] } });
	const expected = 'local DoorConfig = {}\nDoorConfig.OpenSpeed = 3.5\nDoorConfig.DoorName = "Door.1"\nDoorConfig.SignAsset = "rbxassetid://1234567890"\nreturn DoorConfig\n';
	check("complete", r.json?.status === "complete", r.json?.status ?? r.json?.error);
	check("source exact", r.texts[1] === expected, JSON.stringify(r.texts[1]));
	check("hash", r.json?.hash === "c".repeat(96) && r.json?.hashAvailable === true);
	check("className ModuleScript", r.json?.script?.className === "ModuleScript");
	check("observedAt + session", !!r.json?.observedAt && r.json?.session?.readerSession === SESSION);
	check("cache miss first", r.json?.cache?.hit === false);
	return { actual: { meta: r.json } };
});
await T("DEC-02", async (check) => {
	const expected = Array.from({ length: 1000 }, (_, i) => `local v${String(i + 1).padStart(4, "0")} = ${(i + 1) * 7} -- line ${i + 1}`).join("\n");
	const nexts = [];
	let start = 1;
	const parts = [];
	for (let k = 0; k < 6; k++) {
		const r = await call("read_script", { script: { path: [...MODS, "BigModule"] }, startLine: start, maxLines: 300 });
		parts.push(r.texts[1]);
		nexts.push(r.json.source.nextStartLine);
		if (r.json.source.totalLines !== 1000) check("totalLines 1000", false, r.json.source.totalLines);
		if (r.json.source.nextStartLine == null) break;
		start = r.json.source.nextStartLine;
	}
	check("nextStartLine 301/601/901/null", JSON.stringify(nexts) === "[301,601,901,null]", nexts);
	check("rebuilt exactly", parts.join("\n") === expected);
	return { actual: { nexts, pages: parts.length } };
});
await T("DEC-03", async (check) => {
	const r = await call("read_script", { script: { path: [...MODS, "SlowModule"] }, waitMs: 2000 });
	check("pending", r.json?.status === "pending" && /^dj_/.test(r.json?.jobId ?? ""), r.json);
	let polls = 0;
	let p = r;
	const t0 = Date.now();
	while (p.json?.status === "pending" && Date.now() - t0 < 40000) {
		polls++;
		p = await call("read_script", { jobId: r.json.jobId, waitMs: 2000 });
	}
	check("completes via polling", p.json?.status === "complete" && p.texts[1] === "return 'slow'\n", p.json?.status ?? p.json?.error);
	check("polled at least 3 times", polls >= 3, polls);
	check("same jobId reported", p.json?.jobId === r.json?.jobId);
	return { actual: { jobId: r.json?.jobId, polls, final: p.json?.status } };
});
await T("DEC-04", async (check) => {
	const r = await call("read_script", { script: { path: [...MODS, "BrokenModule"] } });
	check("isError", r.isError);
	check("decompile_failed", errCode(r) === "decompile_failed", errCode(r));
	check("message from Volt", /unsupported bytecode version/.test(r.json?.error?.message ?? ""), r.json?.error);
	return { actual: r.json };
});
await T("DEC-05", async (check) => {
	const a = await call("read_script", { script: { path: ["Workspace", "ServerThing"] } });
	const b = await call("read_script", { script: { path: ["Workspace", "ClientRun"] } });
	const s = await MV.stats();
	check("unsupported_script", errCode(a) === "unsupported_script", errCode(a));
	check("decompile never called for ServerThing", !s.decompileByName?.ServerThing, s.decompileByName);
	check("client RunContext Script decompiles", b.json?.status === "complete" && b.texts[1] === "print('client-run')\n");
	return { actual: { server: a.json?.error, client: b.json?.status } };
});
await T("DEC-06", async (check) => {
	const r = await call("read_script", { script: { path: ["Workspace", "Map", "Door.1", "Frame"] } });
	check("not_a_script", errCode(r) === "not_a_script", errCode(r));
	return { actual: r.json };
});
await T("DEC-07", async (check) => {
	const expected = "-- 0123456789abcdefghijklmnopqrstuvwxyz é ü 漢字\n".repeat(14000);
	const all = await readAll({ path: [...MODS, "LargeModule"] });
	const h = (s) => createHash("sha256").update(s ?? "").digest("hex");
	check("no error", !all.error, all.error);
	check("sha256 match", h(all.text) === h(expected), { got: all.text?.length, want: expected.length });
	check("multi-page", all.pages > 5, all.pages);
	check("bridge received >= 3 chunks (bytes > 600k)", Buffer.byteLength(expected) > 600000);
	return { actual: { pages: all.pages, chars: all.text?.length, sha256: h(all.text) } };
});
await T("DEC-08", async (check) => {
	const r = await call("read_script", { script: { path: [...MODS, "BadUtf8Module"] } });
	check("lossyText", r.json?.lossyText === true, r.json?.lossyText);
	check("escapes", (r.texts[1] ?? "").includes("\\xFF\\xFE"), r.texts[1]);
	return { actual: { lossy: r.json?.lossyText, text: r.texts[1] } };
});
const hudPath = ["Players", "MockPlayer", "PlayerGui", "HUD", "HudController"];
await T("DEC-09", async (check) => {
	const a = await call("read_script", { script: { path: hudPath }, options: { SmartVariableRenamer: true, IndentWidth: 2 } });
	const s1 = await MV.stats();
	const b = await call("read_script", { script: { path: hudPath } });
	const s2 = await MV.stats();
	check("complete", a.json?.status === "complete" && b.json?.status === "complete");
	check("SmartVariableRenamer applied", s1.lastOptions?.SmartVariableRenamer === true, s1.lastOptions);
	check("IndentWidth applied", s1.lastOptions?.FormatterIndentWidth === 2, s1.lastOptions);
	check("separate cache entry -> 2 decompiles", s2.decompileByName?.HudController === 2, s2.decompileByName?.HudController);
	check("second not a cache hit", b.json?.cache?.hit === false);
	return { actual: { options: s1.lastOptions, decompiles: s2.decompileByName?.HudController } };
});

// ---------- Caching ----------
await T("CAC-01", async (check) => {
	const r = await call("read_script", { script: { path: [...MODS, "DoorConfig"] } });
	const s = await MV.stats();
	check("cache hit", r.json?.cache?.hit === true, r.json?.cache);
	check("decompiled once", s.decompileByName?.DoorConfig === 1, s.decompileByName?.DoorConfig);
	return { actual: { cache: r.json?.cache, count: s.decompileByName?.DoorConfig } };
});
await T("CAC-02", async (check) => {
	await MV.cmd("set_hash", { path: [...MODS, "DoorConfig"], hash: "0".repeat(96), source: "return 'v2'\n" });
	const r = await call("read_script", { script: { path: [...MODS, "DoorConfig"] } });
	const s = await MV.stats();
	check("miss", r.json?.cache?.hit === false);
	check("new source", r.texts[1] === "return 'v2'\n", r.texts[1]);
	check("new hash", r.json?.hash === "0".repeat(96));
	check("decompile count 2", s.decompileByName?.DoorConfig === 2, s.decompileByName?.DoorConfig);
	return { actual: { cache: r.json?.cache, count: s.decompileByName?.DoorConfig } };
});
await T("CAC-03", async (check) => {
	const a = await call("read_script", { script: { path: [...MODS, "Hashless"] } });
	const b = await call("read_script", { script: { path: [...MODS, "Hashless"] } });
	check("hashAvailable false", a.json?.hashAvailable === false && a.json?.hash === null, { h: a.json?.hash, ha: a.json?.hashAvailable });
	check("keyedBy nohash", (a.json?.cache?.keyedBy ?? []).some((k) => /nohash/.test(k)), a.json?.cache);
	check("second read hits", b.json?.cache?.hit === true);
	// Unit: nohash entries expire after 5 minutes (Date.now advanced).
	const { DecompileService, cacheKey } = await import("../dist/decompile.js");
	const fake = { onSessionChange() {}, session: "s", request: async () => ({ source: "x", observedAt: "t" }) };
	const svc = new DecompileService(fake);
	const info = { object: { id: "s:1", name: "M", className: "ModuleScript", path: "p" }, hash: null, decompileSupport: "supported" };
	const job = svc.start("s", info, undefined);
	await job.done;
	const key = cacheKey("s", info, undefined);
	const realNow = Date.now;
	const fresh = svc.lookup(key) !== null;
	Date.now = () => realNow() + 6 * 60_000;
	const expired = svc.lookup(key) === null;
	Date.now = realNow;
	check("unit: fresh nohash entry hit", fresh);
	check("unit: expired after 6 min", expired);
	return { actual: { first: a.json?.cache, second: b.json?.cache, unit: { fresh, expired } } };
});
await T("CAC-04", async (check) => {
	const before = (await MV.stats()).decompileByName?.ClientMain ?? 0;
	await call("read_script", { script: { path: ["StarterPlayer", "StarterPlayerScripts", "ClientMain"] } });
	const r = await call("read_script", { script: { path: ["StarterPlayer", "StarterPlayerScripts", "ClientMain"] }, refresh: true });
	const after = (await MV.stats()).decompileByName?.ClientMain ?? 0;
	check("refresh miss", r.json?.cache?.hit === false);
	check("count +2", after - before === 2, { before, after });
	return { actual: { before, after } };
});
await T("CAC-05", async (check) => {
	const rs = await Promise.all([1, 2, 3].map((i) => call("read_script", { script: { path: [...MODS, "Par" + i] }, waitMs: 20000 }, 60000)));
	const s = await MV.stats();
	check("all complete", rs.every((r, i) => r.json?.status === "complete" && r.texts[1] === `return ${i + 1}\n`), rs.map((r) => r.json?.status));
	check("reader max 1 concurrent decompile", s.maxDecompileActive === 1, s.maxDecompileActive);
	return { actual: { statuses: rs.map((r) => r.json?.status), maxDecompileActive: s.maxDecompileActive } };
});
await T("CAC-06", async (check) => {
	const path = ["Workspace", "ClientRun"];
	await MV.cmd("set_hash", { path, hash: "8".repeat(96), source: "print('client-run v2')\n" });
	const before = (await MV.stats()).decompileByName?.ClientRun ?? 0;
	const [a, b] = await Promise.all([call("read_script", { script: { path }, waitMs: 20000 }), call("read_script", { script: { path }, waitMs: 20000 })]);
	const after = (await MV.stats()).decompileByName?.ClientRun ?? 0;
	check("both complete", a.json?.status === "complete" && b.json?.status === "complete");
	check("one decompile", after - before === 1, { before, after });
	check("same job", a.json?.jobId === b.json?.jobId, [a.json?.jobId, b.json?.jobId]);
	return { actual: { before, after, jobs: [a.json?.jobId, b.json?.jobId] } };
});
await T("CAC-08", async (check) => {
	const loaded = (await call("list_scripts", { loaded: true, limit: 200 })).json;
	const running = (await call("list_scripts", { running: true, limit: 200 })).json;
	const ls = (await call("list_scripts", { className: "LocalScript", limit: 200 })).json;
	const ln = loaded.items.map((i) => i.name);
	const rn = running.items.map((i) => i.name).sort();
	check("loaded filter", ln.includes("DoorConfig") && ln.includes("BigModule") && !ln.includes("LargeModule"), ln);
	check("running filter", JSON.stringify(rn) === '["ClientMain","ClientRun","HudController"]', rn);
	check("className filter", ls.items.every((i) => i.className === "LocalScript") && ls.items.length === 2, ls.items.map((i) => i.name));
	await MV.cmd("add_script", { parent: MODS, name: "NewMod", className: "ModuleScript", loaded: true });
	const noRefresh = (await call("list_scripts", { nameContains: "newmod" })).json;
	const refreshed = (await call("list_scripts", { nameContains: "newmod", refresh: true, includeHash: true })).json;
	check("not visible before refresh", noRefresh.items.length === 0, noRefresh.items.length);
	check("visible after refresh", refreshed.items.length === 1 && refreshed.items[0].name === "NewMod");
	check("includeHash", refreshed.items[0]?.hash === "7".repeat(96) && refreshed.items[0]?.hashAvailable === true);
	check("server Script marked unsupported", (await call("list_scripts", { nameContains: "ServerThing" })).json.items[0]?.decompileSupport === "unsupported");
	return { actual: { loaded: ln, running: rn, cache: refreshed.cache } };
});
await T("CAC-07", async (check) => {
	const calls = await Promise.all(Array.from({ length: 9 }, (_, i) => call("read_script", { script: { path: [...MODS, "Q" + (i + 1)] }, waitMs: 0 })));
	const pending = calls.filter((r) => r.json?.status === "pending");
	const full = calls.filter((r) => errCode(r) === "queue_full");
	check("8 pending", pending.length === 8, calls.map((r) => r.json?.status ?? errCode(r)));
	check("1 queue_full", full.length === 1);
	// Drain so later tests are not affected (reader decompiles one at a time, 6 s each).
	const drained = await waitFor(async () => {
		const st = await Promise.all(pending.map((r) => call("read_script", { jobId: r.json.jobId, waitMs: 0 })));
		return st.every((x) => x.json?.status === "complete");
	}, 90000, 3000);
	check("queued jobs eventually complete", !!drained);
	return { actual: { statuses: calls.map((r) => r.json?.status ?? errCode(r)) } };
});

// ---------- Recovery with the real reader ----------
const doorId = (await inspect(["Workspace", "Map", "Door.1"], { maxProperties: 1 }))?.object?.id;
await T("REC-01", async (check) => {
	const s0 = await MV.stats();
	const conn0 = (await B.status()).reader?.connectionId;
	await B.stop();
	B = await startBridge({ port: P.bridge, tokenFile, log: (s) => (logs.bridge += s) });
	const t0 = Date.now();
	const ok = await waitFor(async () => (await B.status()).connected, 20000, 250);
	const ms = Date.now() - t0;
	const st = await B.status();
	const s1 = await MV.stats();
	check("reconnected within 20 s", !!ok, ms);
	check("same session", st.reader?.session === SESSION, st.reader?.session);
	check("same Volt socket object (no new connect)", s1.connectCalls === s0.connectCalls, { before: s0.connectCalls, after: s1.connectCalls });
	check("Volt auto-reconnect used", s1.reconnects >= s0.reconnects + 1, s1.reconnects);
	check("live sockets 1", s1.liveSockets === 1, s1.liveSockets);
	return { actual: { ms, connBefore: conn0, connAfter: st.reader?.connectionId, connectCalls: s1.connectCalls, reconnects: s1.reconnects } };
});
await T("REC-02", async (check) => {
	const r = (await call("list_children", { target: { id: doorId } })).json;
	check("old id resolves", r?.ok === true && r.target?.name === "Door.1", r?.error ?? r?.target);
	return { actual: { id: doorId, target: r?.target } };
});
await T("REC-07", async (check) => {
	await MV.cmd("freeze", { on: true });
	const t0 = Date.now();
	const dropped = await waitFor(async () => !(await B.status()).connected, 50000, 1000);
	const ms = Date.now() - t0;
	const st = await B.status();
	check("dropped within 45 s", !!dropped && ms <= 45000, ms);
	check("reason heartbeat timeout", /heartbeat timeout/.test(st.lastDisconnect?.reason ?? ""), st.lastDisconnect);
	await MV.cmd("freeze", { on: false });
	const t1 = Date.now();
	const back = await waitFor(async () => (await B.status()).connected, 20000, 250);
	check("recovered within 20 s", !!back, Date.now() - t1);
	check("same session after recovery", (await B.status()).reader?.session === SESSION);
	return { actual: { dropMs: ms, lastDisconnect: st.lastDisconnect, recoverMs: Date.now() - t1 } };
});
await T("REC-04", async (check) => {
	await MV.cmd("rerun");
	const ok = await waitFor(async () => {
		const s = await B.status();
		return s.connected && s.reader.session !== SESSION && s.reader;
	}, 15000);
	await sleep(1500);
	const s = await MV.stats();
	const st = await B.status();
	check("new session active", !!ok, st.reader);
	check("generation 2", st.reader?.generation === 2 && s.readerGeneration === 2, { bridge: st.reader?.generation, mock: s.readerGeneration });
	check("exactly 2 handlers connected", s.handlers === 2, s.handlers);
	check("1 live socket", s.liveSockets === 1, s.liveSockets);
	check("old reader logged replacement", s.logs.some((l) => /reader stopped: replaced by a new bootstrap run/.test(l.line)));
	return { actual: { newSession: st.reader?.session, handlers: s.handlers, liveSockets: s.liveSockets } };
});
const OLD_SESSION = SESSION;
SESSION = (await B.status()).reader?.session;
await T("REC-05", async (check) => {
	const r = await call("list_children", { target: { id: doorId } });
	check("old id stale", errCode(r) === "stale_object_id", errCode(r));
	check("session really changed", OLD_SESSION !== SESSION);
	return { actual: r.json };
});
await T("CAC-09", async (check) => {
	const before = (await MV.stats()).decompileByName?.DoorConfig;
	const r = await call("read_script", { script: { path: [...MODS, "DoorConfig"] } });
	const after = (await MV.stats()).decompileByName?.DoorConfig;
	check("miss in new session", r.json?.cache?.hit === false);
	check("decompiled again", after === before + 1, { before, after });
	return { actual: { before, after } };
});
await T("DEC-10", async (check) => {
	const s = await MV.stats();
	const requested = new Set(["DoorConfig", "BigModule", "SlowModule", "BrokenModule", "ClientRun", "LargeModule", "BadUtf8Module", "HudController", "Hashless", "ClientMain", "Par1", "Par2", "Par3", "Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9"]);
	const extra = Object.keys(s.decompileByName ?? {}).filter((n) => !requested.has(n));
	check("require never called", s.requireCalls === 0, s.requireCalls);
	check("only requested scripts decompiled", extra.length === 0, extra);
	check("NewMod never decompiled (listed only)", !s.decompileByName?.NewMod);
	return { actual: { requireCalls: s.requireCalls, decompiled: s.decompileByName } };
});
await MV.stop();

// ======================= Phase B2: reader-side connection behaviour =======================
await T("REC-08", async (check) => {
	const mv = await startMockVolt({ ctrlPort: P.ctrl2, bridgePort: P.bridge, token, overrides: { handshakeGraceSeconds: 5 }, log: (s) => (logs.lune += s) });
	await waitFor(async () => (await B.status()).connected, 15000);
	await mv.cmd("autoreconnect", { on: false });
	await mv.cmd("kill_socket");
	await waitFor(async () => !(await B.status()).connected, 5000);
	const t0 = Date.now();
	const back = await waitFor(async () => (await B.status()).connected, 20000, 250);
	const ms = Date.now() - t0;
	const s = await mv.stats();
	check("reconnected by socket replacement", !!back, ms);
	check("after grace (>=4 s)", ms >= 4000, ms);
	check("connectCalls 2", s.connectCalls === 2, s.connectCalls);
	check("maxLiveSockets 1", s.maxLiveSockets === 1, s.maxLiveSockets);
	check("replacement logged", s.logs.some((l) => /replacing socket after 5s/.test(l.line)));
	await mv.stop();
	await waitFor(async () => !(await B.status()).connected, 5000);
	return { actual: { ms, connectCalls: s.connectCalls, maxLiveSockets: s.maxLiveSockets } };
});
await T("AUTH-10", async (check) => {
	const mv = await startMockVolt({ ctrlPort: P.ctrl2, bridgePort: P.bridge, token: "y".repeat(43), log: (s) => (logs.lune += s) });
	const stopped = await waitFor(async () => (await mv.stats()).readerAlive === false && (await mv.stats()).runs === 1, 10000, 250);
	const s0 = await mv.stats();
	await sleep(20000);
	const s1 = await mv.stats();
	check("reader shut down", !!stopped);
	check("auth failure logged", s1.logs.some((l) => /authentication failed: bad_token/.test(l.line)));
	check("no further connect calls in 20 s", s1.connectCalls === s0.connectCalls && s1.connectCalls === 1, { s0: s0.connectCalls, s1: s1.connectCalls });
	check("no Volt auto-reconnects", s1.reconnects === 0, s1.reconnects);
	check("no live socket", s1.liveSockets === 0, s1.liveSockets);
	await mv.stop();
	return { actual: { connectCalls: s1.connectCalls, reconnects: s1.reconnects, liveSockets: s1.liveSockets } };
});
await B.stop();
await T("REC-06", async (check) => {
	const mv = await startMockVolt({ ctrlPort: P.ctrl2, bridgePort: P.bridge, token, log: (s) => (logs.lune += s) });
	// Windows takes ~2 s to report connection-refused on loopback, so observe for 20 s.
	await sleep(20000);
	const s0 = await mv.stats();
	const times = s0.connectTimes ?? [];
	const gaps = times.slice(1).map((t, i) => t - times[i]);
	check("repeated failures while down", s0.connectFailures >= 3, s0.connectFailures);
	check("one sequential connect loop (calls == failures)", s0.connectCalls === s0.connectFailures, { calls: s0.connectCalls, failures: s0.connectFailures });
	check("backoff intervals increase", gaps.length >= 2 && gaps.every((g, i) => i === 0 || g > gaps[i - 1]), gaps);
	check("no live socket while down", s0.liveSockets === 0);
	check("cannot-reach warning logged once", s0.logs.filter((l) => /cannot reach bridge/.test(l.line)).length === 1);
	B = await startBridge({ port: P.bridge, tokenFile, log: (s) => (logs.bridge += s) });
	const t0 = Date.now();
	const ok = await waitFor(async () => (await B.status()).connected, 40000, 500);
	const s1 = await mv.stats();
	check("connected after bridge start (<=40 s)", !!ok, Date.now() - t0);
	check("maxLiveSockets 1", s1.maxLiveSockets === 1, s1.maxLiveSockets);
	check("backoff bounds attempts (<= 8 in 20 s)", s0.connectFailures <= 8, s0.connectFailures);
	await mv.stop();
	return { actual: { failures: s0.connectFailures, gapsMs: gaps, connectMs: Date.now() - t0, connectCalls: s1.connectCalls } };
});

// ======================= Phase C: fake bridge driving the real reader =======================
await B.stop();
{
	const fb = await fakeBridge(P.fake);
	const mv = await startMockVolt({ ctrlPort: P.ctrl2, bridgePort: P.fake, token: "any-token-accepted-by-fake-bridge-000000000", log: (s) => (logs.lune += s) });
	await waitFor(() => fb.authed, 10000);
	await T("REQ-06", async (check) => {
		const ops = ["eval", "loadstring", "set_property", "fire_remote", "hook", "require", "execute"];
		const results = {};
		for (const op of ops) results[op] = (await fb.result(fb.req(op, { source: "game:Destroy()", target: { path: ["Workspace"] }, value: 1 })))?.error?.code;
		const s = await mv.stats();
		check("all unknown_op", ops.every((op) => results[op] === "unknown_op"), results);
		check("read op still works", (await fb.result(fb.req("status", {})))?.ok === true);
		check("no require calls", s.requireCalls === 0);
		return { actual: results };
	});
	await T("CAC-11", async (check) => {
		const ids = Array.from({ length: 17 }, () => fb.req("decompile", { target: { path: ["ReplicatedStorage", "Modules", "SlowModule"] } }, 300000));
		const last = await fb.result(ids[16], 5000);
		check("17th reader_busy", last?.error?.code === "reader_busy", last);
		check("others still pending", ids.slice(0, 16).every((id) => !fb.results.get(id)));
		return { actual: { last } };
	});
	await mv.stop();
	await fb.close();
}

// ======================= Phase D: unit checks on compiled modules =======================
await T("CAC-10", async (check) => {
	const { DecompileService, cacheKey } = await import("../dist/decompile.js");
	const { BridgeError } = await import("../dist/bridge.js");
	let late;
	const fake = {
		onSessionChange() {},
		session: "s",
		request: (_op, _args, opts) => {
			late = opts.onLate;
			return Promise.reject(new BridgeError("deadline_exceeded", "decompile did not finish", true));
		},
	};
	const svc = new DecompileService(fake);
	const info = { object: { id: "s:9", name: "Slow", className: "ModuleScript", path: "p" }, hash: "h".repeat(96), decompileSupport: "supported" };
	const job = svc.start("s", info, undefined);
	await job.done;
	check("status wait_expired", job.status === "wait_expired", job.status);
	check("says native decompile not cancelled", /does not cancel Volt's native decompiler/.test(job.error?.message ?? ""), job.error?.message);
	check("does not claim cancellation", !/\bcancel(l)?ed\b/i.test(job.error?.message ?? ""));
	late?.({ source: "return 'late'\n", observedAt: "t" });
	const entry = svc.lookup(cacheKey("s", info, undefined));
	check("late result cached", entry?.lines?.[0] === "return 'late'", entry?.lines);
	return { actual: { status: job.status, message: job.error?.message } };
});

// ======================= Phase E: opt-in client execution (M2) =======================
await T("EXEC-01", async (check) => {
	// A prior phase's teardown stops the shared bridge, so this case owns one.
	const Bx = await startBridge({ port: 38942, tokenFile });
	try {
		const tools = (await Bx.rpc("tools/list", {})).result.tools.map((x) => x.name);
		check("execute_luau absent by default", !tools.includes("execute_luau"), tools);
		check("six read-only tools only", tools.length === 6, tools.length);
		const r = await Bx.call("execute_luau", { source: "return 1", confirm: true });
		check("calling it fails when disabled", r.isError === true, errCode(r));
		return { actual: { tools, code: errCode(r) } };
	} finally {
		await Bx.stop();
	}
});

await T("EXEC-02", async (check) => {
	const port = 38938;
	const ctrl = 38939;
	const Be = await startBridge({ port, tokenFile, extraEnv: { VOLT_BRIDGE_ALLOW_EXEC: "1" } });
	const mv = await startMockVolt({
		ctrlPort: ctrl,
		bridgePort: port,
		token,
		runtimeConfig: { token, port, allowExec: true },
		log: (s) => (logs.lune += s),
	});
	try {
		const status = (await Be.call("get_status", { waitForReaderMs: 20000 })).json;
		const caps = status.reader?.capabilities ?? [];
		check("reader connected advertising exec", status.connected === true && caps.includes("exec"), caps);
		const tools = (await Be.rpc("tools/list", {})).result.tools.map((x) => x.name);
		check("execute_luau registered when enabled", tools.includes("execute_luau"), tools);

		const noConfirm = await Be.call("execute_luau", { source: "return 1" });
		check("refuses without confirm", errCode(noConfirm) === "exec_not_confirmed", errCode(noConfirm));

		const run = await Be.call("execute_luau", { source: "print('hello from exec') return 40 + 2", confirm: true });
		const j = run.json;
		check("completed", j?.status === "completed", j?.status);
		check("captured print output", /hello from exec/.test(j?.output ?? ""), j?.output);
		check("returned value serialized", (j?.returns ?? []).includes("42"), j?.returns);
		check("marked executed", j?.executed === true);

		const dup = await Be.call("execute_luau", { source: "print('should not run')", confirm: true, runId: j?.runId });
		check("reused runId did not re-execute", dup.json?.duplicateOfPreviousRun === true && !/should not run/.test(dup.json?.output ?? ""), dup.json);

		const compile = await Be.call("execute_luau", { source: "local = = =", confirm: true });
		check("compile error reported", compile.json?.status === "compile_error", JSON.stringify(compile.json ?? compile.texts));

		const runtime = await Be.call("execute_luau", { source: "error('boom')", confirm: true });
		check("runtime error reported", runtime.json?.status === "runtime_error" && /boom/.test(runtime.json?.runtimeError ?? ""), runtime.json?.runtimeError);

		const big = await Be.call("execute_luau", { source: "x".repeat(100_001), confirm: true });
		check("oversized source refused", big.isError === true || /limit/.test(big.json?.note ?? ""), JSON.stringify(big.json ?? big.texts).slice(0, 300));
	} finally {
		await mv.stop();
		await Be.stop();
	}
});

await T("EXEC-03", async (check) => {
	const port = 38940;
	const ctrl = 38941;
	const Be = await startBridge({ port, tokenFile, extraEnv: { VOLT_BRIDGE_ALLOW_EXEC: "1" } });
	const mv = await startMockVolt({
		ctrlPort: ctrl,
		bridgePort: port,
		token,
		runtimeConfig: { token, port },
		log: (s) => (logs.lune += s),
	});
	try {
		const status = (await Be.call("get_status", { waitForReaderMs: 20000 })).json;
		const caps = status.reader?.capabilities ?? [];
		check("reader did not advertise exec", status.connected === true && !caps.includes("exec"), caps);
		const r = await Be.call("execute_luau", { source: "return 1", confirm: true });
		check("reports reader without exec", errCode(r) === "exec_unavailable", errCode(r));
	} finally {
		await mv.stop();
		await Be.stop();
	}
});

await T("EXEC-04", async (check) => {
	const port = 38944;
	const ctrl = 38945;
	const Be = await startBridge({ port, tokenFile, extraEnv: { VOLT_BRIDGE_ALLOW_EXEC: "1" } });
	const mv = await startMockVolt({
		ctrlPort: ctrl,
		bridgePort: port,
		token,
		runtimeConfig: { token, port, allowExec: true },
		log: (s) => (logs.lune += s),
	});
	try {
		const st = (await Be.call("get_status", { waitForReaderMs: 20000 })).json;
		check("reader ready with exec", st.connected === true && (st.reader?.capabilities ?? []).includes("exec"), st.reader?.capabilities);
		const t0 = Date.now();
		const slow = await Be.call("execute_luau", { source: "task.wait(3) return 'late'", confirm: true, deadlineMs: 1000 }, 20000);
		const elapsed = Date.now() - t0;
		check("reports timeout", slow.json?.status === "timeout", slow.json?.status);
		check("unknown outcome, may still be running", slow.json?.unknownOutcome === true && slow.json?.clientMayStillBeRunning === true);
		check(
			"timeout notice does not falsely deny execution",
			/unknown/i.test(slow.json?.notice ?? "") && /may still be running/i.test(slow.json?.notice ?? "") &&
				!/did not execute/i.test(slow.json?.notice ?? ""),
			slow.json?.notice,
		);
		check(
			"does not claim cancellation",
			/UNKNOWN/.test(slow.json?.note ?? "") && /does not cancel/.test(slow.json?.note ?? ""),
			slow.json?.note,
		);
		check("deadline honoured", elapsed >= 900 && elapsed < 2900, elapsed);
		const duplicate = await Be.call("execute_luau", { source: "error('must not execute')", confirm: true, runId: slow.json?.runId });
		check("retained timeout stays unknown without replay", duplicate.json?.status === "duplicate" && duplicate.json?.executed === false &&
			duplicate.json?.unknownOutcome === true && duplicate.json?.output === null, duplicate.json);
		check("duplicate preserves original uncertainty instead of claiming it ran", /UNKNOWN/.test(duplicate.json?.note ?? "") &&
			!/already ran/i.test(duplicate.json?.note ?? ""), duplicate.json?.note);
		check("duplicate timeout notice remains uncertain", /unknown/i.test(duplicate.json?.notice ?? "") &&
			!/did not execute/i.test(duplicate.json?.notice ?? ""), duplicate.json?.notice);
		// The yielding chunk finishes after the bridge gave up; its late result must be dropped, not misfiled.
		await sleep(3500);
		const after = await Be.call("execute_luau", { source: "print('after timeout') return 'ok'", confirm: true });
		check(
			"later run unaffected by the late result",
			after.json?.status === "completed" && /after timeout/.test(after.json?.output ?? ""),
			after.json,
		);
	} finally {
		await mv.stop();
		await Be.stop();
	}
});

await T("EXEC-05", async (check) => {
	const port = 38946;
	const ctrl = 38947;
	const Be = await startBridge({ port, tokenFile, extraEnv: { VOLT_BRIDGE_ALLOW_EXEC: "1" } });
	const mv = await startMockVolt({
		ctrlPort: ctrl,
		bridgePort: port,
		token,
		runtimeConfig: { token, port, allowExec: true },
		log: (s) => (logs.lune += s),
	});
	try {
		await Be.call("get_status", { waitForReaderMs: 20000 });
		await mv.cmd("setfenv", { on: true });
		const hidden = await Be.call("execute_luau", { source: "print('hidden') return 'y'", confirm: true });
		check("capture reported none", hidden.json?.capture === "none", hidden.json?.capture);
		check("no captured output", (hidden.json?.output ?? "") === "", hidden.json?.output);
		check("returns unaffected", (hidden.json?.returns ?? []).includes("y"), hidden.json?.returns);
		await mv.cmd("setfenv", { on: false });
		const visible = await Be.call("execute_luau", { source: "print('visible') return 'z'", confirm: true });
		check("capture restored", visible.json?.capture === "print+warn", visible.json?.capture);
		check("output captured again", /visible/.test(visible.json?.output ?? ""), visible.json?.output);
	} finally {
		await mv.stop();
		await Be.stop();
	}
});

const file = rec.save();
writeFileSync(join(RESULTS, `${rec.runId}-bridge.log`), logs.bridge);
writeFileSync(join(RESULTS, `${rec.runId}-lune.log`), logs.lune);
const counts = rec.results.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
console.log(`\nresults: ${file}\ncounts: ${JSON.stringify(counts)}  revision ${rec.revision}`);
process.exit(0);
