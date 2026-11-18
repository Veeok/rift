const allowedTools=new Set(['select_session','get_logs','search_source','read_script','search_instances','inspect_instance','list_windows','preview_capture']);
const preferenceKeys=['schemaVersion','preload','memory','virtual','unlocker'];
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function message(value,fallback='Local Rift request failed.'){
 if(typeof value==='string')return value.slice(0,1000);
 if(typeof value?.message==='string')return [value.message,value.recovery].filter(x=>typeof x==='string').join(' · ').slice(0,1000);
 return fallback;
}
function methodFor(path,hasBody){
 if(typeof path!=='string')throw new TypeError('Invalid local API route.');
 if(['/api/status','/api/doctor'].includes(path)&&!hasBody)return 'GET';
 if(path==='/api/login'&&hasBody)return 'POST';
 if(path==='/api/protection')return hasBody?'PATCH':'GET';
 if(['/api/explorer/read','/api/explorer/write'].includes(path)&&hasBody)return 'POST';
 const tool=path.match(/^\/api\/tools\/([a-z_]+)$/);
 if(tool&&hasBody&&allowedTools.has(tool[1]))return 'POST';
 const capture=path.match(/^\/api\/captures\/([A-Za-z0-9._%~-]+)$/);
 if(capture&&!hasBody){
  const id=decodeURIComponent(capture[1]);
  if(id&&id.length<=256&&id!=='.'&&id!=='..'&&!/[\/\\]/.test(id))return 'GET';
 }
 throw new TypeError('Unsupported local API route or method.');
}
export function decodeToolResult(result,{includeSource=false}={}){
 if(!record(result))throw new Error('Invalid tool response.');
 const texts=Array.isArray(result.content)?result.content.filter(x=>x?.type==='text'&&typeof x.text==='string'):[];
 let data=result.structuredContent;
 if(!record(data)){
  try{data=JSON.parse(texts[0]?.text??'null');}catch{data=texts[0]?.text;}
 }
 const error=data?.error??data?.metadata?.error;
 if(result.isError||error)throw new Error(message(error??data,'Tool request failed.'));
 if(data==null)throw new Error('Missing tool response data.');
 if(!includeSource)return data;
 const metadata=record(data.metadata)?data.metadata:data;
 let sourceText=null;
 if(Object.hasOwn(data,'sourceText'))sourceText=data.sourceText;
 else if(texts.length===2)sourceText=texts[1].text;
 else if(texts.length>2)throw new Error('Ambiguous legacy source response.');
 if(sourceText!==null&&typeof sourceText!=='string')throw new Error('Invalid source response.');
 return {metadata,sourceText,textBlocks:sourceText===null?[]:[sourceText]};
}
export function createDashboardClient({fetchImpl=globalThis.fetch}={}){
 if(typeof fetchImpl!=='function')throw new TypeError('Fetch transport is unavailable.');
 async function request(path,body,{signal,blob=false,method}={}){
  const expected=methodFor(path,body!==undefined);
  if(method!==undefined&&method!==expected)throw new TypeError('Unsupported local API method.');
  if(blob&&!path.startsWith('/api/captures/'))throw new TypeError('Invalid image response route.');
  let encoded;
  if(body!==undefined){
   if(!record(body))throw new TypeError('Request body must be a JSON object.');
   try{encoded=JSON.stringify(body);}catch{throw new TypeError('Invalid JSON request body.');}
   if(new TextEncoder().encode(encoded).byteLength>8192)throw new RangeError('Request body exceeds 8 KiB.');
  }
  const response=await fetchImpl(path,{method:expected,credentials:'same-origin',cache:'no-store',signal,
   headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:encoded})});
  if(blob&&response.ok)return response.blob();
  let data;try{data=await response.json();}catch{throw Object.assign(new Error('Invalid local API response.'),{status:response.status});}
  if(!response.ok)throw Object.assign(new Error(message(data?.error??data)),{status:response.status,retryable:response.status>=500||[408,429].includes(response.status)});
  return data;
 }
 return Object.freeze({
  request,
  async login(token){
   if(typeof token!=='string'||!token.length||token.length>4096)throw new TypeError('Enter a valid local token.');
   return request('/api/login',{token});
  },
  status:signal=>request('/api/status',undefined,{signal}),
  doctor:signal=>request('/api/doctor',undefined,{signal}),
  async tool(name,args={},options={}){
   if(!allowedTools.has(name))throw new TypeError('This tool is unavailable from the dashboard.');
   return decodeToolResult(await request('/api/tools/'+name,args,{signal:options.signal}),options);
  },
  capture:(id,signal)=>request('/api/captures/'+encodeURIComponent(id),undefined,{signal,blob:true}),
  async protection(input,signal){
   if(input!==undefined&&(!record(input)||Object.keys(input).length!==5||preferenceKeys.some(key=>!Object.hasOwn(input,key))
    ||input.schemaVersion!==1||preferenceKeys.slice(1).some(key=>typeof input[key]!=='boolean')))throw new TypeError('Invalid protection preferences.');
   return request('/api/protection',input,{signal});
  },
  async explorerRead(input,signal){return decodeToolResult(await request('/api/explorer/read',input,{signal}));},
  async explorerWrite(input,signal){
   const result=await request('/api/explorer/write',input,{signal});
   if(result.structuredContent?.status==='unknown_outcome')return result.structuredContent;
   return decodeToolResult(result);
  },
 });
}
