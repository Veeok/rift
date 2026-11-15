import test from 'node:test';
import assert from 'node:assert/strict';
let m;try{m=await import('../src/evidence-state.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const ready=()=>assert.equal(typeof m?.validateEvidence,'function','evidence boundary is missing');
test('foreign reader sessions and changed connections are refused',()=>{
 ready();const expected={id:'a',connectionId:'c1'};
 for(const data of [{session:{readerSession:'b',connectionId:'c1'}},{session:{readerSession:'a',connectionId:'c2'}}])assert.throws(()=>m.validateEvidence(data,expected),/session|connection/i);
 assert.deepEqual(m.validateEvidence({session:{readerSession:'a',connectionId:'c1'}},expected),{connectionVerified:true});
});
test('legacy session-only evidence stays explicitly connection-unverified',()=>{
 ready();assert.deepEqual(m.validateEvidence({sessionId:'a'},{id:'a',connectionId:'c1'}),{connectionVerified:false});
 assert.throws(()=>m.validateEvidence({items:[]},{id:'a',connectionId:'c1'}),/unverified/i);
});
test('a retention-gap warning survives later generic notices until session reset',()=>{
 ready();const first=m.mergeLogNotice(null,{gap:{fromSeq:2,toSeq:4},notice:'partial'});
 const next=m.mergeLogNotice(first,{notice:'Ordinary notice'});
 assert.match(next,/2–4/);assert.match(next,/Ordinary notice/);assert.match(m.mergeLogNotice(next,{notice:'updated'}),/2–4/);
 assert.doesNotMatch(m.mergeLogNotice(null,{notice:'new session'}),/2–4/);
});
test('pending continuation preserves the exact job; source pages advance without inventing a fetch',()=>{
 ready();assert.deepEqual(m.sourceContinuation({status:'pending',jobId:'j1'}),{kind:'pending',jobId:'j1'});
 assert.deepEqual(m.sourceContinuation({status:'complete',source:{nextStartLine:31}}),{kind:'page',startLine:31});
 assert.equal(m.sourceContinuation({status:'complete',source:{nextStartLine:null}}),null);
 assert.throws(()=>m.sourceContinuation({status:'pending'}),/job/i);
});
