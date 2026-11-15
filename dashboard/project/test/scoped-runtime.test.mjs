import test from 'node:test';
import assert from 'node:assert/strict';
import * as controls from '../src/protection-controls.js';
const verified={support:'supported',scope:'context_created_only',wholeScriptProtected:false,profileId:'rift-owned-ui-v1',inUse:false};
test('only exact scoped evidence can show readiness; saved On alone stays unverified',()=>{
 assert.equal(typeof controls.runtimeLabel,'function','scoped runtime labels missing');
 assert.equal(controls.runtimeLabel({preload:true},null),'Unverified');
 assert.equal(controls.runtimeLabel({preload:true},verified),'Ready for supported UI');
 assert.equal(controls.runtimeLabel({preload:true},{...verified,wholeScriptProtected:true}),'Unverified');
});
test('turning future policy Off does not falsely clear an earlier active context',()=>{
 assert.equal(typeof controls.runtimeLabel,'function','scoped runtime labels missing');
 assert.equal(controls.runtimeLabel({preload:false},{...verified,inUse:true}),'In use — factory resources only');
 assert.equal(controls.runtimeLabel({preload:false},verified),'Off');
});
test('unknown preference state and blocked native validation remain errors',()=>{
 assert.equal(typeof controls.runtimeLabel,'function','scoped runtime labels missing');
 assert.equal(controls.runtimeLabel(null,verified),'Error');
 assert.equal(controls.runtimeLabel({preload:true},{...verified,state:'Error'}),'Error');
});
