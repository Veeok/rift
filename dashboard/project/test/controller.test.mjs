import test from 'node:test';
import assert from 'node:assert/strict';
let module;
try{module=await import('../src/controller.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
test('controller import is inert and exports an explicit startup lifetime',()=>{
 assert.equal(typeof module?.startDashboard,'function','source-owned controller is missing');
});
test('incomplete shells refuse before network or listener installation',()=>{
 assert.equal(typeof module?.startDashboard,'function','source-owned controller is missing');
 let calls=0;
 assert.throws(()=>module.startDashboard({document:{getElementById:()=>null},window:{},fetchImpl:()=>{calls++;}}),/shell/i);
 assert.equal(calls,0);
});
