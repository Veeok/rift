import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
export interface Crop { x:number; y:number; width:number; height:number }
export interface ClientWindow { id:string; title:string; pid:number; processName:string; width:number; height:number; minimized:boolean }
export interface CaptureBackend {
 listWindows():Promise<ClientWindow[]>;
 capture(windowId:string,crop?:Crop):Promise<{data:Buffer;width:number;height:number}>;
}
const MAX_PIXELS = 16_000_000;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const NOTICE = 'Window/session association is unverified. A title does not establish session identity. This is a historical local preview, not a live view; inspect it before explicitly sharing. Typed image delivery does not prove model visibility.';
function windowId(value: string): void {
 if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value)) throw new Error('Select an explicit client window ID from a fresh window list.');
}
function dimensions(width:number, height:number):void {
 if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > MAX_PIXELS) throw new Error('Window size is empty or too large; resize the client and refresh.');
}
function cropBounds(crop:Crop, width?:number, height?:number):void {
 if (!crop || ![crop.x,crop.y,crop.width,crop.height].every(Number.isSafeInteger) || crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1 || crop.x + crop.width > (width ?? 8192) || crop.y + crop.height > (height ?? 8192)) throw new Error('Crop must use integer window-relative pixel coordinates entirely inside the selected window.');
}

/** Fixed local helper, JSON stdin only: no command/source/URL parameter or desktop fallback. */
export class WindowsCaptureBackend implements CaptureBackend {
 private async invoke(request:Record<string,unknown>):Promise<any> {
  if (process.platform !== 'win32') throw new Error('Client window capture requires Windows.');
  const script = fileURLToPath(new URL('../tools/capture-window.ps1', import.meta.url));
  return new Promise((resolve,reject) => {
   const child = execFile(join(process.env.SystemRoot ?? 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'), ['-NoLogo','-NoProfile','-NonInteractive','-File',script], {windowsHide:true,timeout:20_000,maxBuffer:24*1024*1024,encoding:'utf8'}, (error,stdout,stderr) => {
    if (error) { reject(new Error(`Client capture failed or timed out; restore the client and refresh. ${stderr.trim().slice(0,1000) || error.message}`)); return; }
    try { resolve(JSON.parse(stdout.replace(/^\uFEFF/,''))); }
    catch { reject(new Error('Client capture helper returned invalid data; refresh and retry.')); }
   });
   child.stdin?.on('error', () => { /* exit callback reports helper failure */ });
   child.stdin?.end(JSON.stringify(request));
  });
 }
 async listWindows():Promise<ClientWindow[]> {
  const result = await this.invoke({action:'list'});
  if (!Array.isArray(result)) throw new Error('Invalid client window list.');
  return result;
 }
 async capture(id:string,crop?:Crop):Promise<{data:Buffer;width:number;height:number}> {
  windowId(id); if (crop !== undefined) cropBounds(crop);
  const result = await this.invoke({action:'capture',windowId:id,crop:crop ?? null});
  if (typeof result?.data !== 'string') throw new Error('Capture helper returned no PNG.');
  return {data:Buffer.from(result.data,'base64'),width:result.width,height:result.height};
 }
}

interface StoredCapture { data:Buffer; meta:Record<string,unknown>; expires:number }
export class CaptureService {
 private readonly backend:CaptureBackend;
 private readonly entries = new Map<string,StoredCapture>();
 private readonly maxEntries:number;
 private readonly ttlMs:number;
 private readonly maxBytes:number;
 private bytes = 0;
 private pending = false;
 private expiryTimer?:NodeJS.Timeout;
 constructor(backend:CaptureBackend = new WindowsCaptureBackend(), options:{maxEntries?:number;ttlMs?:number;maxBytes?:number} = {}) {
  this.backend = backend;
  this.maxEntries = options.maxEntries ?? 8;
  this.ttlMs = options.ttlMs ?? 5*60_000;
  this.maxBytes = options.maxBytes ?? 32*1024*1024;
  for (const [value,cap] of [[this.maxEntries,100],[this.ttlMs,86_400_000],[this.maxBytes,128*1024*1024]] as const) {
   if (!Number.isSafeInteger(value) || value <= 0 || value > cap) throw new Error(`Capture limit must be a positive integer no greater than ${cap}.`);
  }
 }
 async listWindows():Promise<ClientWindow[]> {
  return structuredClone((await this.backend.listWindows()).filter(w => w.processName === 'RobloxPlayerBeta'));
 }
 async preview(args:{windowId:string;sessionId:string;crop?:Crop}):Promise<Record<string,unknown>> {
  windowId(args.windowId);
  if (typeof args.sessionId !== 'string' || !args.sessionId.trim() || args.sessionId.length > 512) throw new Error('A nonempty current session ID is required.');
  // Snapshot caller-owned inputs before any asynchronous boundary.
  const {windowId:id,sessionId} = args;
  const crop = args.crop === undefined ? undefined : structuredClone(args.crop);
  if (crop !== undefined) cropBounds(crop);
  if (this.pending) throw new Error('A client preview is already in progress; wait and retry.');
  this.pending = true;
  try {
   const selected = (await this.listWindows()).find(w => w.id === id);
   if (!selected) throw new Error('Client window closed or unavailable; refresh windows and explicitly select again.');
   if (selected.minimized) throw new Error('Client window is minimized; restore it and retry.');
   dimensions(selected.width,selected.height);
   if (crop !== undefined) cropBounds(crop,selected.width,selected.height);
   const result = await this.backend.capture(id,crop);
   // HWNDs can be recycled between the service's selection and the OS helper's capture.
   // Refuse stale descriptive metadata rather than associating it with another window.
   const current = (await this.listWindows()).find(w => w.id === id);
   if (!current || current.pid !== selected.pid || current.title !== selected.title || current.width !== selected.width || current.height !== selected.height || current.minimized) throw new Error('Client window changed during capture; refresh and select again.');
   dimensions(result.width,result.height);
   if (result.width !== (crop?.width ?? selected.width) || result.height !== (crop?.height ?? selected.height)) throw new Error('Window size changed during capture; refresh and retry.');
   const data = result.data;
   if (!Buffer.isBuffer(data) || data.length < 33 || !data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) || data.toString('ascii',12,16) !== 'IHDR' || data.readUInt32BE(16) !== result.width || data.readUInt32BE(20) !== result.height) throw new Error('Capture backend did not return a matching PNG image.');
   if (data.length > MAX_IMAGE_BYTES || data.length > this.maxBytes) throw new Error('Capture exceeds the PNG byte limit; choose a smaller crop.');
   this.purge();
   while (this.entries.size >= this.maxEntries || this.bytes + data.length > this.maxBytes) this.remove(this.entries.keys().next().value!);
   const captureId = randomUUID(), now = Date.now();
   const meta:Record<string,unknown> = {captureId,sessionId,capturedAt:new Date(now).toISOString(),width:result.width,height:result.height,crop:crop ?? null,window:selected,windowSessionMatch:'unverified',notice:NOTICE};
   this.entries.set(captureId,{data:Buffer.from(data),meta,expires:now+this.ttlMs}); this.bytes += data.length;
   this.scheduleExpiry();
   return structuredClone(meta);
  } finally { this.pending = false; }
 }
 private remove(id:string):void {
  const entry = this.entries.get(id);
  if (entry) { this.bytes -= entry.data.length; this.entries.delete(id); }
 }
 private purge():void {
  const now = Date.now();
  for (const [id,entry] of this.entries) if (entry.expires <= now) this.remove(id);
 }
 private scheduleExpiry():void {
  if (this.expiryTimer) clearTimeout(this.expiryTimer);
  const next = this.entries.values().next().value;
  if (!next) { this.expiryTimer = undefined; return; }
  this.expiryTimer = setTimeout(() => { this.purge(); this.scheduleExpiry(); }, Math.max(1,next.expires-Date.now()));
  this.expiryTimer.unref();
 }
 image(captureId:string):{data:Buffer;mimeType:'image/png';meta:Record<string,unknown>} {
  this.purge();
  const entry = this.entries.get(captureId);
  if (!entry) throw new Error('Capture not found, expired or evicted; create a new local preview.');
  return {data:Buffer.from(entry.data),mimeType:'image/png',meta:structuredClone(entry.meta)};
 }
 share(args:{captureId:string;sessionId:string;confirm:boolean;routeSupportsImages?:boolean}):CallToolResult {
  if (args.confirm !== true) throw new Error('Explicit confirm:true is required to share this preview.');
  if (args.routeSupportsImages === false) throw new Error('This route does not support images; use a supported image route or local preview.');
  const image = this.image(args.captureId);
  if (args.sessionId !== image.meta.sessionId) throw new Error('Capture belongs to a different session; create and review a new preview.');
  return {content:[{type:'text',text:JSON.stringify({...image.meta,routeImageSupport:args.routeSupportsImages === true ? 'supported' : 'unverified'})},{type:'image',mimeType:'image/png',data:image.data.toString('base64')}]};
 }
}
