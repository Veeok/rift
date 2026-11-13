// Synthetic stdio MCP server for a lead-operated actual Code Mode transport.
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {toolResult,boundedToolResult} from '../dist/tool-result.js';
import {readScriptResult} from '../dist/read-script-result.js';

const server=new Server({name:'m11-contract-fixture',version:'1'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'contract_fixture',description:'Synthetic inspection, source and typed media results; no Rift connection.',inputSchema:{type:'object',properties:{state:{type:'string',enum:['inspection','partial','bounded','source','empty','pending','error','image']}},required:['state']}}]}));
server.setRequestHandler(CallToolRequestSchema,async({params})=>{
 const state=params.arguments?.state;
 if(state==='source')return readScriptResult({ok:true,status:'complete',script:{id:'fixture'},source:{nextStartLine:3}},'-- Ω\r\nreturn true\n');
 if(state==='empty')return readScriptResult({ok:true,status:'complete'},'');
 if(state==='pending')return readScriptResult({ok:true,status:'pending',jobId:'fixture-job'});
 if(state==='error')return readScriptResult({ok:false,error:{code:'fixture_error',message:'synthetic'}},undefined,true);
 if(state==='image')return toolResult({ok:true}, {content:[{type:'text',text:'{"ok":true}'},{type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII='}]});
 if(state==='partial')return toolResult({ok:true,partial:true,items:[{id:'good'},{error:{code:'stale_object_id'}}]});
 if(state==='bounded')return boundedToolResult({offset:0,items:Array.from({length:30},(_,i)=>({id:i,value:'Ω'.repeat(20)}))},1400);
 if(state==='inspection')return toolResult({ok:true,session:{connectionId:'synthetic'},items:[{id:'node',properties:{Position:{t:'Vector3',x:1,y:2,z:3}}}],nextOffset:null});
 return toolResult({ok:false,error:{code:'bad_args'}},{isError:true});
});
await server.connect(new StdioServerTransport());
process.stdin.on('end',()=>void server.close());
