// Build-time production guards. URL query strings never enable local data or
// administrator previews in a production bundle, including vite preview.
export function resolveRuntimeMode(environment = {}) {
  const production = environment.PROD === true || environment.MODE === 'production';
  return { production, allowLocalPreview: !production, sampleContent: !production && environment.VITE_CONTENT_MODE !== 'live' };
}

export const runtimeMode = resolveRuntimeMode(import.meta.env ?? {});
