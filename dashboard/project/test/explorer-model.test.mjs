import test from 'node:test';
import assert from 'node:assert/strict';
let m;try{m=await import('../src/explorer-model.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
test('tree merges re-observed pages by ID and bounds cached objects',()=>{
 assert.equal(typeof m?.createExplorerModel,'function','explorer model missing');const model=m.createExplorerModel();
 model.merge(null,{items:[{id:'a',name:'same'},{id:'b',name:'same'}]});model.merge(null,{items:[{id:'a',name:'new'}]},true);
 assert.equal(model.nodes.size,2);assert.deepEqual(model.children.get(null),['a','b']);assert.equal(model.nodes.get('a').name,'new');
 assert.throws(()=>model.merge(null,{items:Array.from({length:2001},(_,i)=>({id:'n'+i}))}),/2000/);
});
test('collapse and reconnect discard visible descendants and stale drafts',()=>{
 assert.equal(typeof m?.createExplorerModel,'function','explorer model missing');const model=m.createExplorerModel();model.merge(null,{items:[{id:'a'}]});model.merge('a',{items:[{id:'b'}]});
 assert.equal(model.visible().length,1);model.expanded.add('a');assert.deepEqual(model.visible().map(r=>r.item.id),['a','b']);model.reset();assert.equal(model.nodes.size,0);assert.equal(model.expanded.size,0);
});
test('typed editor never coerces invalid boolean, nonfinite numbers or malformed vectors',()=>{
 assert.equal(typeof m?.parseEditorValue,'function','typed editor missing');assert.deepEqual(m.parseEditorValue('boolean','true'),{type:'boolean',value:true});
 for(const [type,value]of [['boolean','yes'],['number','Infinity'],['Vector3','[1,2]'],['Color3','[2,0,0]']])assert.throws(()=>m.parseEditorValue(type,value));
 assert.deepEqual(m.parseEditorValue('UDim2','[0.5, 4, 1, 0]'),{type:'UDim2',value:[0.5,4,1,0]});
});
test('selection and binding identity do not follow duplicate names or reconnects',()=>{
 assert.equal(typeof m?.sameBinding,'function','binding helper missing');assert.equal(m.sameBinding({readerSession:'a',connectionId:'c1'},{readerSession:'a',connectionId:'c2'}),false);
 assert.equal(m.sameBinding(null,null),true);assert.equal(m.sameBinding(null,{readerSession:'a',connectionId:'c'}),false);
});
