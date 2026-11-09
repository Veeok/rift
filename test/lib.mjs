// Shared helpers for the volt-bridge validation suites.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, openSync, closeSync, unlinkSync } from "node:fs";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TMP = join(ROOT, "test", ".tmp");
export const RESULTS = join(ROOT, "test", "results");
mkdirSync(TMP, { recursive: true });
mkdirSync(RESULTS, { recursive: true });

// Both model-driven runners share exports/. Refuse overlap before launching a model.
// Never steal an existing lease: a crashed run's lock requires explicit inspection/removal.
export function acquireGenerationLock(path = join(TMP, 'generation.lock')) {
	let fd;
	try { fd = openSync(path, 'wx'); }
	catch (err) {
		if (err.code === 'EEXIST') throw new Error(`Another generation run is active (lock ${path}); do not run concurrently.`);
		throw err;
	}
	writeFileSync(fd, JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}));
	let released = false;
	return () => {
		if (released) return;
		released = true;
		closeSync(fd);
		unlinkSync(path);
	};
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, timeoutMs, intervalMs = 200) {
	const t0 = Date.now();
	let last;
	while (Date.now() - t0 < timeoutMs) {
		last = await fn();
		if (last) return last;
		await sleep(intervalMs);
	}
	return last;
}

export function testToken() {
	const file = join(TMP, "token");
	if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("base64url") + "\n");
	return { file, token: readFileSync(file, "utf8").trim() };
}

// Revision fingerprint of everything under test.
export function revision() {
	const h = createHash("sha256");
	const files = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir).sort()) {
			const p = join(dir, name);
			if (statSync(p).isDirectory()) walk(p);
			else files.push(p);
		}
	};
	walk(join(ROOT, "src"));
	files.push(join(ROOT, "luau", "bootstrap.template.luau"));
	for (const f of files) h.update(f.slice(ROOT.length)).update(readFileSync(f));
	return h.digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Bridge process with a raw JSON-RPC client over stdio (stdout must be JSON-RPC only)
// ---------------------------------------------------------------------------
export async function startBridge({ port, tokenFile, extraEnv = {}, log = () => {} } = {}) {
	const env = { ...process.env, VOLT_BRIDGE_PORT: String(port), ...extraEnv };
	if (tokenFile) env.VOLT_BRIDGE_TOKEN_FILE = tokenFile;
	const child = spawn(process.execPath, [join(ROOT, "dist", "index.js")], { env, stdio: ["pipe", "pipe", "pipe"], cwd: ROOT });
	const b = { child, stdoutLines: [], nonJsonLines: [], stderr: "", exitCode: undefined, waiters: new Map(), nextId: 1 };
	let buf = "";
	// Decode as a UTF-8 stream: pipe chunks can split multi-byte characters.
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (d) => {
		buf += d;
		let i;
		while ((i = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, i).replace(/\r$/, "");
			buf = buf.slice(i + 1);
			if (!line.length) continue;
			b.stdoutLines.push(line);
			let msg;
			try {
				msg = JSON.parse(line);
			} catch {
				b.nonJsonLines.push(line);
				continue;
			}
			if (msg.jsonrpc !== "2.0") b.nonJsonLines.push(line);
			b.waiters.get(msg.id)?.(msg);
		}
	});
	child.stderr.on("data", (d) => {
		b.stderr += d;
		log(String(d));
	});
	b.exited = new Promise((r) => child.on("exit", (code) => ((b.exitCode = code), r(code))));
	b.rpc = (method, params, timeoutMs = 60_000) =>
		new Promise((resolve, reject) => {
			const id = b.nextId++;
			const timer = setTimeout(() => reject(new Error(`rpc ${method} timeout`)), timeoutMs);
			b.waiters.set(id, (m) => {
				clearTimeout(timer);
				b.waiters.delete(id);
				resolve(m);
			});
			child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
		});
	b.notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
	b.call = async (name, args = {}, timeoutMs = 60_000) => {
		const m = await b.rpc("tools/call", { name, arguments: args }, timeoutMs);
		if (m.error) return { rpcError: m.error, isError: true, json: null, texts: [] };
		const texts = (m.result.content ?? []).map((c) => c.text);
		let json = null;
		try {
			json = JSON.parse(texts[0]);
		} catch {
			/* schema errors come back as plain text */
		}
		return { isError: m.result.isError === true, json, texts, raw: m.result };
	};
	b.init = await b.rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "volt-tests", version: "1" } });
	b.notify("notifications/initialized");
	// Harness status polls must not trigger the automatic startup wait.
	b.status = async () => (await b.call("get_status", { waitForReaderMs: 0 })).json;
	b.stop = async () => {
		if (b.exitCode !== undefined) return b.exitCode;
		child.stdin.end();
		const code = await Promise.race([b.exited, sleep(8000).then(() => "timeout")]);
		if (code === "timeout") child.kill();
		return code;
	};
	await waitFor(async () => {
		const s = await b.status();
		return s && s.listener.state !== "starting";
	}, 5000);
	return b;
}

export function portOpen(port, host = "127.0.0.1") {
	return new Promise((resolve) => {
		const s = net.connect({ port, host }, () => {
			s.destroy();
			resolve(true);
		});
		s.on("error", () => resolve(false));
		s.setTimeout(1500, () => {
			s.destroy();
			resolve(false);
		});
	});
}

// ---------------------------------------------------------------------------
// Stub reader (Node) speaking the reader side of the protocol
// ---------------------------------------------------------------------------
export function stubReader({ port, token, session = "a1b2c3d4-0000-4000-8000-000000000001", auth = true, autoPong = true, onReq, headers, path = "/volt", protocol = 1, nonceOverride } = {}) {
	const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
	const r = { ws, messages: [], reqs: [], closed: null, authOk: null, authFail: null, autoPong, session };
	r.opened = new Promise((res) => ws.on("open", () => res(true)));
	r.closedP = new Promise((res) => ws.on("close", (code, reason) => ((r.closed = { code, reason: reason.toString() }), res(r.closed))));
	ws.on("error", (e) => (r.error = e.message));
	ws.on("unexpected-response", (_req, res) => (r.unexpected = res.statusCode));
	ws.on("message", (d) => {
		let m;
		try {
			m = JSON.parse(d.toString());
		} catch {
			return;
		}
		r.messages.push(m);
		if (m.type === "hello" && auth)
			r.send({
				v: protocol,
				type: "auth",
				token,
				nonce: nonceOverride ?? m.nonce,
				reader: { session, generation: 1, readerVersion: "stub", executor: { name: "stub", version: "0" }, placeId: 99, gameId: 98, jobId: "stub-job", placeVersion: 1, capabilities: ["WebSocket"] },
			});
		if (m.type === "auth_ok") r.authOk = m;
		if (m.type === "auth_fail") r.authFail = m;
		if (m.type === "ping" && r.autoPong) r.send({ v: 1, type: "pong", t: m.t });
		if (m.type === "req") {
			r.reqs.push(m);
			onReq?.(m, r);
		}
	});
	r.send = (obj) => ws.readyState === WebSocket.OPEN && ws.send(typeof obj === "string" ? obj : JSON.stringify(obj));
	r.reply = (id, result) => r.send({ v: 1, type: "res", id, ok: true, result });
	r.replyError = (id, code, message) => r.send({ v: 1, type: "res", id, ok: false, error: { code, message } });
	r.waitAuth = (ms = 5000) => waitFor(() => r.authOk || r.authFail || r.closed, ms, 50);
	r.close = () => ws.close();
	return r;
}

// ---------------------------------------------------------------------------
// Fake bridge (Node) for driving the real Luau reader with arbitrary ops
// ---------------------------------------------------------------------------
export function fakeBridge(port) {
	const wss = new WebSocketServer({ host: "127.0.0.1", port });
	const fb = { wss, conn: null, results: new Map(), authed: false, seq: 0 };
	wss.on("connection", (ws) => {
		fb.conn = ws;
		const nonce = "n" + Date.now();
		ws.send(JSON.stringify({ v: 1, type: "hello", nonce }));
		ws.on("message", (d) => {
			const m = JSON.parse(d.toString());
			if (m.type === "hi") ws.send(JSON.stringify({ v: 1, type: "hello", nonce }));
			if (m.type === "auth") {
				fb.authed = true;
				fb.reader = m.reader;
				ws.send(JSON.stringify({ v: 1, type: "auth_ok", connectionId: "fake1", session: m.reader.session }));
			}
			if (m.type === "res") fb.results.set(m.id, m);
			if (m.type === "ping") ws.send(JSON.stringify({ v: 1, type: "pong", t: m.t }));
		});
	});
	fb.req = (op, args = {}, deadlineMs = 15000) => {
		const id = "f" + ++fb.seq;
		fb.conn.send(JSON.stringify({ v: 1, type: "req", id, op, args, deadlineMs }));
		return id;
	};
	fb.result = (id, ms = 10000) => waitFor(() => fb.results.get(id), ms, 50);
	fb.close = () => new Promise((r) => (wss.clients.forEach((c) => c.terminate()), wss.close(() => r())));
	return new Promise((res) => wss.on("listening", () => res(fb)));
}

// ---------------------------------------------------------------------------
// Lune mock Volt (runs the real bootstrap against a mock world)
// ---------------------------------------------------------------------------
export async function startMockVolt({ ctrlPort, bridgePort, token, overrides = {}, variant = "default", runtimeConfig = null, readerFile = "", log = () => {} }) {
	const wss = new WebSocketServer({ host: "127.0.0.1", port: ctrlPort });
	await new Promise((r) => wss.on("listening", r));
	const mv = { out: "", pending: new Map(), seq: 0 };
	const connected = new Promise((resolve) =>
		wss.on("connection", (ws) => {
			mv.ws = ws;
			ws.on("message", (d) => {
				const m = JSON.parse(d.toString());
				if (m.type === "ready") resolve();
				else mv.pending.get(m.id)?.(m);
			});
		}),
	);
	const child = spawn(
		join(ROOT, ".tools", "lune.exe"),
		["run", "test/lune/mockvolt.luau", `ws://127.0.0.1:${ctrlPort}`, `ws://127.0.0.1:${bridgePort}/volt`, token, JSON.stringify(overrides), variant, JSON.stringify(runtimeConfig), readerFile],
		{ cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
	);
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (d) => ((mv.out += d), log(String(d))));
	child.stderr.on("data", (d) => ((mv.out += d), log(String(d))));
	mv.exited = new Promise((r) => child.on("exit", r));
	await Promise.race([connected, mv.exited.then(() => Promise.reject(new Error("lune exited early:\n" + mv.out))), sleep(20000).then(() => Promise.reject(new Error("lune ready timeout")))]);
	mv.cmd = (cmd, args = {}, ms = 30000) =>
		new Promise((resolve, reject) => {
			const id = ++mv.seq;
			const t = setTimeout(() => reject(new Error("ctrl timeout " + cmd)), ms);
			mv.pending.set(id, (m) => (clearTimeout(t), mv.pending.delete(id), resolve(m)));
			mv.ws.send(JSON.stringify({ id, cmd, ...args }));
		});
	// Lune's JSON encodes empty tables as {}; normalize list fields to arrays.
	mv.stats = async () => {
		const s = (await mv.cmd("stats")).stats;
		for (const k of ["ops", "logs", "connectTimes"]) if (!Array.isArray(s[k])) s[k] = [];
		return s;
	};
	mv.stop = async () => {
		try {
			await mv.cmd("exit", {}, 3000);
		} catch {
			/* ignore */
		}
		await Promise.race([mv.exited, sleep(3000)]);
		child.kill();
		await new Promise((r) => wss.close(() => r()));
	};
	mv.child = child;
	return mv;
}

// ---------------------------------------------------------------------------
// Result recording
// ---------------------------------------------------------------------------
export class Recorder {
	constructor(suite, catalog) {
		this.suite = suite;
		this.catalog = new Map(catalog.map((t) => [t.id, t]));
		this.results = [];
		this.runId = `${suite}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
		this.revision = revision();
		this.startedAt = new Date().toISOString();
	}
	async run(id, fn) {
		const meta = this.catalog.get(id);
		if (!meta) throw new Error("test not in catalog: " + id);
		const t0 = Date.now();
		const rec = { id, area: meta.area, kind: meta.kind, title: meta.title, expected: meta.expected, status: "fail", actual: null, evidence: null, assertions: [], durationMs: 0, at: new Date().toISOString() };
		const check = (name, cond, detail) => {
			rec.assertions.push({ name, pass: !!cond, detail: detail === undefined ? undefined : detail });
			return !!cond;
		};
		try {
			const out = (await fn(check)) ?? {};
			rec.actual = out.actual ?? null;
			rec.evidence = out.evidence ?? null;
			if (out.blocked) rec.status = "blocked";
			else rec.status = rec.assertions.length > 0 && rec.assertions.every((a) => a.pass) ? "pass" : "fail";
			if (rec.assertions.length === 0 && !out.blocked) rec.assertions.push({ name: "no assertions recorded", pass: false });
		} catch (err) {
			rec.status = "fail";
			rec.actual = { exception: String(err?.stack ?? err).slice(0, 2000) };
		}
		rec.durationMs = Date.now() - t0;
		this.results.push(rec);
		const failed = rec.assertions.filter((a) => !a.pass).map((a) => a.name);
		process.stdout.write(`${rec.status.toUpperCase().padEnd(7)} ${id.padEnd(8)} ${meta.title}${failed.length ? "  <- " + failed.join("; ") : ""}${rec.actual?.exception ? "  <- " + rec.actual.exception.split("\n")[0] : ""}\n`);
		return rec;
	}
	save(extra = {}) {
		const file = join(RESULTS, this.runId + ".json");
		writeFileSync(file, JSON.stringify({ runId: this.runId, suite: this.suite, revision: this.revision, startedAt: this.startedAt, finishedAt: new Date().toISOString(), ...extra, results: this.results }, null, 2));
		return file;
	}
}

export function luauSyntaxCheck(file) {
	const r = spawnSync("C:/LOCAL_USER\\.local\\bin\\luau-lsp.exe", ["analyze", "--platform=roblox", "--definitions=" + join(ROOT, "..", "luau", "globalTypes.None.d.luau"), file], { encoding: "utf8" });
	const out = (r.stdout ?? "") + (r.stderr ?? "");
	const syntax = out.split(/\r?\n/).filter((l) => /SyntaxError|\(\d+,\d+\): (SyntaxError|ParseError)/.test(l));
	return { exit: r.status, syntaxErrors: syntax, output: out.slice(0, 4000) };
}

// DDMMYY of a timestamp in local time (export names must use the day they were written).
export function ddmmyy(ms = Date.now()) {
	const d = new Date(ms);
	return String(d.getDate()).padStart(2, "0") + String(d.getMonth() + 1).padStart(2, "0") + String(d.getFullYear()).slice(-2);
}

// Build id stamped into rendered bootstraps (sha256 prefix of the reader template).
export function templateBuild() {
	return createHash("sha256").update(readFileSync(join(ROOT, "luau", "bootstrap.template.luau"), "utf8"), "utf8").digest("hex").slice(0, 12);
}
