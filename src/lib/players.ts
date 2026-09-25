// Shared types/helpers for src/data/player_profiles.json, used by the
// /players grid and /players/[id] detail pages. Stats, tag and badges are
// per league (see PlayerLeagueSection) and never combined across leagues;
// team colors and league metadata live in ./leagues. The badge/tag *rules* live
// in scripts/update_data.py (that's what computes them) — this file only
// carries the display metadata (label/description/icon/tier) for each badge
// key, and small view helpers. See AGENTS.md's "Player profiles" section
// for the full rules writeup. Teams appear here only as team_id; names come
// from ./leagues (getTeamName) at render time.

import { getLeague, getTeamIdByName, getTeamName, type League } from "./leagues";

export interface TeamSegment {
	team_id: string;
	from_week: number;
	to_week: number;
}

export interface SeasonTotals {
	goals: number;
	assists: number;
	attacking_points: number;
	weeks_attended: number;
	weeks_played: number;
}

export interface WeeklyStat {
	week: number;
	team_id: string;
	games: number;
	goals: number;
	assists: number;
}

export interface PersonalBestWeek {
	week: number;
	goals: number;
	assists: number;
	attacking_points: number;
}

export type PlayStyleTag =
	| "Finisher"
	| "Playmaker"
	| "All-Rounder"
	| "Rock"
	| "Engine"
	| "Target Man"
	| "Black Spider"
	| "Team Player";

/** Matches the `players` tab's `status` column — see AGENTS.md's "Player status" section. */
export type PlayerStatus = "active" | "new" | "inactive";

/** Matches the `players` tab's `primary_position`/`secondary_position` columns. */
export type PlayerPosition = "GK" | "DF" | "MF" | "FW";

export type BadgeKey =
	| "off_the_mark"
	| "provider"
	| "iron_man"
	| "squad_member"
	| "on_fire"
	| "libero"
	| "the_wall"
	| "champion"
	| "brace"
	| "game_changer"
	| "crack"
	| "fox_in_the_box"
	| "maestro"
	| "delivery_service"
	| "hat_trick"
	| "own_goal_award"
	| "journeyman";

/** One player's profile within a single league (its stats, tag and badges). */
export interface PlayerLeagueSection {
	league: string;
	current_team_id: string;
	team_history: TeamSegment[];
	season_totals: SeasonTotals;
	weekly_stats: WeeklyStat[];
	personal_best_week: PersonalBestWeek | null;
	play_style_tag: PlayStyleTag;
	badges: BadgeKey[];
}

/** `leagues` has one section per league the player has played in, newest first. */
export interface PlayerProfile {
	/** URL slug for /players/<id> (and the player-photos.json key) — not the Sheet's player_id. */
	id: string;
	/** The players tab's player_id (P001, ...): the player's identity in the data. */
	player_id: string;
	name: string;
	avatar_initials: string;
	positions: PlayerPosition[];
	status: PlayerStatus;
	leagues: PlayerLeagueSection[];
}

/** The player's section for one league, or undefined if they never played in it. */
export function getSection(player: PlayerProfile, leagueId: string): PlayerLeagueSection | undefined {
	return player.leagues.find((section) => section.league === leagueId);
}

/** A player paired with their section for the league a page is showing. */
export interface PlayerInLeague {
	player: PlayerProfile;
	section: PlayerLeagueSection;
}

// Deliberately no rating/score field anywhere on this type — this is a
// friendly club site, not a scouting report. See AGENTS.md.

/**
 * How hard a badge is to earn. Fixed per badge (never recalculated from how
 * many people hold it); "special" is for the just-for-fun story badges.
 */
export type BadgeTier = "legendary" | "rare" | "common" | "special";

export const BADGE_TIER_LABELS: Record<BadgeTier, string> = {
	legendary: "Legendary",
	rare: "Rare",
	common: "Common",
	special: "Special",
};

const TIER_ORDER: BadgeTier[] = ["legendary", "rare", "common", "special"];

export const BADGES: Record<BadgeKey, { label: string; description: string; icon: string; tier: BadgeTier }> = {
	// Common
	off_the_mark: { label: "Goal!", description: "Scored in this league.", icon: "⚽", tier: "common" },
	provider: { label: "Assist!", description: "Set up a teammate's goal in this league.", icon: "🎯", tier: "common" },
	iron_man: {
		label: "Iron Man",
		description: "Hasn't missed a week since joining this league.",
		icon: "🦾",
		tier: "common",
	},
	squad_member: { label: "Squad Member", description: "A valued part of the KICKS roster.", icon: "🤝", tier: "common" },
	// Rare
	on_fire: { label: "On Fire", description: "3+ goals and assists combined in a single week.", icon: "🔥", tier: "rare" },
	libero: { label: "Libero", description: "A defender who scored or assisted in this league.", icon: "🛡️", tier: "rare" },
	the_wall: {
		label: "The Wall",
		description: "Defended in a week the team kept 3+ clean sheets.",
		icon: "🧱",
		tier: "rare",
	},
	champion: { label: "Champion", description: "Won the league.", icon: "🏆", tier: "rare" },
	brace: { label: "Brace", description: "Scored 2 goals in a single match.", icon: "✌️", tier: "rare" },
	// Legendary
	game_changer: {
		label: "Game Changer",
		description: "2+ goals and 2+ assists in the same week.",
		icon: "⚡",
		tier: "legendary",
	},
	crack: {
		label: "Crack",
		description: "2+ goals and assists combined in each of two weeks in a row.",
		icon: "💎",
		tier: "legendary",
	},
	fox_in_the_box: { label: "Fox in the Box", description: "5+ goals in this league.", icon: "🦊", tier: "legendary" },
	maestro: { label: "Maestro", description: "3+ assists in a single week.", icon: "🎼", tier: "legendary" },
	delivery_service: {
		label: "Delivery Service",
		description: "5+ assists in this league.",
		icon: "📦",
		tier: "legendary",
	},
	hat_trick: { label: "Hat-trick", description: "Scored 3 goals in a single match.", icon: "🎩", tier: "legendary" },
	// Special — just for fun
	own_goal_award: {
		label: "Own Goal Award",
		description: "Generously contributed a goal to the other team's tally. It happens to the best of us!",
		icon: "🪃",
		tier: "special",
	},
	journeyman: { label: "Journeyman", description: "Played for more than one team in this league.", icon: "🧳", tier: "special" },
};

/** Badges rarest-first (legendary, rare, common, then the fun ones), keeping the pipeline's order within a tier. */
export function sortBadges(keys: BadgeKey[]): BadgeKey[] {
	return [...keys].sort((a, b) => TIER_ORDER.indexOf(BADGES[a].tier) - TIER_ORDER.indexOf(BADGES[b].tier));
}

/** WCAG relative luminance of a hex color, or null if it doesn't parse. */
function relativeLuminance(hex: string): number | null {
	const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	if (!match) return null;

	const [r, g, b] = match.slice(1).map((channel) => {
		const s = parseInt(channel, 16) / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Dark or light text color, whichever reads better on top of `hex` — used
 * for the player card avatar, which fills its circle with the team color.
 * Computed (WCAG relative luminance) rather than hardcoded per team, so a
 * future teams-tab color change (e.g. real bib colors) can't accidentally
 * ship unreadable white-on-yellow text again.
 */
export function getContrastingTextColor(hex: string): string {
	const luminance = relativeLuminance(hex);
	return luminance !== null && luminance > 0.5 ? "#292929" : "#f7f6f2";
}

/**
 * The team color itself, used as *text* on the card's cream background
 * (the small team-name label) — unless the color is too light to read
 * there (e.g. a yellow), in which case this falls back to a dark neutral
 * instead of shipping pale-on-cream text.
 */
export function getReadableAccentColor(hex: string): string {
	const luminance = relativeLuminance(hex);
	return luminance !== null && luminance > 0.5 ? "#292929" : hex;
}

// --- Transfer news banner --------------------------------------------------
// Config lives in src/data/transfer-news.json (hand-edited: on/off, heading
// text, and the list of moves) — this only resolves each entry against
// player_profiles.json to find the player's id (for the profile link) and
// their team just before the move, within one league (teams are reshuffled
// between leagues, so a move only means something inside a single league).

export interface TransferEntry {
	player: string;
	to: string;
	/**
	 * Optional explicit "from" team, overriding the automatic lookup from
	 * player_profiles.json. Use this when the Sheet hasn't recorded the
	 * move in a new week yet — team_history is still empty in that case
	 * and current_team_id can't be trusted as "the team before the move"
	 * (it may still show the old team, or may have been edited ahead of
	 * time and show something else entirely). Safe to remove once a real
	 * week under the new team has been entered and regenerated.
	 */
	from?: string;
}

export interface ResolvedTransfer {
	/** URL slug (PlayerProfile.id), for the profile link. */
	playerId: string;
	playerName: string;
	fromTeamId: string;
	toTeamId: string;
}

/**
 * Resolves each configured transfer against the generated player profiles.
 *
 * "From" team is `entry.from` when given; otherwise it comes from the
 * player's team_history (the most recently completed span), falling back
 * to current_team_id if team_history is still empty (the Sheet hasn't
 * recorded the move in a new week yet).
 *
 * An entry that resolves to the same "from" and "to" team is dropped
 * rather than shown as a nonsensical "Team X -> Team X" line — this is
 * usually the empty-team_history fallback landing on the pre-move team
 * that happens to equal `to` (e.g. a data-entry mixup, or the Sheet
 * genuinely hasn't caught up and no explicit `from` was given to work
 * around that).
 *
 * Entries for a name not found in profiles (typo, or the profile hasn't
 * been generated yet), or a `to`/`from` team name that isn't one of that
 * league's teams, are silently skipped rather than crashing the homepage
 * build. transfer-news.json stays name-based (it's typed by hand); names are
 * turned into ids here and compared as ids.
 */
export function resolveTransfers(
	entries: TransferEntry[],
	profiles: PlayerProfile[],
	leagueId: string,
): ResolvedTransfer[] {
	const byName = new Map(profiles.map((profile) => [profile.name, profile]));
	const league = getLeague(leagueId);

	return entries.flatMap((entry) => {
		const profile = byName.get(entry.player);
		const section = profile && getSection(profile, leagueId);
		if (!profile || !section) return [];

		const lastSegment = section.team_history[section.team_history.length - 1];
		const fromTeamId = entry.from
			? getTeamIdByName(entry.from, league)
			: (lastSegment?.team_id ?? section.current_team_id);
		const toTeamId = getTeamIdByName(entry.to, league);

		if (!fromTeamId || !toTeamId || fromTeamId === toTeamId) return [];

		return [{ playerId: profile.id, playerName: profile.name, fromTeamId, toTeamId }];
	});
}

export type PlayerSortKey = "name" | "team";

/**
 * Sort players by name or team — never by any performance stat. This is a
 * celebration page, not a leaderboard (that already exists on /league);
 * keep it that way if you touch this function.
 */
export function sortPlayers(
	players: PlayerInLeague[],
	sortBy: PlayerSortKey,
	league: League | undefined,
): PlayerInLeague[] {
	const collator = new Intl.Collator("ko");
	const team = (entry: PlayerInLeague) => getTeamName(entry.section.current_team_id, league);
	return [...players].sort((a, b) => {
		if (sortBy === "team") {
			return (
				collator.compare(team(a), team(b)) ||
				collator.compare(a.player.name, b.player.name)
			);
		}
		return collator.compare(a.player.name, b.player.name);
	});
}
