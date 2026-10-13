import assert from 'node:assert/strict';
import test from 'node:test';
import {waitForBackend} from '../backend-readiness.mjs';

test('a 61 second Windows cold start must not be reported as a failed startup',async()=>{
  let elapsed=0;
  const result=await waitForBackend({
    inspect:()=>({phase:elapsed>=61000?'running':'starting'}),
    healthy:async()=>elapsed>=61000,
    pause:async ms=>{elapsed+=ms;},now:()=>elapsed,
  });
  assert.equal(result,'ready');
});
test('an existing launcher in starting phase is not a successful backend until HTTP is healthy',async()=>{
  let elapsed=0;
  const result=await waitForBackend({inspect:()=>({phase:'running'}),healthy:async()=>elapsed>=3000,
    pause:async ms=>{elapsed+=ms;},now:()=>elapsed});
  assert.equal(result,'ready');assert.equal(elapsed,3000);
});
test('a failed launcher stops waiting immediately',async()=>{
  assert.equal(await waitForBackend({inspect:()=>({phase:'failed'}),healthy:async()=>false,pause:async()=>{throw Error('should not wait');}}),'failed');
});
test('an alive launcher with a permanently unreachable HTTP backend cannot report ready',async()=>{
  let elapsed=0;
  assert.equal(await waitForBackend({inspect:()=>({phase:'running'}),healthy:async()=>false,
    pause:async ms=>{elapsed+=ms;},now:()=>elapsed,timeoutMs:1000}),'timeout');
});
