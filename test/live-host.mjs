// Live host: keeps the real bridge (port 38917, real .secrets/token) running between live test phases.
// Control API on 127.0.0.1:38960 (loopback only): POST /call {name,args}, POST /stop, POST /start, GET /status.
// Every call and result is appended to test/results/live-host-<ts>.jsonl as evidence.
import http from "node:http";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { RESULTS, startBridge } from "./lib.mjs";

const PORT = 38917;
const CTRL = 38960;
const evidence = join(RESULTS, `live-host-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
const note = (o) => appendFileSync(evidence, JSON.stringify({ at: new Date().toISOString(), ...o }) + "\n");
let bridge = null;
let bridgeLog = "";

async function start() {
	if (bridge && bridge.exitCode === undefined) return;
	bridge = await startBridge({ port: PORT, log: (s) => ((bridgeLog += s), process.stderr.write(s)) });
	note({ event: "bridge_started" });
}
async function stop() {
	if (!bridge) return;
	const code = await bridge.stop();
	note({ event: "bridge_stopped", code });
	bridge = null;
}

const server = http.createServer(async (req, res) => {
	let body = "";
	for await (const c of req) body += c;
	const send = (o) => (res.writeHead(200, { "Content-Type": "application/json" }), res.end(JSON.stringify(o)));
	try {
		if (req.url === "/status") return send({ running: !!bridge, status: bridge ? await bridge.status() : null });
		if (req.url === "/start") return await start(), send({ ok: true });
		if (req.url === "/stop") return await stop(), send({ ok: true });
		if (req.url === "/log") return send({ log: bridgeLog.slice(-20000) });
		if (req.url === "/exit") {
			await stop();
			send({ ok: true });
			return setTimeout(() => process.exit(0), 100);
		}
		if (req.url === "/call") {
			if (!bridge) return send({ error: "bridge not running" });
			const { name, args, timeoutMs } = JSON.parse(body || "{}");
			const r = await bridge.call(name, args ?? {}, timeoutMs ?? 90000);
			note({ event: "call", name, args, isError: r.isError, json: r.json, sourceChars: r.texts[1]?.length });
			return send(r);
		}
		res.writeHead(404).end();
	} catch (err) {
		send({ error: String(err) });
	}
});
server.listen(CTRL, "127.0.0.1", async () => {
	await start();
	console.log(`live host ready; bridge ws://127.0.0.1:${PORT}/volt; control http://127.0.0.1:${CTRL}; evidence ${evidence}`);
});
