import assert from 'node:assert/strict';
import test from 'node:test';
import { BoundaryWheelGate, getPanelProgress } from '../src/features/section-reader-navigation.ts';

const wheel = (overrides = {}) => ({
  deltaY: 40,
  deltaX: 0,
  deltaMode: 0,
  ctrlKey: false,
  now: 0,
  atStart: false,
  atEnd: true,
  canPrevious: true,
  canNext: true,
  nestedCanScroll: false,
  blocked: false,
  ...overrides,
});
const nativeScroll = { preventDefault: false, direction: 0 };
const holdBoundary = { preventDefault: true, direction: 0 };
const nextPanel = { preventDefault: true, direction: 1 };
const previousPanel = { preventDefault: true, direction: -1 };

test('overflowing content reaches its bottom before a fresh gesture changes chapters', () => {
  const gate = new BoundaryWheelGate();
  assert.deepEqual(gate.update(wheel({ atEnd: false })), nativeScroll);
  assert.deepEqual(gate.update(wheel({ now: 40, deltaY: 120 })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 150, deltaY: 80 })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 329 })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 509 })), nextPanel);
});

test('upward content scrolling reaches its top before changing to the previous chapter', () => {
  const gate = new BoundaryWheelGate();
  assert.deepEqual(gate.update(wheel({ deltaY: -40, atEnd: false })), nativeScroll);
  assert.deepEqual(gate.update(wheel({ now: 60, deltaY: -60, atStart: true })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 240, deltaY: -40, atStart: true })), previousPanel);
});

test('a fresh edge gesture accumulates small wheel deltas before changing chapters', () => {
  const gate = new BoundaryWheelGate();
  assert.deepEqual(gate.update(wheel({ deltaY: 8 })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 20, deltaY: 12 })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 40, deltaY: 11.5 })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 60, deltaY: 0.5 })), nextPanel);
});

test('continued trackpad momentum cannot skip a second chapter after the cooldown', () => {
  const gate = new BoundaryWheelGate();
  assert.deepEqual(gate.update(wheel()), nextPanel);
  for (const now of [20, 80, 160, 240, 320, 400, 480]) {
    assert.deepEqual(gate.update(wheel({ now })), holdBoundary);
  }
  assert.deepEqual(gate.update(wheel({ now: 660 })), nextPanel);
});

test('momentum after a chapter change cannot scroll the newly opened content', () => {
  const gate = new BoundaryWheelGate();
  assert.deepEqual(gate.update(wheel()), nextPanel);
  assert.deepEqual(gate.update(wheel({ now: 50, atStart: true, atEnd: false })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 100, atStart: true, atEnd: false })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 280, atStart: true, atEnd: false })), nativeScroll);
  assert.deepEqual(gate.update(wheel({ now: 350 })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 530 })), nextPanel);
});

test('chapter transition momentum cannot scroll a new nested list but a fresh gesture restores it', () => {
  const gate = new BoundaryWheelGate();
  assert.deepEqual(gate.update(wheel()), nextPanel);
  assert.deepEqual(gate.update(wheel({ now: 20, nestedCanScroll: true })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 100, nestedCanScroll: true })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 280, nestedCanScroll: true })), nativeScroll);
  assert.deepEqual(gate.update(wheel({ now: 300 })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 480 })), nextPanel);
});

test('reversing direction can return to a chapter after the transition cooldown', () => {
  const gate = new BoundaryWheelGate();
  assert.deepEqual(gate.update(wheel()), nextPanel);
  assert.deepEqual(gate.update(wheel({ now: 100, deltaY: -40, atStart: true })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 200, deltaY: -40, atStart: true })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 349, deltaY: -40, atStart: true })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 350, deltaY: -40, atStart: true })), previousPanel);
  assert.deepEqual(gate.update(wheel({ now: 450, deltaY: -40, atStart: true })), holdBoundary);
});

test('reversing away from a chapter edge resumes native content scrolling', () => {
  const gate = new BoundaryWheelGate();
  assert.deepEqual(gate.update(wheel({ deltaY: 8 })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 10, deltaY: -50, atStart: false })), nativeScroll);
});

test('line and page wheel units normalize before evaluating navigation intent', () => {
  const lineGate = new BoundaryWheelGate();
  assert.deepEqual(lineGate.update(wheel({ deltaMode: 1, deltaY: 1 })), holdBoundary);
  assert.deepEqual(lineGate.update(wheel({ now: 10, deltaMode: 1, deltaY: 1 })), nextPanel);
  const pageGate = new BoundaryWheelGate();
  assert.deepEqual(pageGate.update(wheel({ deltaMode: 2, deltaY: 0.02 })), holdBoundary);
  assert.deepEqual(pageGate.update(wheel({ now: 10, deltaMode: 2, deltaY: 0.02 })), nextPanel);
});

test('nested list momentum reaches its bottom without changing chapters until a fresh gesture', () => {
  const gate = new BoundaryWheelGate();
  assert.deepEqual(gate.update(wheel({ nestedCanScroll: true })), nativeScroll);
  assert.deepEqual(gate.update(wheel({ now: 20, nestedCanScroll: true })), nativeScroll);
  assert.deepEqual(gate.update(wheel({ now: 40 })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 220 })), nextPanel);
});

test('nested list momentum reaches its top without changing chapters until a fresh upward gesture', () => {
  const gate = new BoundaryWheelGate();
  assert.deepEqual(
    gate.update(wheel({ deltaY: -40, atStart: true, nestedCanScroll: true })),
    nativeScroll,
  );
  assert.deepEqual(
    gate.update(wheel({ now: 20, deltaY: -40, atStart: true, nestedCanScroll: true })),
    nativeScroll,
  );
  assert.deepEqual(gate.update(wheel({ now: 40, deltaY: -40, atStart: true })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 220, deltaY: -40, atStart: true })), previousPanel);
});

test('zoom, horizontal gestures, and blocked surfaces preserve native interaction', () => {
  for (const ignored of [
    { ctrlKey: true },
    { deltaX: 80 },
    { deltaX: 40 },
    { blocked: true },
    { deltaY: 0 },
  ]) {
    const gate = new BoundaryWheelGate();
    assert.deepEqual(gate.update(wheel({ deltaY: 16 })), holdBoundary);
    assert.deepEqual(gate.update(wheel({ now: 10, atEnd: false, ...ignored })), nativeScroll);
    assert.deepEqual(gate.update(wheel({ now: 20, deltaY: 16 })), nextPanel);
  }
});

test('non-finite wheel values cannot create navigation intent or corrupt the active gesture', () => {
  for (const invalid of [
    { deltaY: Number.NaN },
    { deltaY: Number.POSITIVE_INFINITY },
    { deltaX: Number.NaN },
    { now: Number.NaN },
    { now: Number.POSITIVE_INFINITY },
  ]) {
    const gate = new BoundaryWheelGate();
    assert.deepEqual(gate.update(wheel({ deltaY: 16 })), holdBoundary);
    assert.deepEqual(gate.update(wheel({ now: 10, atEnd: false, ...invalid })), nativeScroll);
    assert.deepEqual(gate.update(wheel({ now: 20, deltaY: 16 })), nextPanel);
  }
});

test('outer boundaries do not navigate beyond the first or last chapter', () => {
  const gate = new BoundaryWheelGate();
  assert.deepEqual(gate.update(wheel({ canNext: false })), holdBoundary);
  assert.deepEqual(
    gate.update(wheel({ now: 200, deltaY: -80, atStart: true, canPrevious: false })),
    holdBoundary,
  );
  assert.deepEqual(gate.update(wheel({ now: 220, deltaY: 40, atEnd: false })), nativeScroll);
});

test('explicit navigation reset removes momentum latch and transition cooldown', () => {
  const gate = new BoundaryWheelGate();
  assert.deepEqual(gate.update(wheel()), nextPanel);
  gate.reset();
  assert.deepEqual(gate.update(wheel({ now: 20, deltaY: 16 })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 30, deltaY: 16 })), nextPanel);
});

test('explicit navigation reset discards unfinished wheel intent', () => {
  const gate = new BoundaryWheelGate();
  assert.deepEqual(gate.update(wheel({ deltaY: 20 })), holdBoundary);
  gate.reset();
  assert.deepEqual(gate.update(wheel({ now: 20, deltaY: 16 })), holdBoundary);
  assert.deepEqual(gate.update(wheel({ now: 30, deltaY: 16 })), nextPanel);
});

test('a viewport-sized or shorter chapter is fully read without a scroll', () => {
  assert.equal(getPanelProgress(0, 600, 600), 1);
  assert.equal(getPanelProgress(0, 400, 600), 1);
  assert.equal(getPanelProgress(0, 0, 0), 1);
});

test('a one-pixel layout rounding overflow still reports full completion', () => {
  assert.equal(getPanelProgress(0, 600.5, 600), 1);
  assert.equal(getPanelProgress(0, 601, 600), 1);
  assert.equal(getPanelProgress(0, 601.01, 600), 0);
});

test('an overflowing chapter reports progress through its complete content', () => {
  assert.equal(getPanelProgress(0, 1800, 600), 0);
  assert.equal(getPanelProgress(300, 1800, 600), 0.25);
  assert.equal(getPanelProgress(900, 1800, 600), 0.75);
  assert.equal(getPanelProgress(1200, 1800, 600), 1);
});

test('content overscroll is clamped to the chapter progress range', () => {
  assert.equal(getPanelProgress(-50, 1800, 600), 0);
  assert.equal(getPanelProgress(1500, 1800, 600), 1);
});

test('viewport resize and expanded content recompute the current chapter progress', () => {
  assert.equal(getPanelProgress(300, 1800, 600), 0.25);
  assert.equal(getPanelProgress(300, 1800, 1200), 0.5);
  assert.equal(getPanelProgress(300, 2400, 1200), 0.25);
  assert.equal(getPanelProgress(300, 1200, 1200), 1);
});
