import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';

// Code Mode otherwise joins the two text blocks and cannot JSON-decode metadata plus source.
export function readScriptResult(metadata:Record<string,unknown>,sourceText?:string,isError=false):CallToolResult {
	return {
		...(isError?{isError:true}:{}),
		structuredContent:{...metadata,metadata,sourceText:sourceText??null},
		content:[{type:'text',text:JSON.stringify(metadata)},...(sourceText===undefined?[]:[{type:'text' as const,text:sourceText}])],
	};
}
