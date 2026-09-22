// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	// Lets Astro.site resolve absolute URLs (og:url, og:image) correctly
	// from any page, including nested routes like /players/[id].
	site: 'https://kicksuiuc.com',
});
