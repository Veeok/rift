// Synthetic MCP transport for the actual OpenCode Code Mode entry point. No Rift service/client access.
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {pathToFileURL} from 'node:url';

export const source='-- synthetic Code Mode regression\r\nlocal message = "metadata is not source — Ω"\nreturn message\n';
export const metadata={ok:true,tool:'read_script',status:'complete',script:{id:'synthetic:script'},source:{startLine:4,endLine:7,totalLines:9,nextStartLine:8},partial:true,partialReason:'source_limit',sourceTruncated:true,lossyText:false};
const image={type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII='};
const makeResult=process.env.RIFT_CONTRACT_DIST
	?(await import(pathToFileURL(process.env.RIFT_CONTRACT_DIST+'/read-script-result.js').href)).readScriptResult
	:(metadata,sourceText,isError=false)=>({...isError?{isError:true}:{},content:[{type:'text',text:JSON.stringify(metadata)},...sourceText===undefined?[]:[{type:'text',text:sourceText}]]});
const server=new Server({name:'Rift contract fixture',version:'1'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[
 {name:'read_script',description:'Synthetic Rift read_script contract; never contacts a client.',inputSchema:{type:'object',properties:{state:{type:'string',enum:['complete','empty','pending','error']}},additionalProperties:false}},
 {name:'image_fixture',description:'Synthetic one-pixel typed MCP image; no screen capture.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
]}));
server.setRequestHandler(CallToolRequestSchema,async request=>{
 if(request.params.name==='image_fixture')return {content:[{type:'text',text:JSON.stringify({synthetic:true,captureId:'fixture-only',callerSessionId:request.params._meta?.['ai.opencode/sessionID']??null})},image]};
 if(request.params.name!=='read_script')return {isError:true,content:[{type:'text',text:'Unknown synthetic tool'}]};
 const state=request.params.arguments?.state??'complete';
 if(state==='pending')return makeResult({ok:true,tool:'read_script',status:'pending',jobId:'fixture-pending',pollAfterMs:3000});
 if(state==='error')return makeResult({ok:false,tool:'read_script',error:{code:'fixture_error',message:'Synthetic reader failure',retryable:true}},undefined,true);
 if(state==='empty')return makeResult({...metadata,partial:false,partialReason:null,sourceTruncated:false,source:{startLine:1,endLine:0,totalLines:0,nextStartLine:null,longLineTruncated:false}},'');
 return makeResult(metadata,source);
});
await server.connect(new StdioServerTransport());
process.stdin.on('end',()=>void server.close());
