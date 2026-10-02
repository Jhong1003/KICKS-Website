import { onRequest as visits } from '../functions/api/visits.js';
import { onRequest as perks } from '../functions/api/perks.js';

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/visits') {
      return visits({ request, env });
    }
    if (pathname.startsWith('/api/perks/')) {
      return perks({ request, env });
    }
    return env.ASSETS.fetch(request);
  },
};
