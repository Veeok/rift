// Loopback WebSocket listener for the single Volt reader.
// Handshake: server sends hello{nonce} -> reader sends auth{token, nonce, reader} -> auth_ok | auth_fail.
// Nothing but auth is accepted before authentication. Only one authenticated reader is active.

import http from "node:http";
import type { IncomingMessage } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { BRIDGE_NAME, BRIDGE_VERSION, LIMITS, LISTEN_HOST, PROTOCOL_VERSION, WS_PATH } from "./limits.js";
import { log } from "./log.js";

export type BridgeErrorCode =
	| "not_connected"
	| "queue_full"
	| "deadline_exceeded"
	| "disconnected"
	| "send_failed"
	| "too_large"
	| "reader_error"
	| "exec_disabled"
	| "exec_unavailable"
	| "exec_not_confirmed"
	| "exec_rejected";

export class BridgeError extends Error {
	constructor(
		public readonly code: BridgeErrorCode,
		message: string,
		public readonly retryable = false,
		public readonly readerCode?: string,
	) {
		super(message);
	}
}

export interface ReaderInfo {
	session: string;
	generation: number;
	executor: { name: string; version: string };
	placeId: number;
	gameId: number;
	jobId: string;
	placeVersion: number;
	capabilities: string[];
	readerVersion: string;
	readerBuild: string;
}

interface ReaderConn {
	ws: WebSocket;
	connectionId: string;
	info: ReaderInfo;
	authenticatedAt: number;
	lastSeen: number;
}

interface Pending {
	connectionId: string;
	op: string;
	resolve: (value: unknown) => void;
	reject: (err: BridgeError) => void;
	timer: NodeJS.Timeout;
	chunks: string[];
	chunkChars: number;
	onLate?: (value: unknown) => void;
}

interface Late {
	onLate: (value: unknown) => void;
	expiresAt: number;
	chunks: string[];
	chunkChars: number;
}

export type ListenerState =
	| { state: "starting"; port: number }
	| { state: "listening"; port: number; since: string }
	| { state: "error"; port: number; code: string; message: string; retryInMs: number }
	| { state: "stopped"; port: number }
	| { state: "disabled"; port: number; reason: string };

export interface RequestOptions {
	deadlineMs?: number;
	// Receives a result that arrives after the caller's deadline (for caching only).
	onLate?: (value: unknown) => void;
}

type SessionListener = (session: string | null, previous: string | null) => void;

const SESSION_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

function clampStr(v: unknown, max: number): string {
	return typeof v === "string" ? v.slice(0, max) : "";
}
function num(v: unknown): number {
	return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function isLoopback(addr: string | undefined): boolean {
	return addr === "127.0.0.1" || addr === "::ffff:127.0.0.1" || addr === "::1";
}
function digest(s: string): Buffer {
	return createHash("sha256").update(s, "utf8").digest();
}

export class Bridge {
	private server: http.Server | null = null;
	private wss: WebSocketServer | null = null;
	private listener: ListenerState;
	private active: ReaderConn | null = null;
	private preAuth = new Set<WebSocket>();
	private pending = new Map<string, Pending>();
	private late = new Map<string, Late>();
	private seq = 0;
	private connSeq = 0;
	private heartbeat: NodeJS.Timeout | null = null;
	private retryTimer: NodeJS.Timeout | null = null;
	private stopped = false;
	private lastSession: string | null = null;
	private lastDisconnect: { at: string; reason: string } | null = null;
	private sessionListeners: SessionListener[] = [];
	private readonly tokenDigest: Buffer | null;
	private listeningSince: number | null = null;

	constructor(
		private readonly port: number,
		token: string | null,
		private readonly tokenError: string | null,
	) {
		this.tokenDigest = token ? digest(token) : null;
		this.listener = token
			? { state: "starting", port }
			: { state: "disabled", port, reason: tokenError ?? "no token" };
	}

	onSessionChange(fn: SessionListener): void {
		this.sessionListeners.push(fn);
	}

	start(): void {
		if (!this.tokenDigest) {
			log.error(`listener disabled: ${this.tokenError}`);
			return;
		}
		const server = http.createServer((_req, res) => {
			res.writeHead(426, { "Content-Type": "text/plain" });
			res.end("WebSocket upgrade required\n");
		});
		const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.maxMessageBytes, perMessageDeflate: false });
		server.on("upgrade", (req, socket, head) => {
			const path = (req.url ?? "").split("?")[0];
			if (path !== WS_PATH || !isLoopback(req.socket.remoteAddress)) {
				socket.destroy();
				return;
			}
			wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, req));
		});
		server.on("error", (err: NodeJS.ErrnoException) => this.onListenError(err));
		this.server = server;
		this.wss = wss;
		this.listen();
		this.heartbeat = setInterval(() => this.tick(), LIMITS.heartbeatIntervalMs);
		this.heartbeat.unref();
	}

	private listen(): void {
		if (!this.server || this.stopped) return;
		this.listener = { state: "starting", port: this.port };
		this.server.listen({ port: this.port, host: LISTEN_HOST, exclusive: true }, () => {
			this.listeningSince = Date.now();
			this.listener = { state: "listening", port: this.port, since: new Date().toISOString() };
			log.info(`listening on ws://${LISTEN_HOST}:${this.port}${WS_PATH}`);
		});
	}

	private onListenError(err: NodeJS.ErrnoException): void {
		if (this.stopped) return;
		if (this.listener.state === "listening") {
			log.error("listener error", err);
			return;
		}
		const code = err.code ?? "UNKNOWN";
		const message =
			code === "EADDRINUSE"
				? `port ${this.port} is already in use on ${LISTEN_HOST} (another volt-bridge instance or another app). ` +
					`Close it, or set VOLT_BRIDGE_PORT and re-run "npm run setup" to render a matching bootstrap.`
				: `cannot listen on ${LISTEN_HOST}:${this.port}: ${err.message}`;
		this.listener = { state: "error", port: this.port, code, message, retryInMs: LIMITS.listenRetryMs };
		log.error(message + ` Retrying in ${LIMITS.listenRetryMs / 1000}s.`);
		if (this.retryTimer) clearTimeout(this.retryTimer);
		this.retryTimer = setTimeout(() => this.listen(), LIMITS.listenRetryMs);
		this.retryTimer.unref();
	}

	private send(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
		return new Promise((resolve, reject) => {
			if (ws.readyState !== WebSocket.OPEN) {
				reject(new BridgeError("send_failed", "socket is not open", true));
				return;
			}
			ws.send(JSON.stringify({ v: PROTOCOL_VERSION, ...msg }), (err) =>
				err ? reject(new BridgeError("send_failed", err.message, true)) : resolve(),
			);
		});
	}

	private onConnection(ws: WebSocket, req: IncomingMessage): void {
		const origin = req.headers.origin;
		// Browsers always send Origin; refuse them so web pages cannot reach the reader slot.
		if (typeof origin === "string" && (origin === "null" || /^(https?|file|chrome-extension|moz-extension):/i.test(origin))) {
			log.warn("rejected connection with browser origin", origin);
			ws.close(1008, "browser origins are not accepted");
			return;
		}
		if (this.preAuth.size >= LIMITS.maxPreAuthConnections) {
			ws.close(1013, "too many unauthenticated connections");
			return;
		}
		this.preAuth.add(ws);
		const nonce = randomBytes(16).toString("hex");
		let conn: ReaderConn | null = null;
		let authenticating = false;
		let hiCount = 0;
		const sendHello = () =>
			this.send(ws, { type: "hello", nonce, server: { name: BRIDGE_NAME, version: BRIDGE_VERSION } }).catch(() => ws.terminate());

		const authTimer = setTimeout(() => {
			if (!conn) this.failAuth(ws, "auth_timeout", "no valid auth message within deadline", false);
		}, LIMITS.authTimeoutMs);

		ws.on("message", (data: RawData, isBinary: boolean) => {
			if (isBinary) {
				ws.close(1003, "binary frames are not supported");
				return;
			}
			const text = data.toString();
			let msg: Record<string, unknown>;
			try {
				const parsed: unknown = JSON.parse(text);
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
				msg = parsed as Record<string, unknown>;
			} catch {
				if (!conn) this.failAuth(ws, "bad_message", "malformed JSON", false);
				else log.warn("dropped malformed reader message");
				return;
			}
			if (conn) {
				this.onReaderMessage(conn, msg);
				return;
			}
			if (authenticating) return;
			if (msg.type === "hi") {
				// The reader asks for (another) hello: covers a hello sent before its handlers were attached.
				if (++hiCount <= 5) sendHello();
				else this.failAuth(ws, "auth_required", "too many hello requests", false);
				return;
			}
			if (msg.type !== "auth") {
				this.failAuth(ws, "auth_required", "authenticate before sending commands", false);
				return;
			}
			authenticating = true;
			clearTimeout(authTimer);
			void this.authenticate(ws, nonce, msg).then((accepted) => {
				conn = accepted;
				authenticating = false;
			});
		});

		ws.on("close", (code, reason) => {
			clearTimeout(authTimer);
			this.preAuth.delete(ws);
			// Match by socket: the close can land while authenticate() is still awaiting auth_ok.
			const current = this.active;
			if (current && current.ws === ws) {
				this.clearActive(current, `reader closed (${code}${reason.length ? " " + reason.toString() : ""})`);
			}
		});
		ws.on("error", (err) => log.warn("reader socket error", err));

		sendHello();
	}

	private failAuth(ws: WebSocket, code: string, message: string, fatal: boolean): void {
		log.warn(`auth failed: ${code}: ${message}`);
		this.preAuth.delete(ws);
		this.send(ws, { type: "auth_fail", code, message, fatal })
			.catch(() => undefined)
			.finally(() => {
				ws.close(fatal ? 4001 : 4000, code);
				setTimeout(() => ws.terminate(), 1000).unref();
			});
	}

	private async authenticate(ws: WebSocket, nonce: string, msg: Record<string, unknown>): Promise<ReaderConn | null> {
		if (msg.v !== PROTOCOL_VERSION) {
			this.failAuth(ws, "protocol_mismatch", `bridge speaks protocol ${PROTOCOL_VERSION}, reader sent ${String(msg.v)}`, true);
			return null;
		}
		const token = typeof msg.token === "string" ? msg.token : "";
		if (!this.tokenDigest || !timingSafeEqual(digest(token), this.tokenDigest)) {
			this.failAuth(ws, "bad_token", "token rejected; re-render the bootstrap with npm run setup", true);
			return null;
		}
		if (msg.nonce !== nonce) {
			this.failAuth(ws, "bad_nonce", "nonce mismatch", false);
			return null;
		}
		const r = (msg.reader && typeof msg.reader === "object" ? msg.reader : {}) as Record<string, unknown>;
		const exec = (r.executor && typeof r.executor === "object" ? r.executor : {}) as Record<string, unknown>;
		const session = clampStr(r.session, 64);
		if (!SESSION_PATTERN.test(session)) {
			this.failAuth(ws, "bad_reader", "reader session id missing or malformed", true);
			return null;
		}
		const info: ReaderInfo = {
			session,
			generation: num(r.generation),
			executor: { name: clampStr(exec.name, 64), version: clampStr(exec.version, 64) },
			placeId: num(r.placeId),
			gameId: num(r.gameId),
			jobId: clampStr(r.jobId, 64),
			placeVersion: num(r.placeVersion),
			capabilities: Array.isArray(r.capabilities)
				? r.capabilities.filter((c): c is string => typeof c === "string").slice(0, 64).map((c) => c.slice(0, 64))
				: [],
			readerVersion: clampStr(r.readerVersion, 32),
			readerBuild: clampStr(r.readerBuild, 32),
		};

		while (this.active && this.active.ws !== ws) {
			const current = this.active;
			if (current.info.session === info.session) {
				// Volt reconnected the same reader before we noticed the old transport died.
				this.dropActive(current, "replaced by reconnect of the same reader session", 4005);
			} else {
				const alive = await this.probeAlive(current);
				// Another handshake may have won while this probe yielded. Never overwrite it.
				if (this.active !== current) continue;
				if (alive) {
					this.failAuth(ws, "reader_busy", "another reader is active; close it (re-run its bootstrap or leave the game) first", true);
					return null;
				}
				this.dropActive(current, "unresponsive reader replaced", 4006);
			}
		}
		if (ws.readyState !== WebSocket.OPEN) return null;

		const conn: ReaderConn = {
			ws,
			connectionId: `c${++this.connSeq}`,
			info,
			authenticatedAt: Date.now(),
			lastSeen: Date.now(),
		};
		this.preAuth.delete(ws);
		this.active = conn;
		try {
			await this.send(ws, {
				type: "auth_ok",
				connectionId: conn.connectionId,
				session: info.session,
				heartbeatMs: LIMITS.heartbeatIntervalMs,
			});
		} catch {
			this.clearActive(conn, "auth_ok send failed");
			return null;
		}
		log.info(
			`reader authenticated: ${conn.connectionId} session=${info.session} place=${info.placeId} executor=${info.executor.name} ${info.executor.version}`,
		);
		if (this.lastSession !== info.session) {
			const previous = this.lastSession;
			this.lastSession = info.session;
			for (const fn of this.sessionListeners) fn(info.session, previous);
		}
		return conn;
	}

	private async probeAlive(conn: ReaderConn): Promise<boolean> {
		const t0 = Date.now();
		await this.send(conn.ws, { type: "ping", t: t0 }).catch(() => undefined);
		await new Promise((r) => setTimeout(r, LIMITS.takeoverProbeMs));
		return this.active === conn && conn.lastSeen >= t0;
	}

	private dropActive(conn: ReaderConn, reason: string, code: number): void {
		this.send(conn.ws, { type: "bye", reason }).catch(() => undefined);
		conn.ws.close(code, reason.slice(0, 100));
		setTimeout(() => conn.ws.terminate(), 1000).unref();
		this.clearActive(conn, reason);
	}

	private clearActive(conn: ReaderConn, reason: string): void {
		if (this.active !== conn) return;
		this.active = null;
		this.lastDisconnect = { at: new Date().toISOString(), reason };
		log.info(`reader ${conn.connectionId} inactive: ${reason}`);
		for (const [id, p] of this.pending) {
			if (p.connectionId !== conn.connectionId) continue;
			clearTimeout(p.timer);
			this.pending.delete(id);
			p.reject(new BridgeError("disconnected", `reader disconnected during ${p.op}: ${reason}`, true));
		}
	}

	private onReaderMessage(conn: ReaderConn, msg: Record<string, unknown>): void {
		if (conn !== this.active || msg.v !== PROTOCOL_VERSION) return;
		conn.lastSeen = Date.now();
		switch (msg.type) {
			case "pong":
				return;
			case "ping":
				this.send(conn.ws, { type: "pong", t: msg.t }).catch(() => undefined);
				return;
			case "log":
				log.info(`reader: ${clampStr(msg.level, 8)} ${clampStr(msg.message, 500)}`);
				return;
			case "chunk":
				this.onChunk(msg);
				return;
			case "res":
				this.onResponse(msg);
				return;
			default:
				log.debug("ignored reader message type", msg.type);
		}
	}

	private onChunk(msg: Record<string, unknown>): void {
		const id = typeof msg.id === "string" ? msg.id : "";
		const data = typeof msg.data === "string" ? msg.data : "";
		const active = this.pending.get(id);
		// Execution results are returned whole; a chunked exec response is a protocol error.
		if (active && active.op === "exec") {
			clearTimeout(active.timer);
			this.pending.delete(id);
			active.reject(new BridgeError("reader_error", "unexpected chunked response for exec", false, "unexpected_chunk"));
			return;
		}
		const target = active ?? this.late.get(id);
		if (!target) return;
		if (target.chunks.length >= LIMITS.maxResultChunks) {
			const p = this.pending.get(id);
			this.late.delete(id);
			if (p) {
				clearTimeout(p.timer);
				this.pending.delete(id);
				p.reject(new BridgeError("too_large", `result exceeds ${LIMITS.maxResultChunks} chunks`));
			}
			return;
		}
		target.chunkChars += data.length;
		if (target.chunkChars > LIMITS.maxChunkedResultChars) {
			const p = this.pending.get(id);
			this.late.delete(id);
			if (p) {
				clearTimeout(p.timer);
				this.pending.delete(id);
				p.reject(new BridgeError("too_large", `result exceeds ${LIMITS.maxChunkedResultChars} chars`));
			}
			return;
		}
		target.chunks.push(data);
	}

	private assemble(msg: Record<string, unknown>, chunks: string[]): unknown {
		const result = msg.result;
		const field = typeof msg.chunkField === "string" ? msg.chunkField : null;
		if (field && result && typeof result === "object" && !Array.isArray(result)) {
			return { ...(result as Record<string, unknown>), [field]: chunks.join("") };
		}
		return result;
	}

	private onResponse(msg: Record<string, unknown>): void {
		const id = typeof msg.id === "string" ? msg.id : "";
		const p = this.pending.get(id);
		if (p) {
			clearTimeout(p.timer);
			this.pending.delete(id);
			if (msg.ok === true) {
				p.resolve(this.assemble(msg, p.chunks));
			} else {
				const e = (msg.error && typeof msg.error === "object" ? msg.error : {}) as Record<string, unknown>;
				p.reject(new BridgeError("reader_error", clampStr(e.message, 2000) || "reader error", false, clampStr(e.code, 64) || "error"));
			}
			return;
		}
		const late = this.late.get(id);
		if (late) {
			this.late.delete(id);
			if (msg.ok === true) {
				try {
					late.onLate(this.assemble(msg, late.chunks));
				} catch (err) {
					log.warn("late result handler failed", err);
				}
			}
		}
	}

	request(op: string, args: Record<string, unknown>, opts: RequestOptions = {}): Promise<unknown> {
		const conn = this.active;
		if (!conn) {
			return Promise.reject(
				new BridgeError("not_connected", "no authenticated Volt reader; run the bootstrap in Volt (see tools/volt-bridge/README.md)", true),
			);
		}
		if (this.pending.size >= LIMITS.maxPendingRequests) {
			return Promise.reject(new BridgeError("queue_full", `bridge has ${this.pending.size} requests in flight`, true));
		}
		const deadlineMs = opts.deadlineMs ?? LIMITS.defaultDeadlineMs;
		const id = `${conn.connectionId}.${++this.seq}`;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				const p = this.pending.get(id);
				this.pending.delete(id);
				if (opts.onLate) {
					this.late.set(id, {
						onLate: opts.onLate,
						expiresAt: Date.now() + LIMITS.lateResultRetentionMs,
						chunks: p?.chunks ?? [],
						chunkChars: p?.chunkChars ?? 0,
					});
				}
				reject(new BridgeError("deadline_exceeded", `${op} did not finish within ${deadlineMs} ms`, true));
			}, deadlineMs);
			this.pending.set(id, { connectionId: conn.connectionId, op, resolve, reject, timer, chunks: [], chunkChars: 0, onLate: opts.onLate });
			this.send(conn.ws, { type: "req", id, op, args, deadlineMs }).catch((err: BridgeError) => {
				clearTimeout(timer);
				this.pending.delete(id);
				reject(err);
			});
		});
	}

	private tick(): void {
		const now = Date.now();
		for (const [id, l] of this.late) if (l.expiresAt < now) this.late.delete(id);
		const conn = this.active;
		if (!conn) return;
		if (now - conn.lastSeen > LIMITS.heartbeatTimeoutMs) {
			this.dropActive(conn, "heartbeat timeout", 4004);
			return;
		}
		this.send(conn.ws, { type: "ping", t: now }).catch(() => undefined);
	}

	get session(): string | null {
		return this.active?.info.session ?? null;
	}

	/** Milliseconds since the listener started listening, or null if it is not listening. */
	listeningForMs(): number | null {
		return this.listener.state === "listening" && this.listeningSince !== null ? Date.now() - this.listeningSince : null;
	}

	/** Resolve once a reader is authenticated or the wait elapses. Returns the time waited. */
	async waitForReader(maxMs: number): Promise<number> {
		const t0 = Date.now();
		while (!this.active && Date.now() - t0 < maxMs && !this.stopped) {
			await new Promise((r) => setTimeout(r, 250));
		}
		return Date.now() - t0;
	}

	get reader(): (ReaderInfo & { connectionId: string }) | null {
		return this.active ? { ...this.active.info, connectionId: this.active.connectionId } : null;
	}

	status(): Record<string, unknown> {
		const a = this.active;
		return {
			bridge: { name: BRIDGE_NAME, version: BRIDGE_VERSION, protocolVersion: PROTOCOL_VERSION },
			listener: { ...this.listener, host: LISTEN_HOST, path: WS_PATH },
			connected: a !== null,
			reader: a
				? {
						connectionId: a.connectionId,
						session: a.info.session,
						generation: a.info.generation,
						readerVersion: a.info.readerVersion,
						readerBuild: a.info.readerBuild,
						executor: a.info.executor,
						place: { placeId: a.info.placeId, gameId: a.info.gameId, jobId: a.info.jobId, placeVersion: a.info.placeVersion },
						capabilities: a.info.capabilities,
						authenticatedAt: new Date(a.authenticatedAt).toISOString(),
						lastSeenMsAgo: Date.now() - a.lastSeen,
					}
				: null,
			lastDisconnect: this.lastDisconnect,
			pendingRequests: this.pending.size,
		};
	}

	async stop(reason = "bridge shutting down"): Promise<void> {
		if (this.stopped) return;
		this.stopped = true;
		if (this.heartbeat) clearInterval(this.heartbeat);
		if (this.retryTimer) clearTimeout(this.retryTimer);
		const conn = this.active;
		if (conn) {
			// "bye" tells the reader this is a deliberate shutdown, not a transient drop.
			await this.send(conn.ws, { type: "bye", reason }).catch(() => undefined);
			this.clearActive(conn, reason);
		}
		for (const ws of this.wss?.clients ?? []) ws.close(1001, "shutdown");
		for (const ws of this.preAuth) ws.terminate();
		this.listener = { state: "stopped", port: this.port };
		await new Promise<void>((resolve) => {
			this.wss?.close();
			if (!this.server?.listening) return resolve();
			this.server.close(() => resolve());
			this.server.closeAllConnections();
		});
	}
}
