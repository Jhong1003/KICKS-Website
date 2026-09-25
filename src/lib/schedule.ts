// Shared helpers for turning src/data/schedule.json into the view the
// Schedule page's timeline and the homepage's "Next up" card both need:
// formatted dates, past/upcoming/next-up flags, and league week links.
// Labels come in both languages (see src/lib/i18n.ts).

import { weekLabel, type Lang } from "./i18n";

export type ScheduleEventType = "league" | "event" | "friendly" | "ceremony";

export interface ScheduleEvent {
	date: string | null;
	title: string;
	type: ScheduleEventType;
	/** For `league` entries: which league (e.g. "FA26-L1") and the week within it. */
	league?: string;
	week?: number;
	/** Has a tentative date that still needs to be confirmed. */
	tbd?: boolean;
}

export interface ScheduleEventView extends ScheduleEvent {
	/**
	 * Position in buildScheduleView's own output, for a caller to re-run
	 * buildScheduleView later (e.g. client-side, against the visitor's
	 * actual date) and match results back to the elements rendered for the
	 * first (build-time) call — see the client-hydration scripts in
	 * ScheduleTimeline.astro and index.astro.
	 */
	index: number;
	isPast: boolean;
	isNextUp: boolean;
	isToday: boolean;
	href: string | null;
	formattedDate: string | null;
}

export interface ScheduleMonthGroup {
	label: string;
	labelKo: string;
	events: ScheduleEventView[];
}

export const TYPE_LABELS: Record<ScheduleEventType, string> = {
	league: "League",
	event: "Event",
	friendly: "Friendly",
	ceremony: "Ceremony",
};

export const TYPE_LABELS_KO: Record<ScheduleEventType, string> = {
	league: "리그",
	event: "이벤트",
	friendly: "친선경기",
	ceremony: "시상식",
};

/**
 * An event's display title. League weeks are built from their league and
 * week ("FA26-L1 · Week 4" / "FA26-L1 · 4주차") so they read naturally in
 * both languages; every other event shows its schedule.json title as written.
 */
export function eventTitle(event: ScheduleEvent, lang: Lang): string {
	if (event.type === "league" && event.league && event.week) {
		return `${event.league} · ${weekLabel(event.week, lang)}`;
	}
	return event.title;
}

const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

const TBD_GROUP_LABEL = "Date TBD";
const TBD_GROUP_LABEL_KO = "날짜 미정";

// Appending a time forces the date to be parsed in the local timezone
// instead of UTC, which would otherwise risk showing the previous day in
// timezones behind UTC.
const toLocalDate = (isoDate: string) => new Date(`${isoDate}T00:00:00`);

export function formatEventDate(isoDate: string): string {
	return toLocalDate(isoDate).toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
	});
}

export function eventHref(event: ScheduleEvent): string | null {
	// The #results hash scrolls straight to the Match Results section on
	// load; ?week picks the tab (see WeeklyResults.astro's deep-link script).
	// Weeks restart at 1 in every league, so the link names the league too.
	if (event.type === "league" && event.league && event.week) {
		return `/league/${event.league}?week=${event.week}#results`;
	}
	return null;
}

function startOfDayIso(date: Date): string {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString().slice(0, 10);
}

/**
 * Turn the raw schedule entries into view-ready events: sorted by date,
 * flagged past/next-up relative to `today`, undated entries pushed to the
 * end. `today` is a parameter (not `new Date()` internally) so the "next
 * up" pick can be tested against a fixed day.
 */
export function buildScheduleView(events: ScheduleEvent[], today: Date = new Date()): ScheduleEventView[] {
	const todayIso = startOfDayIso(today);

	const dated = events
		.filter((event): event is ScheduleEvent & { date: string } => Boolean(event.date))
		.sort((a, b) => a.date.localeCompare(b.date));
	const undated = events.filter((event) => !event.date);

	const nextUpIndex = dated.findIndex((event) => event.date >= todayIso);

	const datedViews: ScheduleEventView[] = dated.map((event, index) => ({
		...event,
		index,
		isPast: event.date < todayIso,
		isNextUp: index === nextUpIndex,
		isToday: event.date === todayIso,
		href: eventHref(event),
		formattedDate: formatEventDate(event.date),
	}));

	const undatedViews: ScheduleEventView[] = undated.map((event, i) => ({
		...event,
		index: datedViews.length + i,
		isPast: false,
		isNextUp: false,
		isToday: false,
		href: eventHref(event),
		formattedDate: null,
	}));

	return [...datedViews, ...undatedViews];
}

/** The next upcoming event (by date), or null if nothing is upcoming. */
export function getNextUpEvent(events: ScheduleEvent[], today: Date = new Date()): ScheduleEventView | null {
	return buildScheduleView(events, today).find((event) => event.isNextUp) ?? null;
}

/**
 * Group the date-sorted buildScheduleView output by month for the timeline,
 * preserving chronological order even for tentative dates. Fully undated
 * events land in their own "Date TBD" group at the end.
 */
export function groupByMonth(views: ScheduleEventView[]): ScheduleMonthGroup[] {
	const groups = new Map<string, ScheduleEventView[]>();
	const order: string[] = [];

	for (const view of views) {
		const key = view.date ? `${toLocalDate(view.date).getFullYear()}-${toLocalDate(view.date).getMonth()}` : TBD_GROUP_LABEL;
		if (!groups.has(key)) {
			groups.set(key, []);
			order.push(key);
		}
		groups.get(key)!.push(view);
	}

	return order.map((key) => {
		const monthEvents = groups.get(key)!;
		const [year, monthIndex] = key === TBD_GROUP_LABEL ? [null, null] : key.split("-").map(Number);
		return {
			label: key === TBD_GROUP_LABEL ? TBD_GROUP_LABEL : `${MONTH_NAMES[monthIndex!]} ${year}`,
			labelKo: key === TBD_GROUP_LABEL ? TBD_GROUP_LABEL_KO : `${year}년 ${monthIndex! + 1}월`,
			events: monthEvents,
		};
	});
}
