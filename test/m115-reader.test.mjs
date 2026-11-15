import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
for(const mode of ['normal','wrong-source','reload'])test('assembled scoped reader '+mode,()=>{
 const run=spawnSync('.tools/lune.exe',['run','test/lune/m115-reader-owned.luau','luau/bootstrap.template.luau',mode],{encoding:'utf8',timeout:15000});
 assert.equal(run.status,0,run.stdout+'\n'+run.stderr);assert.match(run.stdout,/OWNED_READER_PASS/);
});
