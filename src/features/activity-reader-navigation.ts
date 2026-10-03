export interface BoundaryWheelInput {
  deltaY: number
  deltaX: number
  deltaMode: number
  ctrlKey: boolean
  now: number
  atStart: boolean
  atEnd: boolean
  canPrevious: boolean
  canNext: boolean
  nestedCanScroll: boolean
  blocked: boolean
}

export interface BoundaryWheelResult {
  preventDefault: boolean
  direction: -1 | 0 | 1
}

const GESTURE_IDLE_MS = 180
const TRANSITION_COOLDOWN_MS = 350
const TRANSITION_THRESHOLD_PX = 32
const LINE_HEIGHT_PX = 16
const PAGE_HEIGHT_PX = 800

/**
 * Lets a reader scroll normally, then treats a fresh wheel gesture at an edge
 * as a request to move to the adjacent panel. Keep the same instance across
 * wheel-triggered transitions so the rest of a trackpad gesture cannot skip
 * another panel.
 */
export class BoundaryWheelGate {
  private lastWheelAt = Number.NEGATIVE_INFINITY
  private lastTransitionAt = Number.NEGATIVE_INFINITY
  private gestureDirection: -1 | 0 | 1 = 0
  private beganAtBoundary = false
  private boundaryDistance = 0
  private transitioned = false

  /** Clear state for an explicit navigation, reader entry, or reader exit. */
  reset(): void {
    this.lastWheelAt = Number.NEGATIVE_INFINITY
    this.lastTransitionAt = Number.NEGATIVE_INFINITY
    this.gestureDirection = 0
    this.beganAtBoundary = false
    this.boundaryDistance = 0
    this.transitioned = false
  }

  update(input: BoundaryWheelInput): BoundaryWheelResult {
    const ignored = input.ctrlKey || input.blocked || input.nestedCanScroll
      || !Number.isFinite(input.deltaY) || !Number.isFinite(input.deltaX)
      || !Number.isFinite(input.now) || input.deltaY === 0
      || Math.abs(input.deltaX) >= Math.abs(input.deltaY)

    // Other interactions must neither be consumed nor affect the wheel latch.
    if (ignored) return { preventDefault: false, direction: 0 }

    const direction: -1 | 1 = input.deltaY > 0 ? 1 : -1
    const atBoundary = direction === 1 ? input.atEnd : input.atStart
    const freshGesture = direction !== this.gestureDirection
      || input.now - this.lastWheelAt >= GESTURE_IDLE_MS

    if (freshGesture) {
      this.gestureDirection = direction
      this.beganAtBoundary = atBoundary
      this.boundaryDistance = 0
      this.transitioned = false
    }
    this.lastWheelAt = input.now

    // Consume the tail of the transition gesture even when the new panel has
    // room to scroll, so it remains at its starting position until a new one.
    if (this.transitioned) return { preventDefault: true, direction: 0 }

    if (!atBoundary) {
      // A gesture that scrolls content into its edge must finish there first.
      this.beganAtBoundary = false
      this.boundaryDistance = 0
      return { preventDefault: false, direction: 0 }
    }

    const canTransition = direction === 1 ? input.canNext : input.canPrevious
    if (!canTransition || !this.beganAtBoundary) {
      return { preventDefault: true, direction: 0 }
    }

    const multiplier = input.deltaMode === 1 ? LINE_HEIGHT_PX
      : input.deltaMode === 2 ? PAGE_HEIGHT_PX : 1
    this.boundaryDistance += Math.abs(input.deltaY) * multiplier

    if (this.boundaryDistance < TRANSITION_THRESHOLD_PX
      || input.now - this.lastTransitionAt < TRANSITION_COOLDOWN_MS) {
      return { preventDefault: true, direction: 0 }
    }

    this.transitioned = true
    this.lastTransitionAt = input.now
    return { preventDefault: true, direction }
  }
}
