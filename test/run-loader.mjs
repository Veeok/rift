// GitHub-loader/.env regressions. No model calls or publication.
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as config from '../dist/config.js';
import { ROOT,TMP,Recorder,waitFor,startBridge,startMockVolt } from './lib.mjs';
const cases=[
 ['ENV-01','Local .env supplies token and port without mutating process env'],
 ['ENV-02','Explicit process token and explicit token-file override local defaults'],
 ['ENV-03','Invalid environment token fails closed without disclosing it'],
 ['ENV-04','Token updates preserve unrelated local environment entries'],
 ['LOAD-01','getgenv token overrides embedded placeholder and connects loopback'],
 ['LOAD-02','Invalid runtime port fails before opening a socket'],
 ['LOAD-03','Published generic reader uses local config without embedding a token'],
];
const catalog=cases.map(([id,title])=>({id,title,kind:'mock',area:id.split('-')[0],expected:title}));
const rec=new Recorder('loader',catalog), dir=mkdtempSync(join(TMP,'loader-'));
const token='loader-test-token-00000000000000000000000';
const envFile=join(dir,'.env');writeFileSync(envFile,`VOLT_BRIDGE_TOKEN=${token}\nVOLT_BRIDGE_PORT=38975\nOTHER_VALUE="keep me"\n`);
await rec.run('ENV-01',async check=>{
 const before=process.env.VOLT_BRIDGE_TOKEN;
 const r=config.loadConfig({},envFile);
 check('token from .env',r.token===token);
 check('port from .env',r.port===38975,r.port);
 check('no process-wide mutation',process.env.VOLT_BRIDGE_TOKEN===before);
 return {actual:{port:r.port,tokenMatches:r.token===token}};
});
await rec.run('ENV-02',async check=>{
 const alt='alternate-test-token-000000000000000000';const file=join(dir,'legacy-token');writeFileSync(file,alt);
 const a=config.loadConfig({VOLT_BRIDGE_TOKEN:alt,VOLT_BRIDGE_PORT:'38976'},envFile);
 const b=config.loadConfig({VOLT_BRIDGE_TOKEN_FILE:file},envFile);
 check('explicit token wins',a.token===alt&&a.port===38976);
 check('explicit token file wins over local .env token',b.token===alt);
 return {actual:{explicitToken:a.token===alt,explicitFile:b.token===alt}};
});
await rec.run('ENV-03',async check=>{
 const secret='invalid-secret-value';const r=config.loadConfig({VOLT_BRIDGE_TOKEN:secret},join(dir,'absent.env'));
 check('fails closed',r.token===null && !!r.tokenError,r.tokenError);
 check('does not disclose secret',!JSON.stringify(r.tokenError).includes(secret));
 return {actual:{disabled:r.token===null,error:r.tokenError}};
});
await rec.run('ENV-04',async check=>{
 check('local-token writer exists',typeof config.saveLocalToken==='function');
 if(!config.saveLocalToken)return {actual:'writer unavailable'};
 config.saveLocalToken(envFile,token,38977);const text=readFileSync(envFile,'utf8');
 check('preserves unrelated entries',text.includes('OTHER_VALUE="keep me"'));
 check('exactly one token assignment',(text.match(/^VOLT_BRIDGE_TOKEN=/gm)||[]).length===1);
 check('updated port works',config.loadConfig({},envFile).port===38977);
 return {actual:{preservedOther:true}};
});
for(const [id,port] of [['LOAD-01',38975],['LOAD-02',80]])await rec.run(id,async check=>{
 const tf=join(dir,'listener-token');writeFileSync(tf,token);
 const b=await startBridge({port:38975,tokenFile:tf});
 const mv=await startMockVolt({ctrlPort:38976,bridgePort:38975,token:'wrong-template-token-000000000000000',runtimeConfig:{token,port}});
 try{
  const connected=await waitFor(async()=> (await b.status()).connected,id==='LOAD-01'?12000:2500);
  const st=await mv.stats();
  if(id==='LOAD-01')check('runtime token used',!!connected,{connected:!!connected,logs:st.logs});
  else check('no socket for invalid config',!connected&&st.connectCalls===0,{connected:!!connected,calls:st.connectCalls});
  return {actual:{connected:!!connected,calls:st.connectCalls}};
 }finally{await mv.stop();await b.stop();}
});
await rec.run('LOAD-03',async check=>{
 const staged=join(ROOT,'.publication','rift-public','luau','reader.luau');
 const publicFile=existsSync(staged)?staged:join(ROOT,'luau','reader.luau');
 const text=readFileSync(publicFile,'utf8');
 check('no local credential in public reader',!text.includes(token));
 const tf=join(dir,'generic-token');writeFileSync(tf,token);
 const b=await startBridge({port:38975,tokenFile:tf});
 const mv=await startMockVolt({ctrlPort:38976,bridgePort:38975,token:'unused-fixture-token-00000000000000000000',runtimeConfig:{token,port:38975},readerFile:publicFile});
 try{
  const connected=await waitFor(async()=>(await b.status()).connected,12000);
  const status=await b.status();
  check('public artifact authenticated from getgenv',!!connected);
  check('public reader reports stamped build',/^[0-9a-f]{12}$/.test(status.reader?.readerBuild??''),status.reader?.readerBuild);
  const child=await b.call('list_children',{});
  check('read-only inspection works through artifact',child.json?.items?.some(x=>x.name==='Workspace'));
  return {actual:{connected:!!connected,build:status.reader?.readerBuild}};
 }finally{await mv.stop();await b.stop();}
});
console.log(rec.save());process.exit(rec.results.some(r=>r.status!=='pass')?1:0);
