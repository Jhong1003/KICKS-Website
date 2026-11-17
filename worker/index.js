import { onRequest as visits } from '../functions/api/visits.js';
import { onRequest as perks } from '../functions/api/perks.js';
import { onRequest as keeper } from '../functions/api/keeper.js';
import { onRequest as freekick } from '../functions/api/freekick.js';
import { onRequest as reactions } from '../functions/api/reactions.js';
import { onRequest as ratings } from '../functions/api/ratings.js';

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/visits') {
      return visits({ request, env });
    }
    if (pathname === '/api/keeper') {
      return keeper({ request, env });
    }
    if (pathname === '/api/freekick') {
      return freekick({ request, env });
    }
    if (pathname === '/api/reactions') {
      return reactions({ request, env });
    }
    if (pathname === '/api/ratings') {
      return ratings({ request, env });
    }
    if (pathname.startsWith('/api/perks/')) {
      return perks({ request, env });
    }
    return env.ASSETS.fetch(request);
  },
};
