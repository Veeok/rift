import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {startService} from '../dist/service.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const token='capability-wording-fixture-00000000000000000000';
async function port(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value;}

test('standalone instructions match the execution setting',async()=>{
  const {serverInstructions}=await import('../dist/instructions.js');
  const disabled=serverInstructions(false),enabled=serverInstructions(true);
  assert.match(disabled,/cannot execute code/);assert.doesNotMatch(disabled,/read-only access|execute_luau\) is enabled/);
  assert.match(enabled,/execute_luau\) is enabled/);assert.doesNotMatch(enabled,/read-only access|cannot execute code/);
  for(const instructions of[disabled,enabled]){assert.match(instructions,/untrusted/i);assert.match(instructions,/never embed/i);}
});

test('shared instructions describe opt-in execution, not an inspection-only service',async()=>{
  const child=spawn(process.execPath,[root+'dist/index.js','--shared'],{cwd:root,env:{...process.env,VOLT_BRIDGE_TOKEN:token,VOLT_BRIDGE_API_PORT:String(await port()),VOLT_BRIDGE_ALLOW_EXEC:'0'},stdio:['pipe','pipe','pipe']});
  const exited=once(child,'exit');let buffer='',resolveReply,rejectReply;
  const reply=new Promise((resolve,reject)=>{resolveReply=resolve;rejectReply=reject;});
  const timer=setTimeout(()=>rejectReply(new Error('MCP initialize timeout')),5000);
  child.on('error',rejectReply);child.stderr.resume();
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
    buffer+=chunk;for(let end;(end=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line)continue;try{const message=JSON.parse(line);if(message.id===1)resolveReply(message);}catch(error){rejectReply(error);}}
  });
  try{
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'capability-wording-test',version:'1'}}})+'\n');
    const response=await reply;assert.ok(response.result,'MCP initialization succeeded');
    assert.match(response.result.instructions,/execut/i);assert.doesNotMatch(response.result.instructions,/inspection\/diagnostics service\./);
    assert.match(response.result.instructions,/untrusted/i);assert.match(response.result.instructions,/explicit confirmation/);
  }finally{clearTimeout(timer);child.stdin.end();const shutdown=setTimeout(()=>child.kill(),2000);await exited;clearTimeout(shutdown);}
});

test('catalog annotations match tool behaviour',async()=>{
  for(const allowExec of[false,true]){
    const apiPort=await port(),service=await startService({port:await port(),apiPort,token,tokenFile:'unused',tokenError:null,allowExec});
    try{
      const response=await fetch(`http://127.0.0.1:${apiPort}/api/catalog`,{headers:{authorization:'Bearer '+token}});assert.equal(response.status,200);
      const {tools}=await response.json(),byName=new Map(tools.map(tool=>[tool.name,tool]));assert.equal(tools.length,allowExec?18:17);assert.equal(byName.has('execute_luau'),allowExec);
      assert.equal(byName.get('select_session').annotations.readOnlyHint,false);assert.equal(byName.get('select_session').annotations.idempotentHint,true);
      for(const name of['get_sessions','get_logs','share_capture'])assert.equal(byName.get(name).annotations.readOnlyHint,true,name);
      for(const name of['get_subtree','inspect_instances','discover_source','get_source_excerpt']){assert.equal(byName.get(name).annotations.readOnlyHint,true,name);assert.ok(byName.get(name).inputSchema.properties,name);}
    }finally{await service.stop();}
  }
});

test('CLI help mentions opt-in execution',()=>{
  const result=spawnSync(process.execPath,[root+'dist/cli.js','--help'],{cwd:root,encoding:'utf8',timeout:5000});
  assert.equal(result.status,0);assert.match(result.stdout,/opt-in approved execution/);
});
