import { onRequest } from '../functions/api/visits.js';

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname === '/api/visits') {
      return onRequest({ request, env });
    }
    return env.ASSETS.fetch(request);
  },
};
