export const BRIDGE_NAME = "Rift";
export const BRIDGE_VERSION = "0.3.0";
export const PROTOCOL_VERSION = 1;
export const LISTEN_HOST = "127.0.0.1"; // Never configurable: loopback only.
export const WS_PATH = "/volt";
export const DEFAULT_PORT = 38917;

export const LIMITS = {
	// Transport
	maxMessageBytes: 4 * 1024 * 1024,
	maxPreAuthConnections: 2,
	authTimeoutMs: 5_000,
	heartbeatIntervalMs: 10_000,
	heartbeatTimeoutMs: 30_000,
	takeoverProbeMs: 3_000,
	listenRetryMs: 15_000,

	// Requests
	maxPendingRequests: 16,
	defaultDeadlineMs: 15_000,
	searchDeadlineMs: 25_000,
	maxChunkedResultChars: 16 * 1024 * 1024,
	maxResultChunks: 4096,
	lateResultRetentionMs: 10 * 60_000,

	// Decompile jobs and cache
	decompileDeadlineMs: 240_000,
	maxDecompileJobs: 8,
	maxConcurrentDecompiles: 2,
	jobRetentionMs: 15 * 60_000,
	noHashCacheTtlMs: 5 * 60_000,
	cacheMaxEntries: 200,
	cacheMaxChars: 64 * 1024 * 1024,

	// A reader reconnects up to ~20 s after the bridge (re)starts (10 s handshake grace + connect backoff).
	startupReaderWindowMs: 60_000,
	startupReaderWaitMs: 25_000,
	maxReaderWaitMs: 30_000,

	// MCP responses
	maxToolResponseChars: 120_000,
	readScriptDefaultLines: 400,
	readScriptMaxLines: 2_000,
	readScriptMaxChars: 60_000,
	readScriptDefaultWaitMs: 10_000,
	readScriptMaxWaitMs: 25_000,

	// Client execution (opt-in; client-side only, no server authority)
	execMaxSourceChars: 100_000,
	execMaxOutputChars: 60_000,
	execMaxReturns: 20,
	execMaxRetainedResults: 32,
	execMaxQueue: 4,
	execDefaultDeadlineMs: 20_000,
	execMaxDeadlineMs: 60_000,
} as const;
