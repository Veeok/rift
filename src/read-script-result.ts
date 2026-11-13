import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {toolResult} from './tool-result.js';
import {LIMITS} from './limits.js';

// Code Mode otherwise joins the two text blocks and cannot JSON-decode metadata plus source.
export function readScriptResult(metadata:Record<string,unknown>,sourceText?:string,isError=false):CallToolResult {
	const result = toolResult(metadata,{sourceText,isError});
	result.structuredContent = {...result.structuredContent,metadata};
	return result;
}

// Re-page from the original lines, never cut serialized JSON or silently alter a source block.
export function budgetSourcePage(make:(maxChars:number)=>{metadata:Record<string,unknown>;sourceText:string},maxChars:number,maxBytes=LIMITS.maxToolResponseChars){
	const fits=(page:ReturnType<typeof make>)=>Buffer.byteLength(JSON.stringify(readScriptResult(page.metadata,page.sourceText)),'utf8')<=maxBytes;
	const full=make(maxChars);if(fits(full))return full;
	let low=1,high=maxChars-1,best:ReturnType<typeof make>|undefined;
	while(low<=high){const mid=Math.floor((low+high)/2),page=make(mid);if(fits(page)){best=page;low=mid+1;}else high=mid-1;}
	if(!best)throw new RangeError('Source metadata exceeds the response byte budget; request fewer properties or shorter identities.');
	return best;
}
