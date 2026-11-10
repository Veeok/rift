// npm run setup [-- --rotate] [-- --port 38917] [-- --out <file>]
// Compatibility reader-only setup for Rift: reuses the local token and renders the Volt reader.
// This is a CLI, not the MCP server, so printing to stdout is fine here.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PACKAGE_ROOT, DEFAULT_ENV_FILE, TOKEN_PATTERN, parsePort, resolveTokenFile, loadEnvironment, saveLocalToken } from "./config.js";
import { LISTEN_HOST, WS_PATH } from "./limits.js";

function argValue(name: string): string | undefined {
	const i = process.argv.indexOf(name);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

const rotate = process.argv.includes("--rotate");
const env = loadEnvironment();
const port = parsePort(argValue("--port") ?? env.VOLT_BRIDGE_PORT);
const tokenFile = resolveTokenFile(env.VOLT_BRIDGE_TOKEN_FILE);

let token: string | null = null;
if (!rotate && env.VOLT_BRIDGE_TOKEN !== undefined) {
	if (!TOKEN_PATTERN.test(env.VOLT_BRIDGE_TOKEN)) throw new Error("invalid VOLT_BRIDGE_TOKEN; correct the local .env or explicitly rotate");
	token = env.VOLT_BRIDGE_TOKEN;
}
if (!rotate && token === null && existsSync(tokenFile)) {
	const existing = readFileSync(tokenFile, "utf8").trim();
	if (TOKEN_PATTERN.test(existing)) token = existing;
}
const created = token === null;
if (token === null) {
	token = randomBytes(32).toString("base64url");
	mkdirSync(dirname(tokenFile), { recursive: true });
	writeFileSync(tokenFile, token + "\n", { encoding: "utf8", mode: 0o600 });
}
if (!env.VOLT_BRIDGE_TOKEN_FILE) saveLocalToken(DEFAULT_ENV_FILE, token, port);

const template = readFileSync(join(PACKAGE_ROOT, "luau", "bootstrap.template.luau"), "utf8");
const url = `ws://${LISTEN_HOST}:${port}${WS_PATH}`;
// Build id = sha256 prefix of the template, so a running reader proves which code it is.
const build = createHash("sha256").update(template, "utf8").digest("hex").slice(0, 12);
const rendered = template.replace("__VOLT_BRIDGE_URL__", url).replace("__VOLT_BRIDGE_TOKEN__", token).replace("__VOLT_BRIDGE_BUILD__", build);
if (/__VOLT_BRIDGE_(URL|TOKEN|BUILD)__/.test(rendered)) throw new Error("bootstrap template placeholders were not all replaced");

const outArg = argValue("--out");
const outFile = outArg ? resolve(outArg) : join(PACKAGE_ROOT, ".secrets", "rift-bootstrap.local.luau");
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, rendered, { encoding: "utf8", mode: 0o600 });

console.log(`token:     ${created ? (rotate ? "rotated" : "created") : "reused"} (${tokenFile})`);
console.log(`bootstrap: ${outFile}`);
console.log(`url:       ${url}`);
console.log(`build:     ${build}`);
if (port !== 38917) console.log(`note:      set VOLT_BRIDGE_PORT=${port} in the OpenCode MCP environment so the bridge listens on the same port.`);
if (created && rotate) console.log("note:      the old bootstrap no longer authenticates; paste the new one into Volt.");
