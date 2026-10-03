import assert from 'node:assert/strict'
import test from 'node:test'
import { BoundaryWheelGate } from '../src/features/activity-reader-navigation.ts'

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
})
const nativeScroll = { preventDefault: false, direction: 0 }
const holdBoundary = { preventDefault: true, direction: 0 }
const nextPanel = { preventDefault: true, direction: 1 }
const previousPanel = { preventDefault: true, direction: -1 }

test('scrolling content into the bottom holds that gesture until 180 ms idle', () => {
  const gate = new BoundaryWheelGate()
  assert.deepEqual(gate.update(wheel({ atEnd: false })), nativeScroll)
  assert.deepEqual(gate.update(wheel({ now: 40, deltaY: 120 })), holdBoundary)
  assert.deepEqual(gate.update(wheel({ now: 150, deltaY: 80 })), holdBoundary)
  assert.deepEqual(gate.update(wheel({ now: 329 })), holdBoundary)
  assert.deepEqual(gate.update(wheel({ now: 509 })), nextPanel)
})

test('scrolling content into the top cannot change panels in the same gesture', () => {
  const gate = new BoundaryWheelGate()
  assert.deepEqual(gate.update(wheel({ deltaY: -40, atEnd: false })), nativeScroll)
  assert.deepEqual(gate.update(wheel({ now: 60, deltaY: -60, atStart: true })), holdBoundary)
  assert.deepEqual(gate.update(wheel({ now: 240, deltaY: -40, atStart: true })), previousPanel)
})

test('a fresh edge gesture must accumulate at least 32 pixels', () => {
  const gate = new BoundaryWheelGate()
  assert.deepEqual(gate.update(wheel({ deltaY: 8 })), holdBoundary)
  assert.deepEqual(gate.update(wheel({ now: 20, deltaY: 12 })), holdBoundary)
  assert.deepEqual(gate.update(wheel({ now: 40, deltaY: 11.5 })), holdBoundary)
  assert.deepEqual(gate.update(wheel({ now: 60, deltaY: 0.5 })), nextPanel)
})

test('trackpad inertia cannot skip another panel even after the cooldown expires', () => {
  const gate = new BoundaryWheelGate()
  assert.deepEqual(gate.update(wheel()), nextPanel)
  for (const now of [20, 80, 160, 240, 320, 400, 480]) {
    assert.deepEqual(gate.update(wheel({ now })), holdBoundary)
  }
  assert.deepEqual(gate.update(wheel({ now: 660 })), nextPanel)
})

test('inertia is consumed so a new long panel stays at its starting position', () => {
  const gate = new BoundaryWheelGate()
  assert.deepEqual(gate.update(wheel()), nextPanel)
  assert.deepEqual(gate.update(wheel({ now: 50, atStart: true, atEnd: false })), holdBoundary)
  assert.deepEqual(gate.update(wheel({ now: 100, atStart: true, atEnd: false })), holdBoundary)
  assert.deepEqual(gate.update(wheel({ now: 280, atStart: true, atEnd: false })), nativeScroll)
  assert.deepEqual(gate.update(wheel({ now: 350 })), holdBoundary)
  assert.deepEqual(gate.update(wheel({ now: 530 })), nextPanel)
})

test('a direction reversal starts a gesture but respects a 350 ms switch cooldown', () => {
  const gate = new BoundaryWheelGate()
  assert.deepEqual(gate.update(wheel()), nextPanel)
  assert.deepEqual(gate.update(wheel({ now: 100, deltaY: -40, atStart: true })), holdBoundary)
  assert.deepEqual(gate.update(wheel({ now: 200, deltaY: -40, atStart: true })), holdBoundary)
  assert.deepEqual(gate.update(wheel({ now: 349, deltaY: -40, atStart: true })), holdBoundary)
  assert.deepEqual(gate.update(wheel({ now: 350, deltaY: -40, atStart: true })), previousPanel)
  assert.deepEqual(gate.update(wheel({ now: 450, deltaY: -40, atStart: true })), holdBoundary)
})

test('reversing away from an edge scrolls normally', () => {
  const gate = new BoundaryWheelGate()
  assert.deepEqual(gate.update(wheel({ deltaY: 8 })), holdBoundary)
  assert.deepEqual(gate.update(wheel({ now: 10, deltaY: -50, atStart: false })), nativeScroll)
})

test('line and page wheel units normalize to the pixel threshold', () => {
  const lineGate = new BoundaryWheelGate()
  assert.deepEqual(lineGate.update(wheel({ deltaMode: 1, deltaY: 1 })), holdBoundary)
  assert.deepEqual(lineGate.update(wheel({ now: 10, deltaMode: 1, deltaY: 1 })), nextPanel)
  const pageGate = new BoundaryWheelGate()
  assert.deepEqual(pageGate.update(wheel({ deltaMode: 2, deltaY: 0.02 })), holdBoundary)
  assert.deepEqual(pageGate.update(wheel({ now: 10, deltaMode: 2, deltaY: 0.02 })), nextPanel)
})

test('nested scroll, zoom, horizontal scrolling, and blocked surfaces do not consume or alter the gesture', () => {
  for (const ignored of [
    { nestedCanScroll: true },
    { ctrlKey: true },
    { deltaX: 80 },
    { deltaX: 40 },
    { blocked: true },
    { deltaY: 0 },
  ]) {
    const gate = new BoundaryWheelGate()
    assert.deepEqual(gate.update(wheel({ deltaY: 16 })), holdBoundary)
    assert.deepEqual(gate.update(wheel({ now: 10, atEnd: false, ...ignored })), nativeScroll)
    assert.deepEqual(gate.update(wheel({ now: 20, deltaY: 16 })), nextPanel)
  }
})

test('the first and last panels hold their outer boundaries', () => {
  const gate = new BoundaryWheelGate()
  assert.deepEqual(gate.update(wheel({ canNext: false })), holdBoundary)
  assert.deepEqual(gate.update(wheel({ now: 200, deltaY: -80, atStart: true, canPrevious: false })), holdBoundary)
  assert.deepEqual(gate.update(wheel({ now: 220, deltaY: 40, atEnd: false })), nativeScroll)
})

test('reset clears gesture distance, latch, and cooldown for explicit navigation', () => {
  const gate = new BoundaryWheelGate()
  assert.deepEqual(gate.update(wheel()), nextPanel)
  gate.reset()
  assert.deepEqual(gate.update(wheel({ now: 20, deltaY: 16 })), holdBoundary)
  assert.deepEqual(gate.update(wheel({ now: 30, deltaY: 16 })), nextPanel)
})
