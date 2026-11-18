import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
for(const mode of ['write','readonly'])test('complete explorer reader '+mode,()=>{
 const run=spawnSync('.tools/lune.exe',['run','test/lune/explorer-reader.luau','luau/bootstrap.template.luau',mode],{encoding:'utf8',timeout:15000});
 assert.equal(run.status,0,run.stdout+'\n'+run.stderr);assert.match(run.stdout,/EXPLORER_READER_PASS/);
});
