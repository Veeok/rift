import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,writeFileSync,readFileSync,symlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
test('M4-06 actual Windows setup wrapper resolves spaced project-relative config and preserves reruns',{skip:process.platform!=='win32'},()=>{
 const base=join(tmpdir(),'opencode');mkdirSync(base,{recursive:true});const project=join(mkdtempSync(join(base,'rift-wrapper-')),'Project With Spaces'),target=join(project,'tools','rift-bridge');mkdirSync(target,{recursive:true});
 for(const folder of ['src','luau'])cpSync(join(root,folder),join(target,folder),{recursive:true});for(const file of ['setup.ps1','package.json','tsconfig.json'])cpSync(join(root,file),join(target,file));
 symlinkSync(join(root,'node_modules'),join(target,'node_modules'),'junction');mkdirSync(join(project,'.opencode'));const config=join(project,'.opencode','opencode.json');writeFileSync(config,'{"model":"owner/preserve","mcp":{"servers":{"earshot":{"type":"local","command":["keep"]}}}}');
 const invoke=()=>spawnSync(join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',join(target,'setup.ps1'),'-ConfigPath','.opencode/opencode.json','-Apply'],{cwd:project,encoding:'utf8',timeout:60000});
 const first=invoke();assert.equal(first.status,0,first.stderr);const written=readFileSync(config,'utf8'),c=JSON.parse(written);assert.ok(c.mcp.servers.rift,'setup wrote the wrong relative configuration');assert.equal(c.model,'owner/preserve');assert.deepEqual(c.mcp.servers.earshot.command,['keep']);const token=readFileSync(join(target,'.secrets','token'),'utf8');assert.ok(!first.stdout.includes(token.trim()));const second=invoke();assert.equal(second.status,0,second.stderr);assert.equal(readFileSync(config,'utf8'),written);assert.equal(readFileSync(join(target,'.secrets','token'),'utf8'),token);
});
