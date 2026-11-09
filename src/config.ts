import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT } from "./limits.js";

// dist/*.js -> package root
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_TOKEN_FILE = join(PACKAGE_ROOT, ".secrets", "token");
export const DEFAULT_ENV_FILE = join(PACKAGE_ROOT, ".env");

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

export interface BridgeConfig {
	port: number;
	tokenFile: string;
	token: string | null;
	tokenError: string | null;
	logLevel: string | undefined;
}

export function parsePort(raw: string | undefined): number {
	if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 1024 || port > 65535) {
		throw new Error(`VOLT_BRIDGE_PORT must be an integer 1024-65535, got "${raw}"`);
	}
	return port;
}

export function resolveTokenFile(raw: string | undefined): string {
	if (!raw) return DEFAULT_TOKEN_FILE;
	return isAbsolute(raw) ? raw : resolve(PACKAGE_ROOT, raw);
}

export function loadEnvironment(env: NodeJS.ProcessEnv = process.env, envFile = DEFAULT_ENV_FILE): NodeJS.ProcessEnv {
	let local: NodeJS.ProcessEnv = {};
	try { local = parseEnv(readFileSync(envFile, "utf8")); }
	catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
	// Explicit legacy token-file requests (including isolated tests) must not use a different .env token.
	if (env.VOLT_BRIDGE_TOKEN_FILE && !env.VOLT_BRIDGE_TOKEN) delete local.VOLT_BRIDGE_TOKEN;
	return { ...local, ...env };
}

export function saveLocalToken(envFile: string, token: string, port: number): void {
	if (!TOKEN_PATTERN.test(token)) throw new Error("invalid local token");
	let text = "";
	try { text = readFileSync(envFile, "utf8"); }
	catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
	const remaining = text.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?VOLT_BRIDGE_(?:TOKEN|PORT)\s*=/.test(line));
	writeFileSync(envFile, remaining.join("\n").trimEnd() + `\nVOLT_BRIDGE_TOKEN=${token}\nVOLT_BRIDGE_PORT=${port}\n`, {encoding:"utf8",mode:0o600});
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, envFile = DEFAULT_ENV_FILE): BridgeConfig {
	env = loadEnvironment(env, envFile);
	const port = parsePort(env.VOLT_BRIDGE_PORT);
	const tokenFile = resolveTokenFile(env.VOLT_BRIDGE_TOKEN_FILE);
	let token: string | null = null;
	let tokenError: string | null = null;
	if (env.VOLT_BRIDGE_TOKEN !== undefined) {
		const raw = env.VOLT_BRIDGE_TOKEN.trim();
		if (TOKEN_PATTERN.test(raw)) token = raw;
		else tokenError = "VOLT_BRIDGE_TOKEN is invalid; expected 32-256 base64url characters";
		return { port, tokenFile, token, tokenError, logLevel: env.VOLT_BRIDGE_LOG_LEVEL };
	}
	try {
		const raw = readFileSync(tokenFile, "utf8").trim();
		if (TOKEN_PATTERN.test(raw)) token = raw;
		else tokenError = `token file ${tokenFile} does not contain a valid token (32-256 chars of [A-Za-z0-9_-])`;
	} catch {
		tokenError = `token file ${tokenFile} not found; run "npm run setup" in tools/volt-bridge`;
	}
	return { port, tokenFile, token, tokenError, logLevel: env.VOLT_BRIDGE_LOG_LEVEL };
}
