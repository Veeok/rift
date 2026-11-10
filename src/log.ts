// All diagnostics go to stderr. stdout carries MCP JSON-RPC only.
import { makeRedactor } from './redact.js';

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: number = ORDER.info;
const secrets = new Set<string>();
let redact = makeRedactor();
export function addLogSecrets(values: readonly string[]): void {
	for (const value of values) if(value.length>=8)secrets.add(value);
	redact=makeRedactor([...secrets]);
}

export function setLogLevel(level: string | undefined): void {
	if (level && level in ORDER) threshold = ORDER[level as Level];
}

function write(level: Level, message: string, extra?: unknown): void {
	if (ORDER[level] < threshold) return;
	let line = `[Rift ${new Date().toISOString()} ${level}] ${message}`;
	if (extra !== undefined) {
		try {
			line += " " + (extra instanceof Error ? extra.message : JSON.stringify(extra));
		} catch {
			line += " [unserializable]";
		}
	}
	process.stderr.write(redact(line).slice(0,4000) + "\n");
}

export const log = {
	debug: (m: string, e?: unknown) => write("debug", m, e),
	info: (m: string, e?: unknown) => write("info", m, e),
	warn: (m: string, e?: unknown) => write("warn", m, e),
	error: (m: string, e?: unknown) => write("error", m, e),
};

// Guard against any dependency or stray call printing to stdout and corrupting MCP framing.
export function redirectConsoleToStderr(): void {
	const toErr = (...args: unknown[]) => process.stderr.write(redact(args.map(String).join(" ")).slice(0,4000) + "\n");
	console.log = toErr;
	console.info = toErr;
	console.debug = toErr;
}
