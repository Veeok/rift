export function createRequestScope(){
 let generation=0,disposed=false,controller=new AbortController();
 const serials=new Map();
 const stale=()=>new DOMException('Superseded request','AbortError');
 return {
  get generation(){return generation;},
  get signal(){return controller.signal;},
  get disposed(){return disposed;},
  ticket(key){
   if(disposed)throw stale();
   if(typeof key!=='string'||!key.length||key.length>64)throw new TypeError('Invalid action key.');
   if(!serials.has(key)&&serials.size>=32)throw new RangeError('Too many action keys.');
   const epoch=generation,serial=(serials.get(key)??0)+1;
   serials.set(key,serial);
   return ()=>{if(disposed||generation!==epoch||serials.get(key)!==serial)throw stale();};
  },
  reset(){
   if(disposed)throw stale();
   const previous=controller;controller=new AbortController();generation++;serials.clear();previous.abort();
  },
  dispose(){
   if(disposed)return;
   disposed=true;generation++;serials.clear();controller.abort();
  },
 };
}
