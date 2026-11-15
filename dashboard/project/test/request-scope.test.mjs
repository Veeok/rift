import test from 'node:test';
import assert from 'node:assert/strict';
let module;
try { module=await import('../src/request-scope.js'); } catch(e) { if(e.code!=='ERR_MODULE_NOT_FOUND')throw e; }
function scope(){assert.equal(typeof module?.createRequestScope,'function','request lifecycle scope is missing');return module.createRequestScope();}
test('a current ticket is valid until superseded by the same action',()=>{
 const s=scope(),first=s.ticket('source'),other=s.ticket('widgets');first();other();
 const second=s.ticket('source');assert.throws(first,{name:'AbortError'});second();other();
});
test('connection reset aborts pending work and invalidates every earlier ticket',()=>{
 const s=scope(),signal=s.signal,first=s.ticket('source'),g=s.generation;
 s.reset();assert.equal(signal.aborted,true);assert.notEqual(s.signal,signal);assert.equal(s.signal.aborted,false);
 assert.equal(s.generation,g+1);assert.throws(first,{name:'AbortError'});s.ticket('source')();
});
test('dispose is terminal and idempotent rather than opening a new lifetime',()=>{
 const s=scope(),signal=s.signal,t=s.ticket('logs');s.dispose();s.dispose();
 assert.equal(s.disposed,true);assert.equal(signal.aborted,true);assert.throws(t,{name:'AbortError'});
 assert.throws(()=>s.ticket('logs'),{name:'AbortError'});assert.throws(()=>s.reset(),{name:'AbortError'});
});
test('independent scopes never invalidate another controller instance',()=>{
 const a=scope(),b=scope(),t=b.ticket('source');a.reset();a.dispose();t();assert.equal(b.signal.aborted,false);
});
test('unbounded or malformed action keys cannot grow the request ledger',()=>{
 const s=scope();for(const key of ['',null,'x'.repeat(65)])assert.throws(()=>s.ticket(key));
 for(let i=0;i<32;i++)s.ticket('a'+i);assert.throws(()=>s.ticket('a32'),RangeError);
 s.ticket('a0')();s.reset();s.ticket('fresh')();
});
