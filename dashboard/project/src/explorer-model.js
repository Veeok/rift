export function sameBinding(a,b){return a===b||!!a&&!!b&&a.readerSession===b.readerSession&&a.connectionId===b.connectionId;}
export function parseEditorValue(type,text,enumType){
 if(type==='string'){if(text.length>2000)throw new Error('Text exceeds 2000 characters.');return {type,value:text};}
 if(type==='boolean'){if(!['true','false'].includes(text))throw new Error('Choose true or false.');return {type,value:text==='true'};}
 if(type==='EnumItem'){if(!enumType||!text)throw new Error('Choose a supported enum value.');return {type,value:{enum:enumType,name:text}};}
 if(type==='number'){if(!text.trim()||!Number.isFinite(Number(text)))throw new Error('Enter a finite number.');return {type,value:Number(text)};}
 const arity={Vector2:2,Vector3:3,Color3:3,UDim:2,UDim2:4}[type];
 if(!arity)throw new Error('This value is read-only.');
 let value;try{value=JSON.parse(text);}catch{throw new Error('Enter a numeric JSON array.');}
 if(!Array.isArray(value)||value.length!==arity||value.some(n=>typeof n!=='number'||!Number.isFinite(n)))throw new Error(`Enter exactly ${arity} finite numbers.`);
 if(type==='Color3'&&value.some(n=>n<0||n>1))throw new Error('Color channels must be between 0 and 1.');
 return {type,value};
}
export function createExplorerModel(){
 const nodes=new Map(),children=new Map(),pages=new Map(),expanded=new Set(),parents=new Map();
 return {nodes,children,pages,expanded,parents,
  merge(parent,result,append=false){
   const items=Array.isArray(result.items)?result.items:[];const additions=items.filter(item=>typeof item.id==='string'&&!nodes.has(item.id));
   if(nodes.size+new Set(additions.map(item=>item.id)).size>2000)throw new Error('The 2000-object cache limit was reached. Refresh or narrow the search.');
   const ids=append?[...(children.get(parent)??[])]:[];
   for(const item of items){if(typeof item.id!=='string')continue;nodes.set(item.id,{...nodes.get(item.id),...item});parents.set(item.id,parent);if(!ids.includes(item.id))ids.push(item.id);}
   children.set(parent,ids);pages.set(parent,{hasMore:result.hasMore===true,nextOffset:result.nextOffset,partial:result.partial===true});
  },
  visible(){const result=[],visited=new Set();const visit=(parent,depth)=>{if(depth>64)return;for(const id of children.get(parent)??[]){if(visited.has(id))continue;visited.add(id);const item=nodes.get(id);if(!item)continue;result.push({item,depth});if(expanded.has(id))visit(id,depth+1);}};visit(null,0);return result;},
  reset(){nodes.clear();children.clear();pages.clear();expanded.clear();parents.clear();},
 };
}
