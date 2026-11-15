import test from 'node:test';
import assert from 'node:assert/strict';
import {localApiGuard} from '../tools/local-api.mjs';
function check({host='127.0.0.2:41734',origin='http://127.0.0.2:41734',method='GET',url='/api/status'}={}){
 let result='allowed';
 localApiGuard({url,method,headers:{host,...(origin===null?{}:{origin})},socket:{localPort:41734}},
  {writeHead(code){result=code;},end(){}},()=>{});
 return result;
}
test('private preview accepts only its distinct same-origin loopback host',()=>{
 assert.equal(check(),'allowed');assert.equal(check({method:'POST'}),'allowed');
 assert.equal(check({host:'127.0.0.1:41734',origin:'http://127.0.0.1:41734'}),403);
 assert.equal(check({origin:'http://127.0.0.1:38918'}),403);
});
test('all preview writes require an explicit matching origin',()=>{
 assert.equal(check({method:'POST',origin:null}),403);
 assert.equal(check({method:'PATCH',origin:null}),403);
 assert.equal(check({method:'PATCH'}),'allowed');
});
test('fixture browser routes still forbid execution and image sharing',()=>{
 assert.equal(check({method:'POST',url:'/api/tools/execute_luau'}),403);
 assert.equal(check({method:'POST',url:'/api/tools/share_capture'}),403);
});
