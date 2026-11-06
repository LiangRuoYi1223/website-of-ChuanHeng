import { buildCachedTrackMapModel } from './cached-basemap.js';
import dananshan from '../assets/maps/dananshan-20261106.json' with { type: 'json' };

// Public geographic context only. Selection never changes a route or its
// historical activity snapshot; coverage is established from every real point.
export const REFERENCE_BASEMAPS = Object.freeze([dananshan]);

export function resolveTrackBasemap(track, references = REFERENCE_BASEMAPS) {
  const existing = buildCachedTrackMapModel(track);
  if (existing) return existing;
  if (!track || typeof track !== 'object' || track.basemap !== undefined || !Array.isArray(references)) return null;
  for (const basemap of references) {
    const model = buildCachedTrackMapModel({ ...track, basemap });
    if (model) return { ...model, reference: true };
  }
  return null;
}
