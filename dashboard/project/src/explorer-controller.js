import {createExplorerModel,parseEditorValue,sameBinding} from './explorer-model.js';

export function startExplorer({document,window,client,onSource=()=>{}}){
 const $=id=>document.getElementById(id),tree=$('explorer-tree');
 if(!tree)return {setBinding(){},activate(){},dispose(){}};
 const model=createExplorerModel(),lifetime=new AbortController(),pending=new Set();
 let binding=null,epoch=0,active=false,selected=null,properties=null,draft=null,writing=false,searching=false,readSequence=0,selectionSequence=0,windowStart=0;
 const listen=(node,event,fn)=>node.addEventListener(event,fn,{signal:lifetime.signal});
 const text=(id,value)=>{$(id).textContent=value;};
 const pretty=value=>JSON.stringify(value,null,2);
 const element=(tag,className,content)=>{const node=document.createElement(tag);if(className)node.className=className;if(content!==undefined)node.textContent=content;return node;};
 const format=value=>value?.type==='string'?value.value:value?.type==='EnumItem'?value.value?.name:value?.type==='nil'?'nil':typeof value?.value==='object'?JSON.stringify(value.value):String(value?.value??'Not readable');
 const valid=(captured,generation)=>generation===epoch&&sameBinding(binding,captured)&&!lifetime.signal.aborted;
 async function request(args,write=false){
  if(!binding)throw new Error('Connect a matching client first.');
  const captured={...binding},generation=epoch,controller=new AbortController();pending.add(controller);
  const timer=setTimeout(()=>controller.abort(),write?15000:20000);
  try{
   const result=await (write?client.explorerWrite:client.explorerRead)({...args,binding:captured},controller.signal);
   if(!valid(captured,generation))throw new DOMException('Reader changed','AbortError');
   if(!sameBinding(result.binding,captured))throw new Error('Explorer response belongs to a different connection. Refresh this reader.');
   return result;
  }finally{clearTimeout(timer);pending.delete(controller);}
 }
 function closeDraft(){draft=null;$('explorer-confirm').close();$('explorer-confirm-check').checked=false;$('explorer-apply').disabled=true;}
 function clearSelection(){
  selected=null;properties=null;selectionSequence++;closeDraft();
  text('explorer-selection','No selection');text('explorer-breadcrumb','');text('explorer-reference','');text('explorer-tags','');$('explorer-attributes').replaceChildren();
  $('explorer-properties').replaceChildren(element('p','empty','Select an instance to inspect its properties.'));
  for(const id of ['explorer-property-refresh','explorer-copy-reference','explorer-copy-path'])$(id).disabled=true;
  $('explorer-source').hidden=true;
  $('explorer-add-attribute').hidden=true;$('explorer-add-attribute').reset();
 }
 function reset(){
  epoch++;readSequence++;for(const controller of pending)controller.abort();pending.clear();
  const uncertain=writing;writing=false;$('explorer-cancel').disabled=false;model.reset();windowStart=0;searching=false;clearSelection();renderTree();
  text('explorer-edit-notice',uncertain?'Reader changed during an edit; its outcome is unknown. Do not retry automatically.':'');
  $('explorer-clear-search').hidden=true;
 }
 function renderTree(){
  const rows=model.visible(),start=Math.min(windowStart,Math.max(0,rows.length-300));tree.replaceChildren();
  if(!rows.length)tree.append(element('p','empty',binding?'No instances loaded. Refresh or search the current reader.':'Connect a matching reader to browse.'));
  if(start){const before=element('button','explorer-load-more',`Show previous ${Math.min(300,start)} rows`);before.type='button';before.dataset.window='previous';tree.append(before);}
  for(const {item,depth}of rows.slice(start,start+300)){
   const row=element('div','explorer-tree-row');row.setAttribute('role','treeitem');row.setAttribute('aria-level',String(depth+1));row.setAttribute('aria-selected',String(selected===item.id));row.dataset.rowId=item.id;row.style.paddingLeft=(depth*16+8)+'px';
   const expandable=item.hasChildren===true||model.children.has(item.id);
   if(expandable)row.setAttribute('aria-expanded',String(model.expanded.has(item.id)));
   const expand=element('button','explorer-expand',expandable?(model.expanded.has(item.id)?'▾':'▸'):'·');expand.type='button';expand.dataset.expand=item.id;expand.disabled=!expandable;expand.setAttribute('aria-label',(model.expanded.has(item.id)?'Collapse ':'Expand ')+item.name);
   const button=element('button','explorer-node-label');button.type='button';button.dataset.nodeId=item.id;button.tabIndex=selected===item.id||!selected&&item.id===rows[0]?.item.id?0:-1;
   const icon=element('span','explorer-object-icon');icon.dataset.class=item.className;icon.setAttribute('aria-hidden','true');
   button.append(icon,element('span','explorer-node-name',item.name??'Unnamed'),element('span','explorer-node-class',item.className??''));row.append(expand,button);tree.append(row);
   const page=model.pages.get(item.id);
   if(model.expanded.has(item.id)&&page?.hasMore){const more=element('button','explorer-load-more','Load more children');more.type='button';more.dataset.more=item.id;tree.append(more);}
  }
  if(start+300<rows.length){const next=element('button','explorer-load-more',`Show next ${Math.min(300,rows.length-start-300)} rows`);next.type='button';next.dataset.window='next';tree.append(next);}
  text('explorer-cache-count',`${model.nodes.size} instances loaded · ${rows.length} visible in hierarchy`);
  $('explorer-root-more').hidden=!model.pages.get(null)?.hasMore;
 }
 async function load(parent=null,append=false){
  const sequence=++readSequence,generation=epoch;
  text('explorer-tree-notice','Loading hierarchy…');
  try{
   const page=model.pages.get(parent),args=searching&&parent===null?{view:'search',query:$('explorer-query').value,...($('explorer-class').value?{className:$('explorer-class').value}:{})}:{view:parent===null?'roots':'children',...(parent?{target:{id:parent}}:{})};
   const result=await request({...args,offset:append?page?.nextOffset??0:0,limit:50});
   if(generation!==epoch||sequence!==readSequence)return;
   model.merge(parent,result,append);renderTree();
   text('explorer-tree-notice',`${result.items?.length??0} returned.${result.partial?' Partial observation.':''}${result.hasMore?' More results available.':''} Observed ${result.observedAt??'now'}; expand to load children.`);
  }catch(error){if(error.name!=='AbortError'&&generation===epoch)text('explorer-tree-notice',error.message);}
 }
 async function expand(id){
  if(model.expanded.has(id)){model.expanded.delete(id);renderTree();return;}
  model.expanded.add(id);renderTree();if(!model.children.has(id))await load(id);
 }
 function review(row,input,kind='property',customName,override){
  if(!selected||writing)return;
  try{
   const value=override??parseEditorValue(row.type,input.value,row.value?.value?.enum),name=customName??row.name;
   draft={binding:{...binding},target:{id:selected},field:{kind,name},expected:row.value,value,schemaVersion:1,requestId:window.crypto.randomUUID()};
   text('explorer-confirm-target',`${properties?.target?.path??model.nodes.get(selected)?.path??selected} · ${name}`);
   text('explorer-confirm-values',pretty({expected:row.value,requested:value}));$('explorer-confirm-check').checked=false;$('explorer-apply').disabled=true;$('explorer-confirm').showModal();
  }catch(error){text('explorer-edit-notice',error.message);}
 }
 function renderProperties(){
  if(!properties)return;
  const filter=$('explorer-property-filter').value.toLowerCase();$('explorer-properties').replaceChildren();$('explorer-attributes').replaceChildren();
  const groups=new Map();
  function add(row,kind){
   if(!row||typeof row.name!=='string'||filter&&!row.name.toLowerCase().includes(filter))return;
   const category=kind==='attribute'?'Attributes':row.category??'Other';let section=groups.get(category);
   if(!section){section=element('details','explorer-property-group');section.open=true;section.append(element('summary','',category));groups.set(category,section);$(kind==='attribute'?'explorer-attributes':'explorer-properties').append(section);}
   const entry=element('div','explorer-property-row'),label=element('label','',row.name);entry.append(label);
   const editable=properties.writeEnabled===true&&row.writable===true&&row.value&&!row.error&&!row.truncated&&!row.redacted&&['string','number','boolean','Color3','Vector2','Vector3','UDim','UDim2','EnumItem'].includes(row.type);
   if(editable){
    const input=element(row.type==='boolean'||row.type==='EnumItem'?'select':row.type==='string'?'textarea':'input');input.dataset.editorName=row.name;input.dataset.editorKind=kind;input.name='explorer-'+kind+'-'+row.name;input.id='ex-property-'+kind+'-'+row.name;label.htmlFor=input.id;input.autocomplete='off';
    if(row.type==='boolean'){for(const value of ['true','false'])input.append(new Option(value,value));input.value=String(row.value.value);}
    else if(row.type==='EnumItem'){for(const option of row.options??[])input.append(new Option(typeof option==='string'?option:option.name,typeof option==='string'?option:option.name));input.value=row.value.value.name;}
    else input.value=row.type==='string'?row.value.value:typeof row.value.value==='object'?JSON.stringify(row.value.value):String(row.value.value);
    const button=element('button','', 'Edit');button.type='button';button.dataset.editName=row.name;button.addEventListener('click',()=>review(row,input,kind));
    const actions=element('span','explorer-property-actions');actions.append(button);
    if(kind==='attribute'){const remove=element('button','','Remove');remove.type='button';remove.setAttribute('aria-label','Remove attribute '+row.name);remove.addEventListener('click',()=>review(row,null,kind,undefined,{type:'nil',value:null}));actions.append(remove);}
    entry.append(input,actions);
   }else{entry.append(element('span','explorer-property-readonly',row.error??format(row.value)),element('span','explorer-property-readonly',row.error?'Unavailable':'Read only'));}
   section.append(entry);
  }
  for(const row of (properties.properties??[]).slice(0,128))add(row,'property');
  for(const row of (properties.attributes??[]).slice(0,64))add(row,'attribute');
  if(!groups.size)$('explorer-properties').append(element('p','empty','No matching readable properties.'));
  $('explorer-tags').replaceChildren(...(properties.tags??[]).slice(0,64).map(tag=>element('span','',tag)));
  $('explorer-add-attribute').hidden=properties.writeEnabled!==true;
 }
 async function select(id){
  if(!model.nodes.has(id))return;
  selected=id;const sequence=++selectionSequence,generation=epoch;closeDraft();renderTree();
  const item=model.nodes.get(id);text('explorer-selection',item.name??'Instance');text('explorer-breadcrumb',item.path??id);text('explorer-property-notice','Reading current properties…');
  $('explorer-properties').replaceChildren(element('p','empty','Loading properties…'));$('explorer-attributes').replaceChildren();
  try{
   const result=await request({view:'properties',target:{id},offset:0,limit:100});if(sequence!==selectionSequence||generation!==epoch)return;
   properties=result;
   if(result.target?.id===id){model.nodes.set(id,{...model.nodes.get(id),...result.target});text('explorer-selection',result.target.name??item.name);text('explorer-breadcrumb',result.target.path??item.path??id);renderTree();}
   renderProperties();
   text('explorer-mode',result.writeEnabled?'Typed edits available':'Read only');
   text('explorer-property-notice',`Observed ${result.observedAt??'now'}.${result.partial?' Partial values.':''} ${result.writeEnabled?'Edits require review and confirmation.':'Reader write opt-in is disabled.'}`);
   for(const name of ['explorer-property-refresh','explorer-copy-reference','explorer-copy-path'])$(name).disabled=false;
   $('explorer-source').hidden=!/(?:LocalScript|ModuleScript|Script)$/.test(item.className??'');
   text('explorer-reference',pretty({read:{binding,view:'properties',target:{id}},observation:result}));
  }catch(error){if(error.name!=='AbortError'&&generation===epoch&&sequence===selectionSequence){text('explorer-property-notice',error.message);$('explorer-properties').replaceChildren(element('p','empty','Values unavailable. Refresh the hierarchy if this reference expired.'));}}
 }
 listen(tree,'click',event=>{
  const node=event.target.closest('[data-node-id]'),toggle=event.target.closest('[data-expand]'),more=event.target.closest('[data-more]'),windowButton=event.target.closest('[data-window]');
  if(node)void select(node.dataset.nodeId);else if(toggle)void expand(toggle.dataset.expand);else if(more)void load(more.dataset.more,true);else if(windowButton){windowStart=Math.max(0,windowStart+(windowButton.dataset.window==='next'?300:-300));renderTree();}
 });
 listen(tree,'keydown',event=>{
  const button=event.target.closest('[data-node-id]');if(!button)return;const id=button.dataset.nodeId;
  if(!['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;event.preventDefault();
  const buttons=[...tree.querySelectorAll('[data-node-id]')],index=buttons.indexOf(button);
  if(event.key==='ArrowRight'){if(!model.expanded.has(id))void expand(id);else buttons[index+1]?.focus();}
  else if(event.key==='ArrowLeft'){if(model.expanded.has(id))void expand(id);else tree.querySelector(`[data-node-id="${window.CSS.escape(model.parents.get(id)??'')}"]`)?.focus();}
  else buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowDown'?1:-1)))]?.focus();
 });
 listen($('explorer-refresh'),'click',()=>{if(!binding)return;model.reset();clearSelection();searching=false;windowStart=0;renderTree();void load();});
 listen($('explorer-root-more'),'click',()=>void load(null,true));
 listen($('explorer-search'),'submit',event=>{event.preventDefault();if(!binding)return;model.reset();clearSelection();windowStart=0;searching=true;$('explorer-clear-search').hidden=false;renderTree();void load();});
 listen($('explorer-clear-search'),'click',()=>{searching=false;model.reset();clearSelection();$('explorer-clear-search').hidden=true;renderTree();void load();});
 listen($('explorer-property-filter'),'input',renderProperties);
 listen($('explorer-add-attribute'),'submit',event=>{
  event.preventDefault();if(!selected||properties?.writeEnabled!==true)return;
  const name=$('explorer-attribute-name').value.trim();if(!name)return;
  if((properties.attributes??[]).some(row=>row.name===name)){text('explorer-edit-notice','That attribute already exists. Use its current value editor.');return;}
  review({name,type:$('explorer-attribute-type').value,value:{type:'nil',value:null}},$('explorer-attribute-value'),'attribute');
 });
 listen($('explorer-property-refresh'),'click',()=>{if(selected)void select(selected);});
 listen($('explorer-copy-reference'),'click',()=>{if(selected)void window.navigator.clipboard.writeText(pretty({binding,target:{id:selected}})).catch(()=>text('explorer-property-notice','Copy unavailable; select the structured evidence below.'));});
 listen($('explorer-copy-path'),'click',()=>{if(selected)void window.navigator.clipboard.writeText(properties?.target?.path??model.nodes.get(selected)?.path??selected).catch(()=>text('explorer-property-notice','Copy unavailable.'));});
 listen($('explorer-source'),'click',()=>{if(selected)onSource({...model.nodes.get(selected)});});
 listen($('explorer-confirm-check'),'change',()=>{$('explorer-apply').disabled=!$('explorer-confirm-check').checked||writing;});
 listen($('explorer-cancel'),'click',closeDraft);listen($('explorer-confirm'),'cancel',()=>{draft=null;});
 listen($('explorer-confirm-form'),'submit',async event=>{
  event.preventDefault();if(!draft||writing||!$('explorer-confirm-check').checked||!sameBinding(draft.binding,binding))return;
  const edit=draft,generation=epoch;writing=true;$('explorer-apply').disabled=true;$('explorer-cancel').disabled=true;text('explorer-edit-notice','Applying one confirmed edit…');
  try{
   const result=await request({...edit,confirm:true},true);if(generation!==epoch)return;
   text('explorer-edit-notice',`${result.status}: ${result.status==='unknown_outcome'?'The edit may have applied. Do not retry automatically. ':''}${result.message??result.notice??''}\nRequest ${edit.requestId}`);closeDraft();
   if(result.status==='applied'||result.status==='applied_but_diverged'||result.status==='conflict')await select(edit.target.id);
  }catch(error){if(generation===epoch){text('explorer-edit-notice',`unknown_outcome: ${error.message}. Do not retry automatically. Request ${edit.requestId}`);closeDraft();}}
  finally{if(generation===epoch){writing=false;$('explorer-cancel').disabled=false;}}
 });
 clearSelection();renderTree();
 return {
  setBinding(next){if(sameBinding(binding,next))return;reset();binding=next?{...next}:null;text('explorer-mode',binding?'Current reader':'No client');if(active&&binding)void load();},
  activate(){active=true;if(binding&&!model.nodes.size)void load();},
  deactivate(){active=false;},
  dispose(){reset();lifetime.abort();},
 };
}
