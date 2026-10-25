export interface BoundaryWheelInput {
  deltaY: number;
  deltaX: number;
  deltaMode: number;
  ctrlKey: boolean;
  now: number;
  atStart: boolean;
  atEnd: boolean;
  canPrevious: boolean;
  canNext: boolean;
  nestedCanScroll: boolean;
  blocked: boolean;
}

export interface BoundaryWheelResult {
  preventDefault: boolean;
  direction: -1 | 0 | 1;
}

const GESTURE_IDLE_MS = 180;
const TRANSITION_COOLDOWN_MS = 350;
const TRANSITION_THRESHOLD_PX = 32;
const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 800;

/**
 * Lets content scroll to its edge, then accepts a fresh gesture to navigate.
 * Keep this instance across wheel transitions so momentum cannot skip chapters.
 */
export class BoundaryWheelGate {
  private lastWheelAt = Number.NEGATIVE_INFINITY;
  private lastTransitionAt = Number.NEGATIVE_INFINITY;
  private gestureDirection: -1 | 0 | 1 = 0;
  private beganAtBoundary = false;
  private boundaryDistance = 0;
  private transitioned = false;

  /** Clear state for explicit navigation, reader entry, or reader exit. */
  reset(): void {
    this.lastWheelAt = Number.NEGATIVE_INFINITY;
    this.lastTransitionAt = Number.NEGATIVE_INFINITY;
    this.gestureDirection = 0;
    this.beganAtBoundary = false;
    this.boundaryDistance = 0;
    this.transitioned = false;
  }

  update(input: BoundaryWheelInput): BoundaryWheelResult {
    const ignored =
      input.ctrlKey ||
      input.blocked ||
      !Number.isFinite(input.deltaY) ||
      !Number.isFinite(input.deltaX) ||
      !Number.isFinite(input.now) ||
      input.deltaY === 0 ||
      Math.abs(input.deltaX) >= Math.abs(input.deltaY);

    // Dialogs, zoom, and horizontal gestures do not affect chapter navigation.
    if (ignored) return { preventDefault: false, direction: 0 };

    const direction: -1 | 1 = input.deltaY > 0 ? 1 : -1;
    const atBoundary = direction === 1 ? input.atEnd : input.atStart;
    const freshGesture =
      direction !== this.gestureDirection || input.now - this.lastWheelAt >= GESTURE_IDLE_MS;

    if (freshGesture) {
      this.gestureDirection = direction;
      this.beganAtBoundary = atBoundary;
      this.boundaryDistance = 0;
      this.transitioned = false;
    }
    this.lastWheelAt = input.now;

    // Hold transition momentum before allowing scroll in the new chapter,
    // including nested lists that now happen to be beneath the pointer.
    if (this.transitioned) return { preventDefault: true, direction: 0 };

    // A nested scroller owns the gesture even after it reaches its own edge.
    // Recording its wheel events prevents their momentum becoming fresh intent.
    if (input.nestedCanScroll) {
      this.beganAtBoundary = false;
      this.boundaryDistance = 0;
      return { preventDefault: false, direction: 0 };
    }

    if (!atBoundary) {
      this.beganAtBoundary = false;
      this.boundaryDistance = 0;
      return { preventDefault: false, direction: 0 };
    }

    const canTransition = direction === 1 ? input.canNext : input.canPrevious;
    if (!canTransition || !this.beganAtBoundary) {
      return { preventDefault: true, direction: 0 };
    }

    const multiplier =
      input.deltaMode === 1 ? LINE_HEIGHT_PX : input.deltaMode === 2 ? PAGE_HEIGHT_PX : 1;
    this.boundaryDistance += Math.abs(input.deltaY) * multiplier;

    if (
      this.boundaryDistance < TRANSITION_THRESHOLD_PX ||
      input.now - this.lastTransitionAt < TRANSITION_COOLDOWN_MS
    ) {
      return { preventDefault: true, direction: 0 };
    }

    this.transitioned = true;
    this.lastTransitionAt = input.now;
    return { preventDefault: true, direction };
  }
}

/** Read progress within a panel; content that already fits is complete. */
export function getPanelProgress(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const travel = scrollHeight - clientHeight;
  if (travel <= 1) return 1;
  return Math.min(1, Math.max(0, scrollTop / travel));
}
