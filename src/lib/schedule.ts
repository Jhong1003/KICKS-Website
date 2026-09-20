// Shared helpers for turning src/data/schedule.json into the view the
// Schedule page's timeline and the homepage's "Next up" card both need:
// formatted dates, past/upcoming/next-up flags, and league week links.

export type ScheduleEventType = "league" | "event" | "friendly" | "ceremony";

export interface ScheduleEvent {
	date: string | null;
	title: string;
	type: ScheduleEventType;
	week?: number;
	/** Has a tentative date that still needs to be confirmed. */
	tbd?: boolean;
}

export interface ScheduleEventView extends ScheduleEvent {
	isPast: boolean;
	isNextUp: boolean;
	href: string | null;
	formattedDate: string | null;
}

export interface ScheduleMonthGroup {
	label: string;
	events: ScheduleEventView[];
}

export const TYPE_LABELS: Record<ScheduleEventType, string> = {
	league: "League",
	event: "Event",
	friendly: "Friendly",
	ceremony: "Ceremony",
};

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
	if (event.type === "league" && event.week) return `/league?week=${event.week}#results`;
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
		isPast: event.date < todayIso,
		isNextUp: index === nextUpIndex,
		href: eventHref(event),
		formattedDate: formatEventDate(event.date),
	}));

	const undatedViews: ScheduleEventView[] = undated.map((event) => ({
		...event,
		isPast: false,
		isNextUp: false,
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
 * Group events by month for the timeline. Within a month, events flagged
 * `tbd` (a tentative date still to be confirmed) sort to the end of that
 * month's group. Fully undated events land in their own "Date TBD" group
 * at the end.
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
		if (key !== TBD_GROUP_LABEL) {
			monthEvents.sort((a, b) => Number(Boolean(a.tbd)) - Number(Boolean(b.tbd)));
		}
		const [year, monthIndex] = key === TBD_GROUP_LABEL ? [null, null] : key.split("-").map(Number);
		return {
			label: key === TBD_GROUP_LABEL ? TBD_GROUP_LABEL : `${MONTH_NAMES[monthIndex!]} ${year}`,
			events: monthEvents,
		};
	});
}
