import test from 'node:test';
import assert from 'node:assert/strict';
let matches;
try { ({matchesAscent:matches}=await import('../src/tracks/route-filters.js')); } catch {}
test('a missing elevation must never match a numeric ascent bucket',()=>{
  assert.equal(typeof matches,'function');
  for(const value of [null,undefined,'',NaN,Infinity]) for(const bucket of ['low','medium','high']) assert.equal(matches(value,bucket),false);
  assert.equal(matches(null,''),true);
  assert.equal(matches(0,'low'),true);assert.equal(matches(800,'medium'),true);assert.equal(matches(1500,'medium'),true);assert.equal(matches(1501,'high'),true);
});
