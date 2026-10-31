import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvedTrackMetrics, withManualTrackMetrics, validateManualTrackMetrics } from '../src/tracks/metrics.js';

test('missing values remain unavailable and zero is a real track value', () => {
  assert.deepEqual(resolvedTrackMetrics({stats:{distanceM:0,ascentM:null}}), {distanceM:0,ascentM:null,sources:{distance:'track',ascent:'unavailable'}});
});
test('manual values only fill missing statistics without changing raw stats', () => {
  const original={stats:{distanceM:1234,ascentM:null}};
  const result=withManualTrackMetrics(original,{ascentM:0});
  assert.deepEqual(original,{stats:{distanceM:1234,ascentM:null}});
  assert.deepEqual(result.stats,original.stats);
  assert.equal(result.manualMetrics.source,'administrator');
  assert.ok(Number.isFinite(Date.parse(result.manualMetrics.confirmedAt)));
  assert.deepEqual(resolvedTrackMetrics(result),{distanceM:1234,ascentM:0,sources:{distance:'track',ascent:'administrator'}});
  assert.throws(()=>withManualTrackMetrics(original,{distanceM:20}),/覆盖/);
});
test('skip and partial input keep unavailable values null and reject invalid manual numbers', () => {
  const original={stats:{distanceM:null,ascentM:null}};
  assert.equal(resolvedTrackMetrics(withManualTrackMetrics(original,{})).distanceM,null);
  assert.equal(resolvedTrackMetrics(withManualTrackMetrics(original,{ascentM:12})).distanceM,null);
  for(const value of [-1,NaN,Infinity,'12']) assert.throws(()=>withManualTrackMetrics(original,{ascentM:value}));
});
test('resolved metrics never let stale manual data replace automatic values', () => {
  assert.equal(resolvedTrackMetrics({stats:{ascentM:0},manualMetrics:{source:'administrator',ascentM:999}}).ascentM,0);
});

test('persisted manual metrics are validated before local persistence too',()=>{
 const checked={stats:{distanceM:100,ascentM:null},manualMetrics:{source:'administrator',confirmedAt:'2026-10-31T00:00:00Z',ascentM:0}};
 assert.doesNotThrow(()=>validateManualTrackMetrics(checked));
 for(const extra of [{ascentM:-1},{distanceM:0},{source:'user'},{confirmedAt:'bad'}]) assert.throws(()=>validateManualTrackMetrics({...checked,manualMetrics:{...checked.manualMetrics,...extra}}));
});
