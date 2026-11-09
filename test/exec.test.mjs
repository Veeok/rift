// Focused tests for the opt-in client execution service (M2).
// Run: node test/exec.test.mjs
//
// These cover the contract boundaries only: opt-in gates, explicit confirm, runId
// correlation/dedupe, bounds, and honest timeout/disconnect reporting.

import assert from "node:assert/strict";
import { ExecService } from "../dist/exec.js";
import { BridgeError } from "../dist/bridge.js";

const READER = {
	session: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
	connectionId: "c1",
	placeId: 123414640536127,
	jobId: "job-1",
	capabilities: ["WebSocket", "getscripts", "exec"],
};

function bridgeStub({ reader = READER, request } = {}) {
	return {
		reader,
		request:
			request ??
			(async () => ({
				executed: true,
				compiled: true,
				ok: true,
				output: "",
				returns: [],
			})),
	};
}

const tests = [];
function test(name, fn) {
	tests.push([name, fn]);
}

test("disabled bridge refuses before contacting the reader", async () => {
	let called = 0;
	const svc = new ExecService(
		bridgeStub({
			request: async () => {
				called += 1;
				return {};
			},
		}),
		false,
	);
	await assert.rejects(
		() => svc.run("print(1)", { confirm: true }),
		(e) => e instanceof BridgeError && e.code === "exec_disabled",
	);
	assert.equal(called, 0);
});

test("missing confirm refuses without sending", async () => {
	let called = 0;
	const svc = new ExecService(
		bridgeStub({
			request: async () => {
				called += 1;
				return {};
			},
		}),
		true,
	);
	const out = await svc.run("print(1)", {});
	assert.equal(out.status, "rejected");
	assert.equal(out.executed, false);
	assert.equal(called, 0);
	assert.match(out.note, /confirm:true/);
});

test("reader without the exec capability is reported as unavailable", async () => {
	const svc = new ExecService(bridgeStub({ reader: { ...READER, capabilities: ["WebSocket"] } }), true);
	await assert.rejects(
		() => svc.run("print(1)", { confirm: true }),
		(e) => e instanceof BridgeError && e.code === "exec_unavailable",
	);
});

test("completed run returns output and marks executed", async () => {
	const svc = new ExecService(
		bridgeStub({
			request: async () => ({ executed: true, compiled: true, ok: true, output: "hello", returns: ["42"], durationMs: 5 }),
		}),
		true,
	);
	const out = await svc.run("print('hello')", { confirm: true });
	assert.equal(out.status, "completed");
	assert.equal(out.executed, true);
	assert.equal(out.output, "hello");
	assert.deepEqual(out.returns, ["42"]);
});

test("concurrent runs get distinct ids and isolated results", async () => {
	const seen = [];
	const svc = new ExecService(
		bridgeStub({
			request: async (_op, args) => {
				seen.push(args.runId);
				await new Promise((r) => setTimeout(r, 10));
				return { executed: true, compiled: true, ok: true, output: `out:${args.source}` };
			},
		}),
		true,
	);
	const [a, b] = await Promise.all([svc.run("A", { confirm: true }), svc.run("B", { confirm: true })]);
	assert.notEqual(a.runId, b.runId);
	assert.equal(a.output, "out:A");
	assert.equal(b.output, "out:B");
	assert.equal(new Set(seen).size, 2);
});

test("a fifth concurrent run is refused with exec_queue_full", async () => {
	let release;
	const gate = new Promise((r) => (release = r));
	const svc = new ExecService(
		bridgeStub({
			request: async () => {
				await gate;
				return { executed: true, compiled: true, ok: true, output: "ok" };
			},
		}),
		true,
	);
	const firstFour = [0, 1, 2, 3].map((i) => svc.run(`p${i}`, { confirm: true }));
	const fifth = await svc.run("p4", { confirm: true });
	assert.equal(fifth.rejectionCode, "exec_queue_full");
	assert.equal(fifth.executed, false);
	release();
	const done = await Promise.all(firstFour);
	assert.ok(done.every((d) => d.status === "completed"));
});

test("capture mode is surfaced from the reader", async () => {
	const svc = new ExecService(
		bridgeStub({
			request: async () => ({ executed: true, compiled: true, ok: true, capture: "none", output: "", returns: ["y"] }),
		}),
		true,
	);
	const out = await svc.run("print('x') return 'y'", { confirm: true });
	assert.equal(out.status, "completed");
	assert.equal(out.capture, "none");
	assert.equal(out.output, "");
	assert.deepEqual(out.returns, ["y"]);
});

test("compile error is reported and nothing ran", async () => {
	const svc = new ExecService(
		bridgeStub({ request: async () => ({ executed: false, compiled: false, compileError: "boom" }) }),
		true,
	);
	const out = await svc.run("!!!", { confirm: true });
	assert.equal(out.status, "compile_error");
	assert.equal(out.compiled, false);
	assert.equal(out.compileError, "boom");
});

test("reusing a minted runId never executes a second time", async () => {
	let called = 0;
	const svc = new ExecService(
		bridgeStub({
			request: async () => {
				called += 1;
				return { executed: true, compiled: true, ok: true, output: "x" };
			},
		}),
		true,
	);
	const first = await svc.run("print(1)", { confirm: true });
	const second = await svc.run("print(2)", { confirm: true, runId: first.runId });
	assert.equal(called, 1);
	assert.equal(second.duplicateOfPreviousRun, true);
	assert.equal(second.runId, first.runId);
	// The reused call must not claim it ran anything.
	assert.equal(second.status, "duplicate");
	assert.equal(second.executed, false);
	assert.equal(second.output, first.output);
});

test("an unknown caller-supplied runId is refused without executing", async () => {
	let called = 0;
	const svc = new ExecService(
		bridgeStub({
			request: async () => {
				called += 1;
				return {};
			},
		}),
		true,
	);
	const out = await svc.run("print(1)", { confirm: true, runId: "never-issued" });
	assert.equal(called, 0);
	assert.equal(out.status, "rejected");
	assert.equal(out.rejectionCode, "unknown_run_id");
	assert.equal(out.executed, false);
});

test("an evicted runId cannot be executed again", async () => {
	let called = 0;
	const svc = new ExecService(
		bridgeStub({
			request: async () => {
				called += 1;
				return { executed: true, compiled: true, ok: true, output: "ok" };
			},
		}),
		true,
	);
	const first = await svc.run("print(0)", { confirm: true });
	// Retention holds 32 outcomes, so 40 further runs evict the first.
	for (let i = 0; i < 40; i += 1) await svc.run(`print(${i})`, { confirm: true });
	assert.equal(called, 41);
	const replay = await svc.run("print('replay')", { confirm: true, runId: first.runId });
	assert.equal(called, 41, "evicted id must not reach the client");
	assert.equal(replay.status, "rejected");
	assert.equal(replay.rejectionCode, "unknown_run_id");
	assert.equal(replay.executed, false);
});

test("timeout reports unknown outcome and does not claim cancellation", async () => {
	const svc = new ExecService(
		bridgeStub({
			request: async () => {
				throw new BridgeError("deadline_exceeded", "late", true);
			},
		}),
		true,
	);
	const out = await svc.run("task.wait(999)", { confirm: true });
	assert.equal(out.status, "timeout");
	assert.equal(out.unknownOutcome, true);
	assert.equal(out.clientMayStillBeRunning, true);
	assert.match(out.note, /UNKNOWN/);
	assert.match(out.note, /does not cancel|cannot confirm/);
});

test("disconnect reports unknown outcome and is not replayed", async () => {
	const svc = new ExecService(
		bridgeStub({
			request: async () => {
				throw new BridgeError("disconnected", "gone", true);
			},
		}),
		true,
	);
	const out = await svc.run("print(1)", { confirm: true });
	assert.equal(out.status, "disconnected");
	assert.equal(out.unknownOutcome, true);
	assert.match(out.note, /not be replayed/);
});

test("oversized source is refused without sending", async () => {
	let called = 0;
	const svc = new ExecService(
		bridgeStub({
			request: async () => {
				called += 1;
				return {};
			},
		}),
		true,
	);
	const out = await svc.run("x".repeat(100_001), { confirm: true });
	assert.equal(out.status, "rejected");
	assert.equal(called, 0);
});

let passed = 0;
const failures = [];
for (const [name, fn] of tests) {
	try {
		await fn();
		passed += 1;
		console.log(`PASS ${name}`);
	} catch (err) {
		failures.push([name, err]);
		console.log(`FAIL ${name}`);
	}
}
console.log(`\n${passed}/${tests.length} passed`);
if (failures.length > 0) {
	for (const [name, err] of failures) console.log(`\n${name}\n  ${err instanceof Error ? err.stack : String(err)}`);
	process.exitCode = 1;
}
