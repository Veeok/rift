import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema,type CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {ServiceClient} from './service-client.js';
import {SHARED_INSTRUCTIONS} from './instructions.js';

export async function startSharedMcp(){
	const client=new ServiceClient();
	const server=new Server({name:'Rift',version:'0.3.0'},{capabilities:{tools:{}},instructions:SHARED_INSTRUCTIONS});
	server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:(await client.request('/api/catalog')).tools}));
	server.setRequestHandler(CallToolRequestSchema,async request=>{
		try{return await client.call(request.params.name,request.params.arguments??{}) as CallToolResult;}
		catch(e){return{isError:true,content:[{type:'text',text:JSON.stringify({ok:false,error:{code:'service_unavailable',message:e instanceof Error?e.message:'Rift service unavailable.'}})}]};}
	});
	await server.connect(new StdioServerTransport());
	process.stdin.on('end',()=>void server.close());return server;
}
