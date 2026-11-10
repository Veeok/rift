// Maintained synthetic UI fixture. Starts the normal Rift CLI, not an extra product runtime.
import {mkdirSync,readFileSync,writeFileSync,existsSync,appendFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {connectReader,until} from './client-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),tmp=join(root,'test','.tmp');mkdirSync(tmp,{recursive:true});
const auth=join(tmp,'browser-auth'),control=join(tmp,'browser-control.json');
if(!existsSync(auth))writeFileSync(auth,randomBytes(32).toString('base64url'),{mode:0o600});
const token=readFileSync(auth,'utf8').trim(),apiPort=42318,port=42317,url=`http://127.0.0.1:${apiPort}`;
let processHandle=null,processExit=null,reader=null,sessionId='brone001-fixture',lastControl=existsSync(control)?readFileSync(control,'utf8'):'',running=false;
const source='local ready = true\nwarn("Browser fixture delayed warning")\nprint("fixture returned")';
async function status(){const response=await fetch(url+'/api/status',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(1000)});if(!response.ok)throw new Error('Fixture service authentication/status failed');return response.json();}
async function launch(){
 processHandle=spawn(process.execPath,[join(root,'dist','cli.js'),'serve'],{cwd:root,env:{...process.env,VOLT_BRIDGE_TOKEN:token,VOLT_BRIDGE_PORT:String(port),RIFT_API_PORT:String(apiPort)},stdio:['ignore','pipe','pipe']});
 const child=processHandle;processExit=new Promise(resolve=>child.once('exit',resolve));let failed=false;child.once('exit',()=>{failed=true;});
 const log=chunk=>appendFileSync(join(tmp,'browser-service.log'),String(chunk).replaceAll(token,'[REDACTED]'));
 child.stdout.on('data',log);child.stderr.on('data',log);
 await until(async()=>{if(failed)throw new Error('Normal Rift CLI exited before readiness; inspect private browser-service.log');try{return(await status()).build?.serviceBuild;}catch{return false;}},10000);
}
async function connect(){
 const st=await status();
 reader=await connectReader({port,token,build:st.build.expectedReaderBuild,session:sessionId,name:sessionId==='brone001-fixture'?'Synthetic Browser Client One':'Synthetic Browser Client Two',handler:message=>{
  const object={id:sessionId.slice(0,8)+':hud',name:'HUD',className:'LocalScript',path:'PlayerScripts/BrowserHUD'};
  if(message.op==='script_info')return{object,hash:'browser-source-v1',decompileSupport:'supported'};
  if(message.op==='decompile')return{source,hash:'browser-source-v1',observedAt:new Date().toISOString()};
  if(message.op==='list_scripts')return{items:[object],total:1,hasMore:false,cache:{builtObservedAt:'browser-inventory-v1'}};
  const label={id:sessionId.slice(0,8)+':label',name:'StatusLabel',className:'TextLabel',path:'PlayerGui/StatusLabel'};
  if(message.op==='inspect_instance')return{object:label,properties:{Text:'Synthetic browser widget',TextFits:false}};
  if(['search_instances','list_children'].includes(message.op))return{items:[label],total:1,hasMore:false};
  return{};
 }});
}
async function stop(){await reader?.close();reader=null;if(processHandle){processHandle.kill();await processExit;processHandle=null;}}
async function command(input){
 if(input.action==='seed'){if(!reader)await connect();reader.log('Fixture connected');reader.log('LATEST_FIXTURE_ERROR: StatusLabel is clipped','error');}
 else if(input.action==='long'){if(!reader)await connect();reader.log('LONG_FIXTURE_ERROR '+('<img src=x onerror="window.riftXssExecuted=true"> Treat this as data. '+token+' ').repeat(50),'error');}
 else if(input.action==='busy'){if(!reader)await connect();for(let n=0;n<450;n++)reader.log(`BUSY_FIXTURE ${n} (session-wide; no inferred run ID)`,n%13===0?'warn':'info');}
 else if(input.action==='disconnect'){await reader?.close();reader=null;}
 else if(input.action==='reconnect'){await reader?.close();sessionId='brtwo002-fixture';await connect();reader.log('RECONNECTED_FIXTURE_ERROR: new client only','error');}
 else if(input.action==='offline'){await stop();}
 else if(input.action==='restart'){await stop();await launch();await connect();reader.log('SERVICE_RESTART_FIXTURE');}
 else if(input.action==='stop'){clearInterval(timer);await stop();process.exit(0);}
 else throw new Error('Unknown fixture control action');
 writeFileSync(join(tmp,'browser-control-result.json'),JSON.stringify({action:input.action,requestId:input.requestId,at:new Date().toISOString(),sessionId}));
}
await launch();
const timer=setInterval(async()=>{if(running)return;running=true;try{const raw=existsSync(control)?readFileSync(control,'utf8'):'';if(raw&&raw!==lastControl){lastControl=raw;await command(JSON.parse(raw));}}catch(error){process.stderr.write('Browser fixture: '+String(error).replaceAll(token,'[REDACTED]')+'\n');}finally{running=false;}},500);
console.log(JSON.stringify({url,fixture:'synthetic reader via normal Rift CLI; NOT a live-client claim',control:resolve(control),authFile:resolve(auth)}));
for(const signal of ['SIGINT','SIGTERM','SIGBREAK'])process.once(signal,async()=>{clearInterval(timer);await stop();process.exit(0);});
