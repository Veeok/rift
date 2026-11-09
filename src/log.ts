// All diagnostics go to stderr. stdout carries MCP JSON-RPC only.

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: number = ORDER.info;

export function setLogLevel(level: string | undefined): void {
	if (level && level in ORDER) threshold = ORDER[level as Level];
}

function write(level: Level, message: string, extra?: unknown): void {
	if (ORDER[level] < threshold) return;
	let line = `[volt-bridge ${new Date().toISOString()} ${level}] ${message}`;
	if (extra !== undefined) {
		try {
			line += " " + (extra instanceof Error ? extra.message : JSON.stringify(extra));
		} catch {
			line += " [unserializable]";
		}
	}
	process.stderr.write(line + "\n");
}

export const log = {
	debug: (m: string, e?: unknown) => write("debug", m, e),
	info: (m: string, e?: unknown) => write("info", m, e),
	warn: (m: string, e?: unknown) => write("warn", m, e),
	error: (m: string, e?: unknown) => write("error", m, e),
};

// Guard against any dependency or stray call printing to stdout and corrupting MCP framing.
export function redirectConsoleToStderr(): void {
	const toErr = (...args: unknown[]) => process.stderr.write(args.map(String).join(" ") + "\n");
	console.log = toErr;
	console.info = toErr;
	console.debug = toErr;
}
