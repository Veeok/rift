// Decompile jobs and the per-session source cache.
// Cache key = reader session | script object id | bytecode hash (or "nohash") | decompiler options.
// A caller's wait expiring never cancels Volt's native decompiler; the job only stops waiting.

import { randomBytes } from "node:crypto";
import { Bridge, BridgeError } from "./bridge.js";
import { LIMITS } from "./limits.js";
import { log } from "./log.js";

export type DecompileOptions = Record<string, boolean | number>;

export interface ScriptInfo {
	object: { id: string; name: string; className: string; path: string };
	hash: string | null;
	decompileSupport: "supported" | "unsupported" | "unknown";
	reason?: string;
	observedAt?: string;
}

export interface CacheEntry {
	key: string;
	session: string;
	lines: string[];
	chars: number;
	hash: string | null;
	lossy: boolean;
	truncated: boolean;
	script: ScriptInfo["object"];
	observedAt: string;
	storedAt: number;
	elapsedMs: number | null;
}

export type JobStatus = "queued" | "running" | "done" | "failed" | "wait_expired";

export interface Job {
	id: string;
	key: string;
	session: string;
	status: JobStatus;
	createdAt: number;
	finishedAt: number | null;
	error: { code: string; message: string; retryable?: boolean } | null;
	script: ScriptInfo["object"];
	hash: string | null;
	done: Promise<void>;
}

export function optionsKey(options: DecompileOptions | undefined): string {
	if (!options || Object.keys(options).length === 0) return "volt-defaults";
	return JSON.stringify(Object.keys(options).sort().map((k) => [k, options[k]]));
}

export function cacheKey(session: string, info: ScriptInfo, options: DecompileOptions | undefined): string {
	return `${session}|${info.object.id}|${info.hash ?? "nohash"}|${optionsKey(options)}`;
}

export class DecompileService {
	private cache = new Map<string, CacheEntry>();
	private cacheChars = 0;
	private jobs = new Map<string, Job>();
	private running = 0;
	private waiting: (() => void)[] = [];

	constructor(private readonly bridge: Bridge) {
		bridge.onSessionChange((session) => this.resetFor(session));
	}

	private resetFor(session: string | null): void {
		for (const [key, entry] of this.cache) if (entry.session !== session) this.evict(key);
		for (const job of this.jobs.values()) {
			if (job.session !== session && (job.status === "queued" || job.status === "running")) {
				job.status = "failed";
				job.error = { code: "session_changed", message: "reader session changed; object ids from the old session are invalid" };
				job.finishedAt = Date.now();
			}
		}
	}

	private evict(key: string): void {
		const e = this.cache.get(key);
		if (!e) return;
		this.cache.delete(key);
		this.cacheChars -= e.chars;
	}

	private store(entry: CacheEntry): void {
		this.evict(entry.key);
		this.cache.set(entry.key, entry);
		this.cacheChars += entry.chars;
		for (const key of this.cache.keys()) {
			if (this.cache.size <= LIMITS.cacheMaxEntries && this.cacheChars <= LIMITS.cacheMaxChars) break;
			if (key !== entry.key) this.evict(key);
		}
	}

	lookup(key: string): CacheEntry | null {
		const e = this.cache.get(key);
		if (!e) return null;
		if (e.hash === null && Date.now() - e.storedAt > LIMITS.noHashCacheTtlMs) {
			// Without a bytecode hash we cannot detect changes; expire quickly.
			this.evict(key);
			return null;
		}
		// LRU touch
		this.cache.delete(key);
		this.cache.set(key, e);
		return e;
	}

	getJob(id: string): Job | null {
		this.pruneJobs();
		return this.jobs.get(id) ?? null;
	}

	private pruneJobs(): void {
		const now = Date.now();
		for (const [id, job] of this.jobs) {
			if (job.finishedAt !== null && now - job.finishedAt > LIMITS.jobRetentionMs) this.jobs.delete(id);
		}
	}

	private activeJobCount(): number {
		let n = 0;
		for (const job of this.jobs.values()) if (job.status === "queued" || job.status === "running") n++;
		return n;
	}

	start(session: string, info: ScriptInfo, options: DecompileOptions | undefined): Job {
		this.pruneJobs();
		const key = cacheKey(session, info, options);
		for (const job of this.jobs.values()) {
			if (job.key === key && (job.status === "queued" || job.status === "running")) return job;
		}
		if (this.activeJobCount() >= LIMITS.maxDecompileJobs) {
			throw new BridgeError("queue_full", `${LIMITS.maxDecompileJobs} decompile jobs already queued or running; poll them first`, true);
		}
		const job: Job = {
			id: "dj_" + randomBytes(6).toString("hex"),
			key,
			session,
			status: "queued",
			createdAt: Date.now(),
			finishedAt: null,
			error: null,
			script: info.object,
			hash: info.hash,
			done: Promise.resolve(),
		};
		job.done = this.run(job, info, options);
		this.jobs.set(job.id, job);
		return job;
	}

	private async acquire(): Promise<void> {
		if (this.running < LIMITS.maxConcurrentDecompiles) {
			this.running++;
			return;
		}
		await new Promise<void>((resolve) => this.waiting.push(resolve));
		this.running++;
	}

	private release(): void {
		this.running--;
		this.waiting.shift()?.();
	}

	private toEntry(job: Job, info: ScriptInfo, raw: unknown): CacheEntry {
		const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
		if (typeof r.hash === "string" && r.hash !== info.hash) {
			throw new BridgeError("reader_error", "bytecode changed during decompilation; request the script again", true, "bytecode_changed");
		}
		const source = typeof r.source === "string" ? r.source : "";
		return {
			key: job.key,
			session: job.session,
			lines: source.split(/\r?\n/),
			chars: source.length,
			// Prefer the hash observed at decompile time; it may differ from script_info if bytecode changed.
			hash: typeof r.hash === "string" ? r.hash : (info.hash ?? null),
			lossy: r.lossy === true,
			truncated: r.truncated === true,
			script: info.object,
			observedAt: typeof r.observedAt === "string" ? r.observedAt : new Date().toISOString(),
			storedAt: Date.now(),
			elapsedMs: typeof r.elapsedMs === "number" ? r.elapsedMs : null,
		};
	}

	private async run(job: Job, info: ScriptInfo, options: DecompileOptions | undefined): Promise<void> {
		await this.acquire();
		try {
			if (job.status !== "queued") return; // invalidated while queued
			job.status = "running";
			const raw = await this.bridge.request(
				"decompile",
				{ target: { id: info.object.id }, options: options ?? {} },
				{
					deadlineMs: LIMITS.decompileDeadlineMs,
					onLate: (late) => {
						if (this.bridge.session !== job.session) return;
						this.store(this.toEntry(job, info, late));
						log.info(`late decompile result cached for ${info.object.path}`);
					},
				},
			);
			if (this.bridge.session !== job.session) throw new BridgeError("disconnected", "reader session changed during decompile", true);
			this.store(this.toEntry(job, info, raw));
			job.status = "done";
		} catch (err) {
			const e = err instanceof BridgeError ? err : new BridgeError("reader_error", String(err));
			if (e.code === "deadline_exceeded") {
				job.status = "wait_expired";
				job.error = {
					code: "wait_expired",
					message:
						`Stopped waiting after ${LIMITS.decompileDeadlineMs / 1000}s. This does not cancel Volt's native decompiler, ` +
						`which may still be running and occupying the reader's decompile slot. If it finishes within ` +
						`${LIMITS.lateResultRetentionMs / 60000} min the result is cached; call read_script again without jobId.`,
				};
			} else {
				job.status = "failed";
				job.error = { code: e.readerCode ?? e.code, message: e.message, retryable: e.retryable };
			}
		} finally {
			job.finishedAt ??= Date.now();
			this.release();
		}
	}
}

export interface SourcePage {
	startLine: number;
	endLine: number;
	totalLines: number;
	nextStartLine: number | null;
	truncatedByCharLimit: boolean;
	longLineTruncated: boolean;
	text: string;
}

export function pageSource(entry: CacheEntry, startLine: number, maxLines: number, maxChars: number): SourcePage {
	const total = entry.lines.length;
	const start = Math.min(Math.max(1, startLine), Math.max(1, total));
	const out: string[] = [];
	let chars = 0;
	let line = start;
	let truncatedByCharLimit = false;
	let longLineTruncated = false;
	while (line <= total && out.length < maxLines) {
		const text = entry.lines[line - 1] ?? "";
		if (chars + text.length + 1 > maxChars) {
			if (out.length === 0) {
				out.push(text.slice(0, maxChars) + " --[[volt-bridge: line truncated]]");
				longLineTruncated = true;
				line++;
			}
			truncatedByCharLimit = true;
			break;
		}
		out.push(text);
		chars += text.length + 1;
		line++;
	}
	return {
		startLine: start,
		endLine: line - 1,
		totalLines: total,
		nextStartLine: line <= total ? line : null,
		truncatedByCharLimit,
		longLineTruncated,
		text: out.join("\n"),
	};
}
