// Homepage chip row (KICKS 2.0): up to three chips that change with the time
// of the season, then three that are always there. Each chip is one short
// line, "when · what" — no sentences, no emoji.

import { eventTitle, type ScheduleEvent } from "./schedule";
import { weekLabel, type Lang } from "./i18n";

/** Club time on a league day: warm-up starts at 3:30, first game at 4. */
export const LEAGUE_DAY_TIME = { en: "3:30 PM", ko: "오후 3:30" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];

function parts(isoDate: string) {
	const [year, month, day] = isoDate.split("-").map(Number);
	return { year, month, day, weekday: new Date(year, month - 1, day).getDay() };
}

/** "Dec 5" / "12월 5일". */
export function chipDate(isoDate: string, lang: Lang): string {
	const { month, day } = parts(isoDate);
	return lang === "ko" ? `${month}월 ${day}일` : `${MONTHS[month - 1]} ${day}`;
}

/** "Oct 2026" / "2026년 10월". */
export function monthYear(isoDate: string, lang: Lang): string {
	const { year, month } = parts(isoDate);
	return lang === "ko" ? `${year}년 ${month}월` : `${MONTHS[month - 1]} ${year}`;
}

/** The chip name for an event: `chip`, else `short`, else its title up to the first " · ". */
export function shortTitle(event: ScheduleEvent, lang: Lang): string {
	const chip = lang === "ko" ? event.chip_ko ?? event.chip : event.chip;
	const short = lang === "ko" ? event.short_ko ?? event.short : event.short;
	return chip ?? short ?? eventTitle(event, lang).split(" · ")[0];
}

/**
 * The next-up chip: "Week 2 · Sat 3:30 PM" for a league day (the week is what
 * members look for, the day and time is when to turn up), "Dec 5 · Awards
 * night" for anything else.
 */
export function nextUpChipText(event: ScheduleEvent, lang: Lang): string {
	if (event.type === "league" && event.week && event.date) {
		const { weekday } = parts(event.date);
		const day = lang === "ko" ? WEEKDAYS_KO[weekday] : WEEKDAYS_EN[weekday];
		return `${weekLabel(event.week, lang)} · ${day} ${LEAGUE_DAY_TIME[lang]}`;
	}
	const title = shortTitle(event, lang);
	return event.date ? `${chipDate(event.date, lang)} · ${title}` : title;
}
