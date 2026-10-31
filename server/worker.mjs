import { handleTrackRequest, jsonResponse } from './tracks/http.mjs';
import { handleCoverRequest } from './covers/http.mjs';

export default {
  async fetch(request, env, _context) {
    // This public entry point must never inherit a development bypass, even
    // for a localhost Host, query parameter or similarly named environment flag.
    const response = await handleCoverRequest(request, env, { fetchImpl: fetch }) || await handleTrackRequest(request, env, { localPreview: false, fetchImpl: fetch });
    if (response) return response;
    if (typeof env?.ASSETS?.fetch === 'function') return env.ASSETS.fetch(request);
    return jsonResponse({ error: { code: 'NOT_FOUND', message: '没有找到此页面。' } }, 404);
  },
};
