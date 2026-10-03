import assert from 'node:assert/strict'
import test from 'node:test'
import { getChapterProgress } from '../src/features/page-reader-progress.ts'

test('viewport-sized chapters make gradual progress until the next chapter starts', () => {
  const starts = [0, 600, 1200]
  assert.deepEqual(getChapterProgress(starts, 0, 1500), { index: 0, progress: 0 })
  assert.deepEqual(getChapterProgress(starts, 300, 1500), { index: 0, progress: 0.5 })
  assert.deepEqual(getChapterProgress(starts, 600, 1500), { index: 1, progress: 0 })
  assert.deepEqual(getChapterProgress(starts, 900, 1500), { index: 1, progress: 0.5 })
  assert.deepEqual(getChapterProgress(starts, 1200, 1500), { index: 2, progress: 0 })
})

test('a long chapter uses its complete travel to the next chapter', () => {
  const starts = [0, 1800, 2400]
  assert.deepEqual(getChapterProgress(starts, 600, 3000), { index: 0, progress: 1 / 3 })
  assert.deepEqual(getChapterProgress(starts, 1350, 3000), { index: 0, progress: 0.75 })
  assert.deepEqual(getChapterProgress(starts, 2100, 3000), { index: 1, progress: 0.5 })
})

test('floating-point boundaries switch exactly at the chapter offset', () => {
  const starts = [0, 700.25, 1420.5]
  const before = getChapterProgress(starts, 700.25 - 0.000001, 1800)
  assert.equal(before.index, 0)
  assert.ok(before.progress < 1 && before.progress > 0.999999)
  assert.deepEqual(getChapterProgress(starts, 700.25, 1800), { index: 1, progress: 0 })
  const after = getChapterProgress(starts, 700.25 + 0.000001, 1800)
  assert.equal(after.index, 1)
  assert.ok(after.progress > 0 && after.progress < 0.000001)
})

test('reverse scrolling immediately restores the chapter above the boundary', () => {
  const starts = [0, 1000, 2000]
  assert.deepEqual(getChapterProgress(starts, 2250, 2400), { index: 2, progress: 0.625 })
  assert.deepEqual(getChapterProgress(starts, 2000, 2400), { index: 2, progress: 0 })
  assert.deepEqual(getChapterProgress(starts, 1999.5, 2400), { index: 1, progress: 0.9995 })
  assert.deepEqual(getChapterProgress(starts, 1000, 2400), { index: 1, progress: 0 })
  assert.deepEqual(getChapterProgress(starts, 999.5, 2400), { index: 0, progress: 0.9995 })
})

test('the last chapter reaches one at the document bottom and clamps overscroll', () => {
  const starts = [0, 600, 1200]
  assert.deepEqual(getChapterProgress(starts, 1350, 1500), { index: 2, progress: 0.5 })
  assert.deepEqual(getChapterProgress(starts, 1500, 1500), { index: 2, progress: 1 })
  assert.deepEqual(getChapterProgress(starts, 1700, 1500), { index: 2, progress: 1 })
  assert.deepEqual(getChapterProgress(starts, -200, 1500), { index: 0, progress: 0 })
})

test('a single short page is complete without requiring a scroll', () => {
  assert.deepEqual(getChapterProgress([0], 0, 0), { index: 0, progress: 1 })
  assert.deepEqual(getChapterProgress([0], 200, 0), { index: 0, progress: 1 })
  assert.deepEqual(getChapterProgress([0], 450, 900), { index: 0, progress: 0.5 })
})

test('viewport resizing recomputes the final chapter travel and clamps the old position', () => {
  const starts = [0, 800, 1600]
  assert.deepEqual(getChapterProgress(starts, 1800, 2400), { index: 2, progress: 0.25 })
  assert.deepEqual(getChapterProgress(starts, 1800, 2000), { index: 2, progress: 0.5 })
  assert.deepEqual(getChapterProgress(starts, 1800, 1800), { index: 2, progress: 1 })
  assert.deepEqual(getChapterProgress(starts, 1800, 1700), { index: 2, progress: 1 })
})

test('expanded and collapsed content uses the new chapter offsets', () => {
  assert.deepEqual(getChapterProgress([0, 600, 1200], 900, 1500), { index: 1, progress: 0.5 })
  assert.deepEqual(getChapterProgress([0, 600, 1800], 900, 2100), { index: 1, progress: 0.25 })
  assert.deepEqual(getChapterProgress([0, 600, 900], 900, 1200), { index: 2, progress: 0 })
})

test('zero travel at the final chapter boundary reports completion', () => {
  assert.deepEqual(getChapterProgress([0, 600], 600, 600), { index: 1, progress: 1 })
  assert.deepEqual(getChapterProgress([0, 0, 600], 0, 600), { index: 1, progress: 0 })
})

test('a chapter beyond the reachable scroll range stays zero until the page bottom', () => {
  assert.deepEqual(getChapterProgress([300], 100, 200), { index: 0, progress: 0 })
  assert.deepEqual(getChapterProgress([300], 200, 200), { index: 0, progress: 1 })
})

test('empty chapter offsets have no active chapter', () => {
  assert.deepEqual(getChapterProgress([], 200, 1000), { index: -1, progress: 0 })
})
