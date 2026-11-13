// Real MCP -> shared service -> WebSocket reader boundary with a deterministic synthetic world.
// This proves integration/transport, not actual Roblox-reader behavior (covered separately).
import net from 'node:net';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {startService} from '../dist/service.js';
import {catalogJson} from '../dist/catalog.js';
import {connectReader} from './client-fixture.mjs';

const token='m11-codemode-only-synthetic-credential-00000000';
const session='a11b22c3-0000-4000-8000-000000000001';
const stamp='2026-11-13T00:00:00.000Z';
const root={t:'Instance',id:'a11b22c3:root',name:'Workspace',className:'Workspace',path:'game.Workspace'};
const children=['Camera','Scene','Model'].map((name,i)=>({t:'Instance',id:'a11b22c3:'+i,name,className:i===0?'Camera':'Model',path:'game.Workspace.'+name}));
const script={t:'Instance',id:'a11b22c3:script',name:'Source',className:'LocalScript',path:'game.ReplicatedStorage.Source'};
const source='-- M11 source fixture\r\nlocal marker = "needle Ω"\r\nreturn marker\r\n';
const inspection=object=>({object,parentId:root.id,properties:{Name:object.name,ClassName:object.className,Parent:root,Position:{t:'Vector3',x:1,y:2,z:3}},errors:[]});
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const readerPort=await port(),service=await startService({port:readerPort,apiPort:await port(),token,tokenFile:'unused',tokenError:null,allowExec:false,logLevel:'error'});
const reader=await connectReader({port:readerPort,token,session,build:service.status().build.expectedReaderBuild,capabilities:['inspection_v1','getscripts','decompile','getscripthash'],handler:({op,args})=>{
 if(op==='get_subtree')return {observedAt:stamp,root,items:[{...inspection(root),depth:0},...children.map(c=>({...inspection(c),depth:1}))],offset:0,visited:4,returned:4,hasMore:false,partial:false,limitsReached:{},omissions:{}};
 if(op==='inspect_instances')return {observedAt:stamp,items:args.targets.map((ref,index)=>({index:index+1,ref,...(ref.path?.includes('Missing')?{error:{code:'not_found',message:'synthetic streamed object'}}:inspection(children[index%children.length]))})),returned:args.targets.length,partial:args.targets.some(r=>r.path?.includes('Missing')),partialReason:args.targets.some(r=>r.path?.includes('Missing'))?'item_errors':null};
 if(op==='list_children'||op==='search_instances')return {observedAt:stamp,target:root,root,items:children,offset:0,total:3,visited:4,hasMore:false,partial:false};
 if(op==='inspect_instance')return {...inspection(args.target?.id===script.id?script:children.find(c=>c.id===args.target?.id)??children[0]),observedAt:stamp,pathInfo:{unique:true,segments:['Workspace','Camera']}};
 if(op==='list_scripts')return {observedAt:stamp,items:[{...script,loaded:true,running:true}],total:1,hasMore:false,cache:{builtObservedAt:stamp}};
 if(op==='script_info')return {observedAt:stamp,object:script,hash:'fixture-bytecode-hash',decompileSupport:'supported'};
 if(op==='decompile')return {observedAt:stamp,source,hash:'fixture-bytecode-hash'};
 if(op==='status')return {};
 throw new Error('Unsupported synthetic operation: '+op);
}});
const server=new Server({name:'m11-integrated-fixture',version:'1'},{capabilities:{tools:{}}});
const names=new Set(['get_status','list_children','inspect_instance','search_instances','get_subtree','inspect_instances','discover_source','get_source_excerpt','read_script']);
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:catalogJson(service.catalog).filter(t=>names.has(t.name))}));
server.setRequestHandler(CallToolRequestSchema,async({params})=>service.call(params.name,params.arguments??{}));
let stopping=false;async function stop(){if(stopping)return;stopping=true;await reader.close();await service.stop();await server.close();}
await server.connect(new StdioServerTransport());
process.stdin.on('end',()=>void stop());
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void stop());
