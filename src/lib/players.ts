// Shared types/helpers for src/data/player_profiles.json, used by the
// /players grid and /players/[id] detail pages. The badge/tag *rules* live
// in scripts/update_data.py (that's what computes them) — this file only
// carries the display metadata (label/description/icon) for each badge
// key, and small view helpers. See AGENTS.md's "Player profiles" section
// for the full rules writeup.

export interface TeamSegment {
	team: string;
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
	team: string;
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

export type PlayStyleTag = "Finisher" | "Playmaker" | "All-Rounder" | "Iron Man" | "Team Player";

/** Matches the `players` tab's `status` column — see AGENTS.md's "Player status" section. */
export type PlayerStatus = "active" | "new" | "inactive";

/** Matches the `players` tab's `primary_position`/`secondary_position` columns. */
export type PlayerPosition = "GK" | "DF" | "MF" | "FW";

export type BadgeKey =
	| "first_goal"
	| "first_assist"
	| "brace"
	| "hat_trick"
	| "perfect_attendance"
	| "week1_starter"
	| "rookie"
	| "own_goal_award"
	| "squad_member";

export interface PlayerProfile {
	id: string;
	name: string;
	avatar_initials: string;
	positions: PlayerPosition[];
	status: PlayerStatus;
	current_team: string;
	team_history: TeamSegment[];
	season_totals: SeasonTotals;
	weekly_stats: WeeklyStat[];
	personal_best_week: PersonalBestWeek | null;
	play_style_tag: PlayStyleTag;
	badges: BadgeKey[];
}

// Deliberately no rating/score field anywhere on this type — this is a
// friendly club site, not a scouting report. See AGENTS.md.

export const BADGES: Record<BadgeKey, { label: string; description: string; icon: string }> = {
	first_goal: { label: "First Goal", description: "Scored a goal this season.", icon: "⚽" },
	first_assist: { label: "First Assist", description: "Set up a teammate's goal this season.", icon: "🎯" },
	brace: { label: "Brace", description: "Scored 2+ goals in a single week.", icon: "✌️" },
	hat_trick: { label: "Hat-trick", description: "Scored 3+ goals in a single week.", icon: "🎩" },
	perfect_attendance: {
		label: "Perfect Attendance",
		description: "Hasn't missed a week so far this season.",
		icon: "📅",
	},
	week1_starter: {
		label: "Week 1 Starter",
		description: "Part of the squad since the very first week of the season.",
		icon: "🚩",
	},
	rookie: { label: "Rookie", description: "Just joined the squad this season.", icon: "🌱" },
	own_goal_award: {
		label: "Own Goal Award",
		description: "Generously contributed a goal to the other team's tally. It happens to the best of us!",
		icon: "🪃",
	},
	squad_member: { label: "Squad Member", description: "A valued part of the KICKS roster.", icon: "🤝" },
};

export function getTeamColor(team: string, colors: Record<string, string>): string {
	return colors[team] ?? colors["_default"] ?? "#7f8c8d";
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
 * future team-colors.json edit (e.g. real bib colors) can't accidentally
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
// their team just before the move.

export interface TransferEntry {
	player: string;
	to: string;
	/**
	 * Optional explicit "from" team, overriding the automatic lookup from
	 * player_profiles.json. Use this when the Sheet hasn't recorded the
	 * move in a new week yet — team_history is still empty in that case
	 * and current_team can't be trusted as "the team before the move"
	 * (it may still show the old team, or may have been edited ahead of
	 * time and show something else entirely). Safe to remove once a real
	 * week under the new team has been entered and regenerated.
	 */
	from?: string;
}

export interface ResolvedTransfer {
	playerId: string;
	playerName: string;
	fromTeam: string;
	toTeam: string;
}

/**
 * Resolves each configured transfer against the generated player profiles.
 *
 * "From" team is `entry.from` when given; otherwise it comes from the
 * player's team_history (the most recently completed span), falling back
 * to current_team if team_history is still empty (the Sheet hasn't
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
 * been generated yet) are silently skipped rather than crashing the
 * homepage build.
 */
export function resolveTransfers(entries: TransferEntry[], profiles: PlayerProfile[]): ResolvedTransfer[] {
	const byName = new Map(profiles.map((profile) => [profile.name, profile]));

	return entries.flatMap((entry) => {
		const profile = byName.get(entry.player);
		if (!profile) return [];

		const lastSegment = profile.team_history[profile.team_history.length - 1];
		const fromTeam = entry.from ?? (lastSegment ? lastSegment.team : profile.current_team);

		if (fromTeam === entry.to) return [];

		return [{ playerId: profile.id, playerName: profile.name, fromTeam, toTeam: entry.to }];
	});
}

export type PlayerSortKey = "name" | "team";

/**
 * Sort players by name or team — never by any performance stat. This is a
 * celebration page, not a leaderboard (that already exists on /league);
 * keep it that way if you touch this function.
 */
export function sortPlayers(players: PlayerProfile[], sortBy: PlayerSortKey): PlayerProfile[] {
	const collator = new Intl.Collator("ko");
	return [...players].sort((a, b) => {
		if (sortBy === "team") {
			return collator.compare(a.current_team, b.current_team) || collator.compare(a.name, b.name);
		}
		return collator.compare(a.name, b.name);
	});
}
