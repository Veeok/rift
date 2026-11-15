import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export type Preferences = { schemaVersion: 1; preload: boolean; memory: boolean; virtual: boolean; unlocker: boolean };
export type Support = 'supported' | 'unsupported' | 'unverified';
export type AdmissionReason = 'policy_off' | 'supported_ready' | 'backend_unverified' | 'workload_unsupported' | 'unprotected_override_approved' | null;
export type Admission = { mode: 'off' | 'protected' | 'refused' | 'unprotected_override'; reason: AdmissionReason };
export type ProtectionError = { code: 'invalid_preferences' | 'too_large' | 'read_failed' | 'write_failed'; message: string; retryable: boolean };

export const protectionPreferencesSchema = z.strictObject({ schemaVersion: z.literal(1), preload: z.boolean(), memory: z.boolean(), virtual: z.boolean(), unlocker: z.boolean() });
const schema = protectionPreferencesSchema;
const defaults = (): Preferences => ({ schemaVersion: 1, preload: false, memory: false, virtual: false, unlocker: false });
const error = (code: ProtectionError['code'], message: string, retryable = false): ProtectionError => ({ code, message, retryable });
const locks = new Map<string, Promise<void>>();
let sequence = 0;

export async function loadProtectionPreferences(filePath: string): Promise<{ preferences: Preferences; error: ProtectionError | null }> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(filePath, 'r');
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return { preferences: defaults(), error: null };
    return { preferences: defaults(), error: error('read_failed', 'Unable to read preferences', true) };
  }
  let data: Buffer;
  try {
    data = Buffer.alloc(1025);
    let length = 0;
    while (length < data.length) {
      const { bytesRead } = await handle.read(data, length, data.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    data = data.subarray(0, length);
    await handle.close();
  } catch {
    try { await handle.close(); } catch { /* preserve original failure */ }
    return { preferences: defaults(), error: error('read_failed', 'Unable to read preferences', true) };
  }
  if (data.length > 1024) return { preferences: defaults(), error: error('too_large', 'Preferences exceed 1024 bytes') };
  try {
    const parsed = schema.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)));
    if (parsed.success) return { preferences: parsed.data, error: null };
  } catch { /* invalid JSON or UTF-8 */ }
  return { preferences: defaults(), error: error('invalid_preferences', 'Invalid preferences') };
}

export async function saveProtectionPreferences(filePath: string, input: unknown): Promise<{ ok: true; preferences: Preferences } | { ok: false; error: ProtectionError }> {
  let preferences: Preferences;
  try {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, error: error('invalid_preferences', 'Invalid preferences') };
    preferences = parsed.data;
  } catch {
    return { ok: false, error: error('invalid_preferences', 'Invalid preferences') };
  }
  let absolute: string;
  try { absolute = path.resolve(filePath); } catch { return { ok: false, error: error('write_failed', 'Unable to write preferences', true) }; }
  const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  locks.set(key, current);
  await previous;
  let temp: string | undefined;
  let handle: fs.FileHandle | undefined;
  try {
    const candidate = `${absolute}.${process.pid}.${++sequence}.tmp`;
    handle = await fs.open(candidate, 'wx');
    temp = candidate;
    await handle.writeFile(JSON.stringify(preferences), 'utf8');
    await handle.close();
    handle = undefined;
    await fs.rename(candidate, absolute);
    temp = undefined;
    return { ok: true, preferences };
  } catch {
    if (handle) try { await handle.close(); } catch { /* best effort */ }
    if (temp) try { await fs.unlink(temp); } catch { /* best effort */ }
    return { ok: false, error: error('write_failed', 'Unable to write preferences', true) };
  } finally {
    if (locks.get(key) === current) locks.delete(key);
    release();
  }
}

export function decidePreloadAdmission(preferences: Preferences, support: Support, allowUnprotected: boolean): Admission {
  if (!preferences.preload) return { mode: 'off', reason: 'policy_off' };
  if (support === 'supported') return { mode: 'protected', reason: 'supported_ready' };
  if (allowUnprotected === true) return { mode: 'unprotected_override', reason: 'unprotected_override_approved' };
  return { mode: 'refused', reason: support === 'unsupported' ? 'workload_unsupported' : 'backend_unverified' };
}
