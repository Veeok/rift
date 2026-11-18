import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import Dashboard from '../src/Dashboard.jsx';
import {startDashboard} from '../src/controller.js';
import '../style.css';
const fixture={connection:'c1',mode:'applied',writes:[],reads:[],sources:[],pendingWrites:[],holdWrites:false,names:{g1:'Duplicate'},text:'Original',attributes:{Author:'Fixture'},started:false};window.__explorerFixture=fixture;
const binding=()=>({readerSession:'fixture-session',connectionId:fixture.connection});
const item=(id,name,className='Folder',hasChildren=false)=>({id,name,className,hasChildren,path:'game.'+name});
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status});
const off={schemaVersion:1,preload:false,memory:false,virtual:false,unlocker:false};
const fetchImpl=async(path,options)=>{
 const args=JSON.parse(options.body??'{}');
 if(path==='/api/status')return reply({state:'healthy',session:{id:'fixture-session',connectionId:fixture.connection,name:'Explorer fixture',capabilities:['explorer_v1','explorer_write_v1']},sessions:[],activity:{retainedEvents:0,pendingRequests:0}});
 if(path==='/api/protection')return reply({ok:true,preferences:off,error:null});
 if(path==='/api/tools/get_logs')return reply({structuredContent:{sessionId:'fixture-session',current:true,items:[]}});
 if(path==='/api/explorer/read'){
  fixture.reads.push(args);let result={binding:binding(),view:args.view,schemaVersion:1,writeEnabled:true,items:[],hasMore:false,observedAt:'2026-11-15T12:00:00Z'};
  if(args.view==='roots')result.items=[item('s1','Workspace','Workspace',true),item('s2','Players','Players',true)];
  if(args.view==='children')result.items=[item('g1','Duplicate','TextLabel'),item('g2','Duplicate','Frame'),item('g3','ExampleSource','ModuleScript')];
  if(args.view==='search')result.items=[item('g1','Duplicate','TextLabel')];
  if(args.view==='properties')Object.assign(result,{target:item(args.target.id,fixture.names[args.target.id]??'Duplicate','TextLabel'),properties:[{name:'Name',category:'Identity',type:'string',writable:true,value:{type:'string',value:fixture.names[args.target.id]??'Duplicate'}},{name:'ClassName',category:'Identity',type:'string',writable:false,value:{type:'string',value:'TextLabel'}},{name:'Text',category:'Text',type:'string',writable:true,value:{type:'string',value:fixture.text}},{name:'Visible',category:'Appearance',type:'boolean',writable:true,value:{type:'boolean',value:true}}],attributes:Object.entries(fixture.attributes).map(([name,value])=>({name,type:'string',writable:true,value:{type:'string',value}})),tags:['Sample']});
  return reply({structuredContent:result});
 }
 if(path==='/api/explorer/write'){
  if(fixture.holdWrites){fixture.writes.push(args);return await new Promise(resolve=>fixture.pendingWrites.push(()=>resolve(reply({structuredContent:{ok:true,binding:args.binding,schemaVersion:1,requestId:args.requestId,status:'applied'}}))));}
  fixture.writes.push(args);if(fixture.mode==='applied'){if(args.field.kind==='attribute'){if(args.value.type==='nil')delete fixture.attributes[args.field.name];else fixture.attributes[args.field.name]=args.value.value;}else if(args.field.name==='Text')fixture.text=args.value.value;else if(args.field.name==='Name')fixture.names[args.target.id]=args.value.value;}
  return reply({structuredContent:{ok:true,binding:binding(),schemaVersion:1,requestId:args.requestId,status:fixture.mode,before:args.expected,requested:args.value,actual:{type:'string',value:fixture.text}}});
 }
 if(path==='/api/tools/read_script'){fixture.sources.push(args);return reply({structuredContent:{metadata:{sessionId:'fixture-session',connectionId:fixture.connection,status:'complete',hash:'synthetic-source',source:{nextStartLine:null}},sourceText:'-- Synthetic source fixture; no client code executed.'}});}
 return reply({error:'Unexpected synthetic request '+path},404);
};
flushSync(()=>createRoot(document.getElementById('root')).render(<Dashboard/>));
location.hash='#explorer';window.__stopExplorerFixture=startDashboard({fetchImpl});fixture.started=true;
