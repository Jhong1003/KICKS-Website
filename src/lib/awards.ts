// KICKS awards on the Hall of Fame page.
//
// Three are computed from the data (src/lib/finale.ts): the champion team,
// the Golden Boot (most goals) and the Playmaker Award (most assists). The
// rest are chosen by the board and entered by hand in src/data/awards.json,
// which can also attach a trophy/ceremony photo to any award, computed or
// not. League awards use a league id as `scope` ("FA26-L1"); season awards
// (Ballon d'Or, Puskás) use the season ("FA26").

import awardsData from "../data/awards.json";
import profilesData from "../data/player_profiles.json";

export type AwardKey = "champion" | "golden_boot" | "playmaker" | "best_defender" | "og_award" | "ballon_dor" | "puskas";

export const AWARDS: Record<AwardKey, { en: string; ko: string; icon: string; level: "league" | "season"; computed: boolean }> = {
	champion: { en: "Champions", ko: "우승", icon: "🏆", level: "league", computed: true },
	golden_boot: { en: "Golden Boot", ko: "득점왕", icon: "👟", level: "league", computed: true },
	playmaker: { en: "Playmaker Award", ko: "도움왕", icon: "🎯", level: "league", computed: true },
	best_defender: { en: "Best Defender", ko: "베스트 수비수", icon: "🛡️", level: "league", computed: false },
	og_award: { en: "OG Award", ko: "자책골상", icon: "🪃", level: "league", computed: false },
	ballon_dor: { en: "Ballon d'Or", ko: "발롱도르", icon: "🌟", level: "season", computed: false },
	puskas: { en: "Puskás Award", ko: "푸스카스상", icon: "🎇", level: "season", computed: false },
};

/** Order of the hand-entered awards within a block. */
const MANUAL_ORDER: AwardKey[] = ["best_defender", "og_award", "ballon_dor", "puskas"];

interface AwardEntry {
	scope: string;
	award: string;
	winners?: string[];
	photo?: string;
	note?: string;
}

export interface AwardWinner {
	name: string;
	/** URL slug for /players/<id>, when the name matches a player. */
	id?: string;
}

export interface ManualAward {
	key: AwardKey;
	scope: string;
	winners: AwardWinner[];
	photo?: string;
	note?: string;
}

const entries = ((awardsData as { awards: AwardEntry[] }).awards ?? []).filter((entry): entry is AwardEntry & { award: AwardKey } =>
	Object.hasOwn(AWARDS, entry.award),
);
const slugByName = new Map(profilesData.map((player) => [player.name, player.id]));

/** Hand-entered awards for a league id or a season, in display order. */
export function manualAwards(scope: string): ManualAward[] {
	return entries
		.filter((entry) => entry.scope === scope && !AWARDS[entry.award].computed)
		.sort((a, b) => MANUAL_ORDER.indexOf(a.award) - MANUAL_ORDER.indexOf(b.award))
		.map((entry) => ({
			key: entry.award,
			scope: entry.scope,
			winners: (entry.winners ?? []).map((name) => ({ name, id: slugByName.get(name) })),
			photo: entry.photo,
			note: entry.note,
		}));
}

/** The photo attached to an award in awards.json (computed awards included), if any. */
export function awardPhoto(scope: string, key: AwardKey): string | undefined {
	return entries.find((entry) => entry.scope === scope && entry.award === key && entry.photo)?.photo;
}

/** Seasons that have at least one season-level award entered, newest first by first appearance in leagues. */
export function seasonsWithAwards(seasonOrder: string[]): string[] {
	const withAwards = new Set(entries.filter((entry) => AWARDS[entry.award].level === "season").map((entry) => entry.scope));
	return [...seasonOrder].reverse().filter((season) => withAwards.has(season));
}
