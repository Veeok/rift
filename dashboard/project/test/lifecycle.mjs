import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import Dashboard from '../src/Dashboard.jsx';
import '../style.css';

window.__lifecycleReady=(async()=>{
 const failures=[],passed=[];
 let startDashboard;
 try{({startDashboard}=await import(/* @vite-ignore */new URL('/src/controller.js',location.href).href));}catch{}
 if(typeof startDashboard!=='function')return {passed,failures:['source-owned controller is missing']};
 let root;
 const assert=(value,message)=>{if(!value)throw new Error(message);};
  const frame=()=>new Promise(requestAnimationFrame);
 const until=async check=>{const deadline=performance.now()+3000;while(!check()){if(performance.now()>deadline)throw new Error('Synthetic browser state did not settle');await frame();}};
 function mount(){
  root?.unmount();location.hash='#activity';
  root=createRoot(document.getElementById('fixture-root'));
  flushSync(()=>root.render(React.createElement(Dashboard)));
 }
 function backend({pending=false,ready=false,responses={}}={}){
  const calls=[];let authenticated=ready,aborted=false;
  const reply=(value,status=200)=>new Response(JSON.stringify(value),{status});
  const fetchImpl=async(path,options)=>{
   calls.push({path,options});
   if(pending)return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('cancelled','AbortError'));},{once:true}));
   if(path==='/api/login'){
    authenticated=JSON.parse(options.body).token==='preview-only';
    return reply(authenticated?{ok:true}:{error:'Credential refused'},authenticated?200:401);
   }
   if(!authenticated)return reply({error:'Authentication required'},401);
    if(responses[path])return reply(await responses[path](JSON.parse(options.body??'{}'),options));
   if(path==='/api/status')return reply({state:'healthy',session:{id:'synthetic',connectionId:'c1',name:'Synthetic fixture'},sessions:[],activity:{retainedEvents:0,pendingRequests:0}});
   if(path==='/api/tools/get_logs')return reply({structuredContent:{sessionId:'synthetic',current:true,items:[],hasMore:false}});
   return reply({error:'Unexpected synthetic request'},404);
  };
  return {fetchImpl,calls,lock(){authenticated=false;},get aborted(){return aborted;}};
 }
 async function run(name,body){try{await body();passed.push(name);}catch(e){failures.push(name+': '+e.message);}}
 await run('one source-owned lifetime per document',async()=>{
  mount();const mock=backend({pending:true});const stop=startDashboard({fetchImpl:mock.fetchImpl});
  try{let refused=false;try{startDashboard({fetchImpl:mock.fetchImpl});}catch(e){refused=/already active/i.test(e.message);}assert(refused,'duplicate controller was accepted');}
  finally{stop();await frame();}
 });
 await run('dispose cancels requests and hash listeners',async()=>{
  mount();const mock=backend({pending:true}),stop=startDashboard({fetchImpl:mock.fetchImpl});
  stop();stop();location.hash='#source';dispatchEvent(new HashChangeEvent('hashchange'));await frame();
  assert(mock.aborted,'pending transport was not cancelled');
  assert(document.getElementById('source').hidden,'disposed navigation listener remained active');
  assert(mock.calls.length===1,'a disposed controller started another poll');
 });
 await run('login failure and success clear secrets and preserve expected focus',async()=>{
  mount();const mock=backend(),stop=startDashboard({fetchImpl:mock.fetchImpl});
  try{
   await frame();const input=document.getElementById('token'),button=document.querySelector('#login-form button');
   input.value='wrong-only';button.click();await frame();
   assert(input.value==='','failed login retained input token');assert(document.activeElement===input,'failed login lost input focus');
   input.value='preview-only';button.click();await frame();
   assert(input.value==='','successful login retained input token');assert(document.getElementById('unlock').hidden,'successful login stayed locked');
   assert(document.activeElement===document.getElementById('main'),'successful login did not focus the main content');
  }finally{stop();await frame();}
 });
 await run('a reconnect during instance search cannot display another session’s objects',async()=>{
  mount();const mock=backend({ready:true,responses:{'/api/tools/search_instances':()=>({structuredContent:{session:{readerSession:'other',connectionId:'c2'},items:[{id:'foreign',name:'FOREIGN_WIDGET'}]}})}});
  const stop=startDashboard({fetchImpl:mock.fetchImpl});
  try{await frame();document.getElementById('widget-name').value='Widget';document.getElementById('widget-form').requestSubmit();await frame();
   assert(document.getElementById('widget-results').children.length===0,'foreign evidence was rendered');
   assert(/different reader session/i.test(document.getElementById('widget-notice').textContent),'mismatch was not reported');
  }finally{stop();await frame();}
 });
 await run('pending source checks reuse the job and then advance explicit source pages',async()=>{
  mount();const requests=[];const hit={scriptId:'s1',line:1,path:'Synthetic.Source',revision:'r1',excerpt:'hello'};
  const mock=backend({ready:true,responses:{
   '/api/tools/search_source':()=>({structuredContent:{sessionId:'synthetic',items:[hit]}}),
   '/api/tools/read_script':args=>{requests.push(args);return {structuredContent:requests.length===1?{metadata:{sessionId:'synthetic',status:'pending',jobId:'j1'},sourceText:null}:{metadata:{sessionId:'synthetic',status:'complete',hash:'h1',source:{nextStartLine:requests.length===2?31:null}},sourceText:requests.length===2?'first page':'second page'}};},
  }});const stop=startDashboard({fetchImpl:mock.fetchImpl});
  try{await frame();document.getElementById('query').value='hello';document.getElementById('source-form').requestSubmit();await frame();document.querySelector('#source-results button').click();await frame();
   const next=document.getElementById('source-next');assert(!next.hidden&&next.textContent.includes('Pending'),'pending continuation unavailable');next.click();await frame();
   assert(requests[1].jobId==='j1'&&document.getElementById('source-detail').textContent.includes('first page'),'pending job was not reused');next.click();await frame();
   assert(requests[2].startLine===31&&!requests[2].jobId&&next.hidden,'page continuation invented another job or lost cursor');
   assert(document.getElementById('source-detail').textContent.includes('second page'),'next source page missing');
  }finally{stop();await frame();}
 });
 await run('copy actions and real pass:false diagnostic checks remain available',async()=>{
  mount();const mock=backend({ready:true,responses:{'/api/doctor':()=>({ok:false,checks:[{id:'reader_build',pass:false}]})}});
  const stop=startDashboard({fetchImpl:mock.fetchImpl});
  try{await frame();for(const label of ['Copy Source','Copy Instance','Copy Evidence'])assert([...document.querySelectorAll('button')].some(b=>b.textContent===label),'missing '+label);
   document.getElementById('doctor-popup-setting').checked=true;document.getElementById('doctor').click();await frame();
   assert(document.querySelector('dialog.doctor-popup').open,'real pass:false diagnostic failure did not open its enabled popup');
  }finally{stop();await frame();}
 });
  await run('Extra protection saves desired state only and keeps failed saves explicit',async()=>{
  mount();const form=document.getElementById('protection-form');assert(form,'Extra protection controls are missing');
  let saved={schemaVersion:1,preload:false,memory:false,virtual:false,unlocker:false},fail=false;
  const mock=backend({ready:true,responses:{'/api/protection':(args,options)=>{
   if(options.method==='PATCH'){if(fail)throw new Error('Synthetic write failure');saved={...args};return {ok:true,preferences:saved};}
   return {preferences:saved,error:null,runtime:{preload:{state:saved.preload?'Unverified':'Off',support:'unverified',inUse:false}}};
  }}});const stop=startDashboard({fetchImpl:mock.fetchImpl});
   try{const input=document.getElementById('preload-request');await until(()=>!input.disabled);assert(!input.checked,'missing preference did not default Off');
   input.click();assert(mock.calls.every(c=>c.options.method!=='PATCH'),'toggle saved without explicit submit');form.requestSubmit();await until(()=>!input.disabled);
   assert(saved.preload&&/Saved/i.test(document.getElementById('protection-status').textContent),'choice was not explicitly saved');
   assert(document.getElementById('preload-runtime').textContent==='Unverified','saved On was shown as active protection');
   fail=true;input.click();form.requestSubmit();await until(()=>!input.disabled);
   assert(saved.preload&&/failed|failure/i.test(document.getElementById('protection-status').textContent),'failed save was hidden');
   assert(mock.calls.every(c=>!c.path.includes('execute_luau')),'a preference action executed source');
   }finally{stop();await frame();}
  });
 await run('preference load errors are explicit and a reader reconnect does not cancel a pending save',async()=>{
  mount();let saves=0,finish;
  const saved={schemaVersion:1,preload:true,memory:false,virtual:false,unlocker:false};
  let connection='c1';const mock=backend({ready:true,responses:{
   '/api/status':()=>({state:'healthy',session:{id:'synthetic',connectionId:connection},sessions:[]}),
   '/api/protection':(_,options)=>options.method==='PATCH'?new Promise(resolve=>{saves++;finish=()=>resolve({ok:true,preferences:saved});}):({preferences:{...saved,preload:false},error:{message:'Synthetic corrupted preferences'}}),
  }});const stop=startDashboard({fetchImpl:mock.fetchImpl});
  try{await until(()=>!document.getElementById('preload-request').disabled);assert(document.getElementById('preload-runtime').textContent==='Error','corruption was reported as Off');
   assert(/Load failed/.test(document.getElementById('protection-status').textContent),'load error was hidden');
   document.getElementById('preload-request').checked=true;document.getElementById('protection-form').requestSubmit();await frame();
   connection='c2';document.getElementById('refresh').click();await frame();
   const call=mock.calls.find(c=>c.path==='/api/protection'&&c.options.method==='PATCH');
   assert(saves===1&&!call.options.signal.aborted,'reader reset aborted persisted service preferences');finish();await until(()=>!document.getElementById('preload-request').disabled);
   assert(document.getElementById('preload-runtime').textContent==='Unverified','save acknowledgment lost after reconnect');
  }finally{stop();await frame();}
 });
 await run('a disposed controller cancels preference loads and ignores late responses',async()=>{
  mount();let finish;
  const mock=backend({ready:true,responses:{'/api/protection':()=>new Promise(resolve=>{finish=()=>resolve({preferences:{schemaVersion:1,preload:true,memory:false,virtual:false,unlocker:false},error:null});})}});
  const stop=startDashboard({fetchImpl:mock.fetchImpl});await until(()=>finish);
  const call=mock.calls.find(c=>c.path==='/api/protection');assert(call,'preference request did not start');stop();
  const text=document.getElementById('protection-status').textContent;finish();await frame();
  assert(call.options.signal.aborted,'preference load survived disposal');assert(document.getElementById('protection-status').textContent===text,'disposed response altered the document');
 });
 await run('a committed save with a lost response invalidates runtime state until reload',async()=>{
  mount();let saved={schemaVersion:1,preload:false,memory:false,virtual:false,unlocker:false};
  const mock=backend({ready:true,responses:{'/api/protection':(args,options)=>{
   if(options.method==='PATCH'){saved={...args};throw new Error('Response lost after commit');}
   return {preferences:saved,error:null};
  }}});const stop=startDashboard({fetchImpl:mock.fetchImpl});
  try{const input=document.getElementById('preload-request');await until(()=>!input.disabled);input.click();document.getElementById('protection-form').requestSubmit();await until(()=>!input.disabled);
   assert(saved.preload,'fixture did not commit');assert(document.getElementById('preload-runtime').textContent==='Error','lost response kept stale Off runtime');
   document.getElementById('protection-reload').click();await until(()=>!input.disabled);assert(document.getElementById('preload-runtime').textContent==='Unverified','reload did not reconcile committed preference');
  }finally{stop();await frame();}
 });
 await run('re-login starts a fresh preference load before an aborted old request settles',async()=>{
  mount();let loads=0,finish;
  const off={schemaVersion:1,preload:false,memory:false,virtual:false,unlocker:false};
  const mock=backend({ready:true,responses:{'/api/protection':()=>{
   loads++;return loads===1?new Promise(resolve=>finish=()=>resolve({preferences:{...off,preload:true},error:null})):({preferences:off,error:null});
  }}});const stop=startDashboard({fetchImpl:mock.fetchImpl});
  try{await until(()=>finish);mock.lock();document.getElementById('refresh').click();await until(()=>!document.getElementById('unlock').hidden);
   document.getElementById('token').value='preview-only';document.querySelector('#login-form button').click();await until(()=>loads===2);
   await until(()=>!document.getElementById('preload-request').disabled);finish();await frame();
   assert(document.getElementById('preload-runtime').textContent==='Off'&&!document.getElementById('preload-request').checked,'late old response overwrote re-login state');
  }finally{finish?.();stop();await frame();}
 });
  await run('scoped runtime evidence stays resource-only and Off preserves earlier use until reload',async()=>{
   mount();let saved={schemaVersion:1,preload:true,memory:false,virtual:false,unlocker:false};
   let evidence={state:'Ready for supported UI',support:'supported',scope:'context_created_only',wholeScriptProtected:false,profileId:'rift-owned-ui-v1',inUse:false};
   const mock=backend({ready:true,responses:{'/api/protection':(args,options)=>{
    if(options.method==='PATCH')saved={...args};
    return {ok:true,preferences:saved,error:null,runtime:{preload:evidence}};
   }}});const stop=startDashboard({fetchImpl:mock.fetchImpl});
   try{const input=document.getElementById('preload-request'),runtime=document.getElementById('preload-runtime');
    await until(()=>!input.disabled);assert(runtime.textContent==='Ready for supported UI','scoped readiness missing');
    evidence={...evidence,inUse:true};input.click();document.getElementById('protection-form').requestSubmit();await until(()=>!input.disabled);
    assert(!saved.preload&&runtime.textContent==='In use — factory resources only','Off hid earlier owned resources');
    evidence={state:'Unverified',support:'unverified',scope:'context_created_only',wholeScriptProtected:false,profileId:null,inUse:false};
    saved={...saved,preload:true};document.getElementById('protection-reload').click();await until(()=>!input.disabled);
    assert(runtime.textContent==='Unverified'&&input.checked,'reload retained stale reader readiness');
    evidence={...evidence,state:'Error'};document.getElementById('protection-reload').click();await until(()=>!input.disabled);
    assert(runtime.textContent==='Error','blocked validation was hidden');
    assert(mock.calls.every(c=>!c.path.includes('execute_luau')&&!c.path.includes('close_owned_ui')),'runtime labels mutated client resources');
   }finally{stop();await frame();}
  });
  root?.unmount();return {passed,failures};
})().then(result=>{
 const output=document.createElement('pre');output.id='lifecycle-result';
 output.textContent=JSON.stringify(result);document.body.append(output);return result;
});
