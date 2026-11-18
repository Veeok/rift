import test from 'node:test';
import assert from 'node:assert/strict';
import {createDashboardClient} from '../src/api.js';
test('human explorer uses only fixed read/write routes and preserves unknown receipts',async()=>{
 const calls=[],client=createDashboardClient({fetchImpl:async(path,options)=>{calls.push({path,options});return new Response(JSON.stringify({structuredContent:{ok:true,status:'unknown_outcome',requestId:'request-1',error:{code:'deadline',message:'Unknown'}}}),{status:200});}});
 assert.equal(typeof client.explorerRead,'function','fixed explorer read route missing');assert.equal(typeof client.explorerWrite,'function','fixed explorer write route missing');
 const receipt=await client.explorerWrite({requestId:'request-1'});assert.equal(receipt.status,'unknown_outcome');assert.equal(calls[0].path,'/api/explorer/write');assert.equal(calls.length,1);
});
