const off=()=>({schemaVersion:1,preload:false,memory:false,virtual:false,unlocker:false});
export function runtimeLabel(saved,evidence){
 if(!saved||evidence?.state==='Error')return 'Error';
 const scoped=evidence?.support==='supported'&&evidence.scope==='context_created_only'&&evidence.wholeScriptProtected===false&&evidence.profileId==='rift-owned-ui-v1';
 if(scoped&&evidence.inUse===true)return 'In use — factory resources only';
 if(!saved.preload)return 'Off';
 return scoped?'Ready for supported UI':'Unverified';
}
function preferences(value){
 if(!value||Object.keys(value).length!==5||value.schemaVersion!==1||typeof value.preload!=='boolean'||value.memory!==false||value.virtual!==false||value.unlocker!==false)
  throw new Error('Invalid preference response. Stored choice is unknown.');
 return {...value};
}
export function startProtectionControls({document,client,onUnauthorized}){
 const form=document.getElementById('protection-form'),input=document.getElementById('preload-request');
 const status=document.getElementById('protection-status'),runtime=document.getElementById('preload-runtime');
 const save=form.querySelector('[type="submit"]'),reload=document.getElementById('protection-reload');
 const lifetime=new AbortController();let active=null,disposed=false,locked=true,attempted=false,saved=null,runtimeEvidence=null;
 const renderBusy=busy=>{input.disabled=busy||locked;save.disabled=busy||locked;reload.disabled=busy||locked;form.setAttribute('aria-busy',String(busy));};
 const renderRuntime=()=>{runtime.textContent=runtimeLabel(saved,runtimeEvidence);};
 function lock(){locked=true;const previous=active;active=null;previous?.abort();renderBusy(false);status.textContent='Unlock to load the saved choice.';runtime.textContent='Not loaded';}
 async function operation(kind){
  if(disposed||active||kind==='save'&&locked)return;
  const controller=new AbortController();active=controller;locked=false;renderBusy(true);
  const desired=kind==='save'?{...off(),preload:input.checked}:undefined;
  status.textContent=kind==='save'?'Saving…':'Loading saved choice…';
  const timer=setTimeout(()=>controller.abort(new DOMException('Preference request timed out; its outcome is unknown. Reload the saved choice.','TimeoutError')),30000);
  try{
   const result=await client.protection(desired,controller.signal);
   if(disposed||active!==controller)return;
   if(controller.signal.aborted)throw controller.signal.reason;
   if(result.error)throw new Error(result.error.message??'Unable to read saved preferences.');
   if(kind==='save'&&result.ok!==true)throw new Error('Save was not acknowledged.');
   saved=preferences(result.preferences);runtimeEvidence=result.runtime?.preload??null;input.checked=saved.preload;renderRuntime();
   status.textContent=kind==='save'?'Saved. Runtime evidence applies only to reviewed factory resources.':'Saved choice loaded. Arbitrary source and prior asset history are outside coverage.';
  }catch(error){
   if(disposed||active!==controller||locked)return;
   if(error.status===401){lock();onUnauthorized?.();return;}
   saved=null;runtimeEvidence=null;runtime.textContent='Error';
   status.textContent=(kind==='save'?'Save failed; the stored choice is not confirmed. ':'Load failed; the stored choice is unknown. ')+(controller.signal.reason?.message??error.message??'Local service error.');
  }finally{clearTimeout(timer);if(active===controller){active=null;if(!disposed)renderBusy(false);}}
 }
 form.addEventListener('submit',event=>{event.preventDefault();void operation('save');},{signal:lifetime.signal});
 reload.addEventListener('click',()=>{void operation('load');},{signal:lifetime.signal});
 input.addEventListener('change',()=>{status.textContent='Unsaved change. Select Save Preferences to persist it.';},{signal:lifetime.signal});
 return {
  load({force=false}={}){if(attempted&&!force)return;attempted=true;return operation('load');},
  lock,
  dispose(){disposed=true;active?.abort();lifetime.abort();},
 };
}
