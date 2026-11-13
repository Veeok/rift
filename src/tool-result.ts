import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';

type Options = {sourceText?:string,isError?:boolean,content?:CallToolResult['content']};

// Deliberately exclude arbitrary payloads: aliases retain every original field.
const metadataKey = /^(ok|tool|status|id|session|sessionId|connectionId|readerSession|placeId|jobId|scriptId|observedAt|receivedAt|serviceBuild|serviceStartedAt|revision|offset|nextOffset|hasMore|returned|visited|total|count|omittedCount|partial|partialReason|error|errors|limits|limitsReached|omissions|coverage|scope|source|complete|completeness|notice|pollAfterMs)$/;
const bulkKeys = new Set(['items','data','properties','object','sourceText']);
function compact(value:unknown):unknown {
	if (Array.isArray(value)) return value.map(compact);
	if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key])=>!bulkKeys.has(key)).map(([key,item])=>[key,compact(item)]));
	return value;
}

/** Legacy aliases and text remain complete; metadata is a compact projection. */
export function toolResult(metadata:Record<string,unknown>, options:Options = {}):CallToolResult {
	const hasSource = Object.hasOwn(options,'sourceText');
	const projection = Object.fromEntries(Object.entries(metadata).filter(([key,value])=>metadataKey.test(key) && (key !== 'source' || (value !== null && typeof value === 'object' && !Array.isArray(value)))).map(([key,value])=>[key,compact(value)]));
	return {
		...(options.isError ? {isError:true} : {}),
		structuredContent:{...metadata,metadata:projection,...(hasSource ? {sourceText:options.sourceText ?? null} : {})},
		content:options.content ?? [{type:'text',text:JSON.stringify(metadata)},...(options.sourceText === undefined ? [] : [{type:'text' as const,text:options.sourceText}])],
	};
}

/** Budget the complete JSON envelope in UTF-8 bytes, not UTF-16 characters.
 * Only a trailing suffix of items is omitted; all other fields, including errors,
 * are retained. Throws if even the empty result cannot fit. Cursor assumes offset
 * based paging. Callers with other pagination schemes must not use this helper. */
export function boundedToolResult(metadata:Record<string,unknown>, maxBytes:number):CallToolResult {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('maxBytes must be a positive safe integer');
	const size = (r:CallToolResult) => Buffer.byteLength(JSON.stringify(r),'utf8');
	const original = toolResult(metadata);
	if (size(original) <= maxBytes) return original;
	if (!Array.isArray(metadata.items)) throw new RangeError('response exceeds byte budget without an items array');
	const items:unknown[] = metadata.items;
	const offset = typeof metadata.offset === 'number' && Number.isSafeInteger(metadata.offset) && metadata.offset >= 0 ? metadata.offset : 0;
	const priorOmitted = typeof metadata.omittedCount === 'number' && Number.isSafeInteger(metadata.omittedCount) && metadata.omittedCount >= 0 ? metadata.omittedCount : 0;
	const make = (count:number) => toolResult({...metadata,...(metadata.partialReason !== undefined ? {previousPartialReason:metadata.partialReason} : {}),items:items.slice(0,count),returned:count,omittedCount:priorOmitted+items.length-count,hasMore:true,nextOffset:offset+count,partial:true,partialReason:'response_size'});
	if (size(make(0)) > maxBytes) throw new RangeError('response metadata exceeds byte budget');
	let low=0, high=items.length-1;
	while(low<high){const mid=Math.ceil((low+high)/2);if(size(make(mid))<=maxBytes)low=mid;else high=mid-1;}
	if (low === 0 && items.length > 0) throw new RangeError('first item exceeds byte budget');
	return make(low);
}
