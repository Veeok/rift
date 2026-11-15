import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {EventEmitter} from 'node:events';
import {runCli} from '../dist/cli.js';

test('rift dashboard opens the configured loopback URL without waiting for the browser or starting a service',async t=>{
 const previous=process.env.RIFT_API_PORT;process.env.RIFT_API_PORT='42567';
 t.after(()=>{if(previous===undefined)delete process.env.RIFT_API_PORT;else process.env.RIFT_API_PORT=previous;});
 const calls=[];let unreferenced=false;const child=new EventEmitter();child.unref=()=>{unreferenced=true;};
 t.mock.method(childProcess,'spawn',(command,args,options)=>{calls.push({command,args,options});queueMicrotask(()=>child.emit('spawn'));return child;});
 const output=[];t.mock.method(process.stdout,'write',text=>{output.push(String(text));return true;});
 const code=await runCli(['dashboard']);assert.equal(code,0);assert.equal(calls.length,1);
 const call=calls[0],url='http://127.0.0.1:42567';assert.ok(call.args.includes(url));
 if(process.platform==='win32'){assert.equal(call.command,'rundll32.exe');assert.deepEqual(call.args,['url.dll,FileProtocolHandler',url]);}
 assert.equal(call.options.shell,false);assert.equal(call.options.stdio,'ignore');assert.equal(call.options.detached,true);assert.equal(unreferenced,true);assert.ok(output.join('').includes(url));
});
test('dashboard rejects extra arguments and invalid configured ports without spawning anything',async t=>{
 let calls=0;t.mock.method(childProcess,'spawn',()=>{calls++;throw new Error('Unexpected browser spawn');});t.mock.method(process.stderr,'write',()=>true);t.mock.method(process.stdout,'write',()=>true);
 assert.equal(await runCli(['dashboard','--unknown']),64);
 const previous=process.env.RIFT_API_PORT;process.env.RIFT_API_PORT='65536';try{assert.equal(await runCli(['dashboard']),6);}finally{if(previous===undefined)delete process.env.RIFT_API_PORT;else process.env.RIFT_API_PORT=previous;}
 assert.equal(calls,0);
});
test('dashboard reports a launcher startup error instead of claiming it opened',async t=>{
 const child=new EventEmitter();child.unref=()=>{throw new Error('Failed child must not be detached');};
 t.mock.method(childProcess,'spawn',()=>{queueMicrotask(()=>child.emit('error',new Error('Browser launcher unavailable')));return child;});
 t.mock.method(process.stdout,'write',()=>true);t.mock.method(process.stderr,'write',()=>true);
 assert.equal(await runCli(['dashboard']),6);
});
