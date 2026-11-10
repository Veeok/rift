// Reuse the existing MCP registration as the single catalog; do not duplicate its contracts.
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import type {Bridge} from './bridge.js';
import type {DecompileService} from './decompile.js';
import type {ExecService} from './exec.js';
import {registerTools} from './tools.js';

export interface CatalogTool {name:string;config:Record<string,unknown>;schema:z.ZodType;handler:(args:any)=>Promise<CallToolResult>}
export function createCatalog(bridge:Bridge,decompiler:DecompileService,exec:ExecService):Map<string,CatalogTool>{
	const tools=new Map<string,CatalogTool>();
	const registrar={registerTool(name:string,config:Record<string,unknown>,handler:(args:any)=>Promise<CallToolResult>){
		const schema=z.object(config.inputSchema as Record<string,z.ZodType>);
		tools.set(name,{name,config,schema,handler});
	}};
	registerTools(registrar as unknown as McpServer,bridge,decompiler,exec);
	return tools;
}
export function catalogJson(catalog:Map<string,CatalogTool>){
	return [...catalog.values()].map(t=>({name:t.name,title:t.config.title,description:t.config.description,annotations:t.config.annotations,inputSchema:z.toJSONSchema(t.schema,{target:'draft-7'})}));
}
