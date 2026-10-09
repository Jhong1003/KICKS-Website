// Seasonal look (e.g. Halloween): a few small decorations that switch on by
// themselves for a date window and off again afterwards — no redeploy needed.
//
// The site is static, so "today" at build time would go stale. Instead the
// inline script in BaseLayout.astro checks the *visitor's* date before first
// paint and sets <html data-season="<id>">; everything themed is CSS keyed off
// that attribute (global.css, "Season themes"), so outside the window the
// decorations are simply hidden. Without JavaScript nothing is themed.
//
// To preview a theme on any date, open a page with ?theme=<id> (it sticks for
// the browser tab); ?theme=none turns theming off again.

import type { League } from "./leagues";
import type { ScheduleEvent } from "./schedule";

export interface SeasonTheme {
	id: string;
	/** First and last day, "MM-DD", in the visitor's local time (inclusive). */
	from: string;
	to: string;
}

export const SEASON_THEMES: SeasonTheme[] = [{ id: "halloween", from: "10-01", to: "10-31" }];

/**
 * The current league's final week when it falls on Halloween (Oct 31) —
 * the homepage then calls it the "Halloween Final". Null otherwise, so a
 * future season with a different calendar just doesn't show the line.
 */
export function halloweenFinal(league: League, schedule: ScheduleEvent[]): ScheduleEvent | null {
	const final = schedule.find(
		(event) => event.type === "league" && event.league === league.id && event.week === league.rules.final_week,
	);
	return final?.date?.endsWith("-10-31") ? final : null;
}
