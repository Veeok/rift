// Opt-in client execution (M2).
//
// Contract:
//  - Disabled unless the bridge was started with VOLT_BRIDGE_ALLOW_EXEC and the reader was
//    loaded with execution enabled. A mismatch is a hard error, never a silent downgrade.
//  - Every run needs an explicit confirm:true from the caller.
//  - The bridge mints the runId; the reader refuses to execute the same runId twice.
//  - Nothing is queued while the reader is disconnected and nothing is replayed on reconnect.
//  - A timeout or disconnect reports an UNKNOWN outcome. The client may still be running;
//    neither the bridge nor the reader can cancel it.
//  - This runs in the Roblox client with the executor's permissions. It grants no server
//    authority, and results are untrusted game/client data.

import { Bridge, BridgeError } from "./bridge.js";
import { LIMITS } from "./limits.js";
import { log } from "./log.js";
import { createHash } from "node:crypto";

export type ExecStatus = "completed" | "compile_error" | "runtime_error" | "duplicate" | "timeout" | "disconnected" | "rejected";

export interface ExecOutcome {
	runId: string;
	status: ExecStatus;
	/** True when we cannot say whether the client ran, is running, or finished. */
	unknownOutcome: boolean;
	clientMayStillBeRunning: boolean;
	executed: boolean;
	confirmed: boolean;
	durationMs: number | null;
	sourceChars: number;
	reader: { session: string; connectionId: string; placeId: number; jobId: string } | null;
	sentAt: string;
	completedAt: string | null;
	compiled: boolean | null;
	ok: boolean | null;
	compileError: string | null;
	runtimeError: string | null;
	output: string | null;
	outputTruncated: boolean;
	returns: unknown[];
	environment: string | null;
	capture: string | null;
	duplicateOfPreviousRun: boolean;
	rejectionCode: string | null;
	note: string;
}

interface Retained {
	outcome: ExecOutcome;
	sourceHash: string;
}

export interface ExecutionSource {
	runId: string;
	sessionId: string;
	connectionId: string;
	source: string;
	revision: string;
	observedAt: string;
}

function clampText(v: unknown, max: number): string | null {
	if (typeof v !== "string") return null;
	return v.length > max ? v.slice(0, max) : v;
}

export class ExecService {
	private readonly retained = new Map<string, Retained>();
	private readonly order: string[] = [];
	private readonly sources = new Map<string, ExecutionSource>();
	private inFlight = 0;
	private seq = 0;

	constructor(
		private readonly bridge: Bridge,
		private readonly enabled: boolean,
	) {}

	get isEnabled(): boolean {
		return this.enabled;
	}

	/** Reasons execution cannot run right now, or null when it can. */
	private unavailableReason(): { code: "exec_disabled" | "not_connected" | "exec_unavailable"; message: string } | null {
		if (!this.enabled) {
			return {
				code: "exec_disabled",
				message:
					"client execution is disabled for this bridge; set VOLT_BRIDGE_ALLOW_EXEC=1 in the MCP server environment and restart it",
			};
		}
		const reader = this.bridge.reader;
		if (!reader) {
			return { code: "not_connected", message: "no authenticated Volt reader; run the bootstrap in Volt" };
		}
		if (!reader.capabilities.includes("exec")) {
			return {
				code: "exec_unavailable",
				message:
					"the connected reader did not enable execution; set getgenv().VoltBridgeAllowExec = true before loading the reader (or allowExec = true in VoltBridgeConfig), then reload it",
			};
		}
		return null;
	}

	private evict(): void {
		while (this.order.length > LIMITS.execMaxRetainedResults) {
			const id = this.order.shift();
			if (id !== undefined) { this.retained.delete(id); this.sources.delete(id); }
		}
	}

	private remember(outcome: ExecOutcome, sourceHash: string): ExecOutcome {
		this.retained.set(outcome.runId, { outcome, sourceHash });
		this.order.push(outcome.runId);
		this.evict();
		return outcome;
	}

	private baseOutcome(runId: string, sourceChars: number): ExecOutcome {
		const reader = this.bridge.reader;
		return {
			runId,
			status: "rejected",
			unknownOutcome: false,
			clientMayStillBeRunning: false,
			executed: false,
			confirmed: false,
			durationMs: null,
			sourceChars,
			reader: reader
				? { session: reader.session, connectionId: reader.connectionId, placeId: reader.placeId, jobId: reader.jobId }
				: null,
			sentAt: new Date().toISOString(),
			completedAt: null,
			compiled: null,
			ok: null,
			compileError: null,
			runtimeError: null,
			output: null,
			outputTruncated: false,
			returns: [],
			environment: null,
			capture: null,
			duplicateOfPreviousRun: false,
			rejectionCode: null,
			note: "",
		};
	}

	/** Look up a retained run without executing anything. */
	lookup(runId: string): ExecOutcome | null {
		return this.retained.get(runId)?.outcome ?? null;
	}

	/** Only explicitly approved input, scoped to the socket that received it. Not game source. */
	sourceEntries(sessionId: string, connectionId: string): ExecutionSource[] {
		return [...this.sources.values()].filter(source => source.sessionId === sessionId && source.connectionId === connectionId).map(source => ({...source}));
	}

	list(): Array<{ runId: string; status: ExecStatus; executed: boolean; at: string }> {
		return this.order.map((id) => {
			const r = this.retained.get(id);
			return {
				runId: id,
				status: r?.outcome.status ?? "rejected",
				executed: r?.outcome.executed ?? false,
				at: r?.outcome.sentAt ?? "",
			};
		});
	}

	async run(
		source: unknown,
		opts: { confirm?: boolean; runId?: string; deadlineMs?: number; sourceHash?: string } = {},
	): Promise<ExecOutcome> {
		const text = typeof source === "string" ? source : "";
		const proposedId = opts.runId?.trim();

		// A caller-supplied runId only ever references an earlier run; it never authorises a new
		// execution. Unknown or evicted ids are refused rather than re-run, so eviction cannot
		// reopen the replay hole.
		if (proposedId) {
			const prior = this.retained.get(proposedId);
			if (prior) {
				return {
					...prior.outcome,
					status: "duplicate",
					executed: false,
					duplicateOfPreviousRun: true,
					note: `runId ${proposedId} is already recorded; nothing was executed again. Original outcome: ${prior.outcome.note}`,
				};
			}
			const refused = this.baseOutcome(proposedId, text.length);
			refused.rejectionCode = "unknown_run_id";
			refused.note = `runId ${proposedId} is unknown or expired. The bridge executes only under ids it mints; omit runId to run new source.`;
			return refused;
		}

		const gate = this.unavailableReason();
		if (gate) {
			throw new BridgeError(gate.code, gate.message, false);
		}

		const outcome = this.baseOutcome("", text.length);
		if (opts.confirm !== true) {
			outcome.rejectionCode = "exec_not_confirmed";
			outcome.note = "Refused: pass confirm:true to execute. Nothing was sent to the client.";
			return this.remember(outcome, opts.sourceHash ?? "");
		}
		outcome.confirmed = true;

		if (text.length === 0) {
			outcome.rejectionCode = "exec_empty_source";
			outcome.note = "Refused: source is empty.";
			return this.remember(outcome, opts.sourceHash ?? "");
		}
		if (text.length > LIMITS.execMaxSourceChars) {
			outcome.rejectionCode = "exec_too_large";
			outcome.note = `Refused: source is ${text.length} chars; the limit is ${LIMITS.execMaxSourceChars}.`;
			return this.remember(outcome, opts.sourceHash ?? "");
		}
		if (this.inFlight >= LIMITS.execMaxQueue) {
			outcome.rejectionCode = "exec_queue_full";
			outcome.note = `Refused: ${this.inFlight} executions are already in flight; the limit is ${LIMITS.execMaxQueue}.`;
			return this.remember(outcome, opts.sourceHash ?? "");
		}

		const reader = this.bridge.reader;
		if (!reader) {
			// Nothing is queued for a later reconnect.
			outcome.rejectionCode = "exec_no_reader";
			outcome.note = "Refused: the reader disconnected before the run started. Nothing was queued or replayed.";
			outcome.unknownOutcome = false;
			return this.remember(outcome, opts.sourceHash ?? "");
		}

		// Run ids stay inside the reader's accepted pattern: [A-Za-z0-9._-], 1-64 chars.
		const runId = `${reader.connectionId}-${Date.now().toString(36)}-${++this.seq}`;
		outcome.runId = runId;
		outcome.reader = { session: reader.session, connectionId: reader.connectionId, placeId: reader.placeId, jobId: reader.jobId };

		const deadlineMs = Math.min(Math.max(opts.deadlineMs ?? LIMITS.execDefaultDeadlineMs, 1_000), LIMITS.execMaxDeadlineMs);
		this.sources.set(runId, {runId, sessionId: reader.session, connectionId: reader.connectionId, source: text,
			revision: createHash('sha256').update(text).digest('hex'), observedAt: outcome.sentAt});
		this.inFlight += 1;
		try {
			const raw = (await this.bridge.request("exec", { runId, source: text }, { deadlineMs })) as Record<string, unknown>;

			const duplicate = raw.duplicate === true;
			const compiled = raw.compiled === true;
			const ok = raw.ok === true;
			const returned = typeof raw.returns === "object" && raw.returns !== null ? raw.returns : [];
			outcome.executed = raw.executed === true && !duplicate;
			outcome.duplicateOfPreviousRun = duplicate;
			outcome.compiled = compiled;
			outcome.ok = ok;
			outcome.compileError = clampText(raw.compileError, 4_000);
			outcome.runtimeError = clampText(raw.runtimeError, 4_000);
			outcome.output = clampText(raw.output, LIMITS.execMaxOutputChars);
			outcome.outputTruncated = raw.outputTruncated === true;
			outcome.returns = Array.isArray(returned) ? returned.slice(0, LIMITS.execMaxReturns) : [];
			outcome.environment = clampText(typeof raw.environment === "string" ? raw.environment : null, 32);
			outcome.capture = clampText(typeof raw.capture === "string" ? raw.capture : null, 32);
			outcome.durationMs = typeof raw.durationMs === "number" ? raw.durationMs : null;
			outcome.completedAt = new Date().toISOString();

			if (duplicate) {
				outcome.status = "duplicate";
				outcome.note = "The reader had already executed this runId; it did not run the source again.";
			} else if (!compiled) {
				outcome.status = "compile_error";
				outcome.note = "The source failed to compile; nothing ran.";
			} else if (!ok) {
				outcome.status = "runtime_error";
				outcome.note = "The source compiled and ran, then raised an error.";
			} else {
				outcome.status = "completed";
				outcome.note = "The source ran in the client and returned normally.";
			}
			log.info(`exec ${runId} ${outcome.status} (${text.length} chars, ${outcome.durationMs ?? "?"} ms)`);
			return this.remember(outcome, opts.sourceHash ?? "");
		} catch (err) {
			outcome.completedAt = new Date().toISOString();
			if (err instanceof BridgeError && err.code === "deadline_exceeded") {
				outcome.status = "timeout";
				outcome.unknownOutcome = true;
				outcome.clientMayStillBeRunning = true;
				outcome.note =
					`No result within ${deadlineMs} ms. The outcome is UNKNOWN: the client may still be running this source. ` +
					"The bridge does not cancel client work and cannot confirm when it stops.";
			} else if (err instanceof BridgeError && (err.code === "disconnected" || err.code === "send_failed")) {
				outcome.status = "disconnected";
				outcome.unknownOutcome = true;
				outcome.clientMayStillBeRunning = true;
				outcome.note =
					"The reader disconnected during the run. The outcome is UNKNOWN: the client may have run it, and may still be running. " +
					"It will not be replayed automatically.";
			} else {
				outcome.status = "rejected";
				outcome.rejectionCode = err instanceof BridgeError ? (err.readerCode ?? err.code) : "exec_failed";
				outcome.note = err instanceof Error ? err.message : String(err);
			}
			return this.remember(outcome, opts.sourceHash ?? "");
		} finally {
			this.inFlight -= 1;
		}
	}
}
