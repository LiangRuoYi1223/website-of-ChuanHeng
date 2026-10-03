export interface ChapterProgress {
  index: number
  progress: number
}

/**
 * Read progress from ascending chapter offsets in the scrolling stage.
 * A chapter ends when the next one reaches the viewport's leading edge;
 * the final chapter ends at the stage's maximum scroll position.
 */
export function getChapterProgress(starts: readonly number[], scrollTop: number, maxScroll: number): ChapterProgress {
  if (!starts.length) return { index: -1, progress: 0 }

  const limit = Number.isFinite(maxScroll) ? Math.max(0, maxScroll) : 0
  const position = Math.min(limit, Math.max(0, Number.isNaN(scrollTop) ? 0 : scrollTop))
  let index = 0
  for (let candidate = starts.length - 1; candidate >= 0; candidate--) {
    if (starts[candidate] <= position) {
      index = candidate
      break
    }
  }

  const start = starts[index]
  const end = Math.min(starts[index + 1] ?? limit, limit)
  const range = end - start
  if (range <= 0) return { index, progress: position === limit ? 1 : 0 }

  return { index, progress: Math.min(1, Math.max(0, (position - start) / range)) }
}
