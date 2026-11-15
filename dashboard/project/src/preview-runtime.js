const origins=new Set(['http://127.0.0.2:41734','http://127.0.0.2:41735']);
export function createPreviewTransport({origin,fetchImpl=globalThis.fetch}){
 return async(path,options={})=>{
  if(!origins.has(origin))throw new Error('Synthetic preview refuses this origin. It cannot connect to a live service.');
  if(typeof path!=='string'||!path.startsWith('/api/')||path.includes('..')||path.includes('?')||path.includes('#'))throw new Error('Synthetic preview route refused.');
  if(path==='/api/login'){
   let body;try{body=JSON.parse(options.body);}catch{throw new Error('Synthetic preview accepts only the dummy token preview-only.');}
   if(body?.token!=='preview-only')throw new Error('Never enter a real token here. Use only preview-only.');
  }
  return fetchImpl(path,options);
 };
}
