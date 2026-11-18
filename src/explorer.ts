import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import {Bridge,BridgeError} from './bridge.js';
import {toolResult} from './tool-result.js';

const text=(n:number)=>z.string().min(1).max(n).refine(value=>!/[\x00-\x1f\x7f]/.test(value),'Control characters are not allowed');
const binding=z.strictObject({readerSession:text(128),connectionId:text(128)});
const target=z.strictObject({id:text(64)});
const numbers=(n:number)=>z.array(z.number().finite()).length(n);
export const explorerValueSchema=z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('string'),value:z.string().max(2000)}),
 z.strictObject({type:z.literal('boolean'),value:z.boolean()}),
 z.strictObject({type:z.literal('number'),value:z.number().finite()}),
 z.strictObject({type:z.literal('nil'),value:z.null().optional()}),
 z.strictObject({type:z.literal('Color3'),value:numbers(3)}),
 z.strictObject({type:z.literal('Vector2'),value:numbers(2)}),
 z.strictObject({type:z.literal('Vector3'),value:numbers(3)}),
 z.strictObject({type:z.literal('UDim'),value:numbers(2)}),
 z.strictObject({type:z.literal('UDim2'),value:numbers(4)}),
 z.strictObject({type:z.literal('EnumItem'),value:z.strictObject({enum:text(100),name:text(100)})}),
]);
export const explorerReadSchema=z.strictObject({binding,view:z.enum(['roots','children','properties','schema','search']),target:target.optional(),offset:z.number().int().min(0).max(10000).default(0),limit:z.number().int().min(1).max(100).default(50),query:z.string().max(200).optional(),className:text(100).optional()}).refine(args=>!['children','properties'].includes(args.view)||args.target!==undefined,'This view requires a current instance ID.');
export const explorerWriteSchema=z.strictObject({binding,requestId:text(64).refine(value=>value.length>=8),target,field:z.strictObject({kind:z.enum(['property','attribute']),name:text(100)}),expected:explorerValueSchema,value:explorerValueSchema,schemaVersion:z.literal(1),confirm:z.literal(true)});

export function registerExplorerTools(server:McpServer,bridge:Bridge,allowWrites:boolean){
 const run=async(write:boolean,input:unknown,signal?:AbortSignal):Promise<CallToolResult>=>{
  const tool=write?'explorer_write':'explorer_read';let args:any,dispatched=false;
  try{
   args=(write?explorerWriteSchema:explorerReadSchema).parse(input);
   if(signal?.aborted)throw new Error('Caller cancelled before dispatch.');
   const reader=bridge.reader;
   if(!reader||reader.session!==args.binding.readerSession||reader.connectionId!==args.binding.connectionId)throw new Error('Stale explorer binding. Refresh the tree before using its references.');
   if(!reader.capabilities.includes('explorer_v1'))throw new Error('Reader lacks explorer_v1; manually load the matching reader.');
   if(write&&(!allowWrites||!reader.capabilities.includes('explorer_write_v1')))throw new Error('Explorer writes are disabled. The local reader must explicitly opt in.');
   dispatched=true;
   const raw=await bridge.request(tool,args,{deadlineMs:write?10000:15000}) as Record<string,unknown>;
   const current=bridge.reader;
   if(!current||reader.session!==current.session||reader.connectionId!==current.connectionId)throw new BridgeError('disconnected','Reader changed during explorer operation.');
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid explorer response.');
   const reported=raw.binding as Record<string,unknown>|undefined;
   if(!reported||reported.readerSession!==args.binding.readerSession||reported.connectionId!==args.binding.connectionId)throw new Error('Explorer response binding does not match the requested observation.');
   const result={...raw,...(!write?{writeEnabled:allowWrites&&reader.capabilities.includes('explorer_write_v1')&&raw.writeEnabled===true}:{}),ok:true,tool,binding:args.binding,receivedAt:new Date().toISOString()};
   const output=toolResult(result);
   if(Buffer.byteLength(JSON.stringify(output),'utf8')>120000)throw new BridgeError('too_large','Explorer response exceeds the bounded envelope.');
   return output;
  }catch(error){
   const unknown=write&&dispatched&&!(error instanceof BridgeError&&error.code==='reader_error');
   if(unknown)return toolResult({ok:true,tool,status:'unknown_outcome',requestId:args.requestId,binding:args.binding,notice:'The edit may have applied. Do not create another request or retry automatically; retain this exact request ID.',error:{code:error instanceof BridgeError?error.code:'unknown',message:error instanceof Error?error.message:'Unknown write outcome',retryable:false}});
   return toolResult({ok:false,tool,error:{code:error instanceof z.ZodError?'bad_args':error instanceof BridgeError?error.readerCode??error.code:'explorer_refused',message:error instanceof Error?error.message:'Explorer request refused.',retryable:false}},{isError:true});
  }
 };
 server.registerTool('explorer_read',{title:'Read explorer evidence',description:'Compact typed hierarchy, schema, search or properties for an exact reader binding. Paginated re-observation, not a stable snapshot. Never fetches source or writes.',inputSchema:explorerReadSchema.shape,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},(args,extra)=>run(false,args,extra?.signal));
 if(allowWrites)server.registerTool('explorer_write',{title:'Apply one confirmed typed explorer edit',description:'One allowlisted client property/attribute edit with exact binding, expected-old comparison and request-id deduplication. Requires explicit approval and reader write opt-in. No methods, remotes, source execution or server authority. Unknown outcomes never auto-retry.',inputSchema:explorerWriteSchema.shape,annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:false}},(args,extra)=>run(true,args,extra?.signal));
}
