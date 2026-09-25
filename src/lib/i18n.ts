// English / Korean toggle. Every translatable string is rendered in *both*
// languages (see src/components/T.astro, which wraps each version in a
// `data-lang="en"` / `data-lang="ko"` element), and global.css hides the one
// that doesn't match `<html lang>`. So switching languages never re-renders
// anything — it only flips that one attribute (see LanguageToggle in
// Header.astro and the inline script at the top of BaseLayout.astro, which
// picks the starting language before the first paint).
//
// What stays English in both modes, on purpose: the hero slogan and brand
// labels, and badge and play-style tag names (except Brace, shown as 멀티골
// in Korean). Menu, headings and section labels are translated.
// Content that comes from hand-edited JSON (partner names, video titles) is
// shown as written; schedule events can carry an optional Korean `title_ko`.

export type Lang = "en" | "ko";

/** localStorage key for the visitor's explicit choice (absent = follow the browser). */
export const LANG_STORAGE_KEY = "kicks-lang";

// Appending a time forces the date to be parsed in the local timezone
// instead of UTC, which would otherwise risk showing the previous day in
// timezones behind UTC.
const toLocalDate = (isoDate: string) => new Date(`${isoDate}T00:00:00`);

const KO_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "Sun, Sep 27" in English, "9월 27일 (일)" in Korean. */
export function formatShortDate(isoDate: string, lang: Lang): string {
	const date = toLocalDate(isoDate);
	if (lang === "ko") return `${date.getMonth() + 1}월 ${date.getDate()}일 (${KO_WEEKDAYS[date.getDay()]})`;
	return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** "Week 3" / "3주차". */
export const weekLabel = (week: number, lang: Lang) => (lang === "ko" ? `${week}주차` : `Week ${week}`);

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * Both language versions as an HTML string, for text that a client-side
 * script writes into the page (the same markup T.astro renders at build
 * time). Plain text only — both strings are escaped.
 */
export function bilingualHtml(en: string, ko: string): string {
	return `<span data-lang="en">${escapeHtml(en)}</span><span data-lang="ko" lang="ko">${escapeHtml(ko)}</span>`;
}
