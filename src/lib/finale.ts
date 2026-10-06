// Homepage "league finale" banner: once the site's latest league is finished
// (every fixture has a score), announce its champion, Golden Boot (most goals)
// and top assists. It goes away by itself when the next league records its
// first result, because that league then becomes the latest and isn't finished.
//
// Ties share the award (co-winners), for goals and assists alike. Players
// marked inactive are left out, same as the leaderboard on /league. Nothing
// here is hand-edited: it all comes from the generated JSON.

import leaderboardData from "../data/player_leaderboard.json";
import leagueTableData from "../data/league_table.json";
import matchesData from "../data/matches.json";
import profilesData from "../data/player_profiles.json";
import type { League } from "./leagues";

export interface FinaleWinner {
	/** URL slug for /players/<id>. */
	id: string;
	name: string;
}

export interface LeagueAward {
	winners: FinaleWinner[];
	count: number;
}

export interface LeagueFinale {
	championTeamIds: string[];
	goldenBoot: LeagueAward | null;
	topAssists: LeagueAward | null;
}

interface MatchRow {
	league: string;
	home_score: number | null;
	away_score: number | null;
}

interface LeaderboardRow {
	league: string;
	player_id: string;
	id: string;
	goals: number;
	assists: number;
	status: string;
}

/** Same rule as the pipeline's Champion badge (_champions in update_data.py). */
export function isLeagueFinished(leagueId: string): boolean {
	const matches = (matchesData as MatchRow[]).filter((match) => match.league === leagueId);
	return matches.length > 0 && matches.every((match) => match.home_score !== null && match.away_score !== null);
}

interface MatchWeekRow extends MatchRow {
	week: number;
}

interface ProfileForVisibility {
	status: string;
	leagues: { league: string; weekly_stats: { week: number }[] }[];
}

/**
 * Whether a player is listed for a league on /players and in that league's
 * Player Stats. Active (and new) players always are. A player marked
 * inactive (left the club) is still listed in a *finished* league they
 * played through to its last week — they were part of that league until the
 * end — but not in a league they walked out of mid-way, nor in an unfinished
 * one.
 */
export function isShownInLeague(player: ProfileForVisibility, leagueId: string): boolean {
	const section = player.leagues.find((entry) => entry.league === leagueId);
	if (!section) return false;
	if (player.status !== "inactive") return true;
	if (!isLeagueFinished(leagueId)) return false;
	const weeks = (matchesData as MatchWeekRow[]).filter((match) => match.league === leagueId).map((match) => match.week);
	const lastWeek = Math.max(...weeks);
	return section.weekly_stats.some((stat) => stat.week === lastWeek);
}

export function getLeagueFinale(league: League): LeagueFinale | null {
	if (!isLeagueFinished(league.id)) return null;

	const championTeamIds = leagueTableData
		.filter((row) => row.league === league.id && row.rank === 1)
		.map((row) => row.team_id);

	const names = new Map(profilesData.map((profile) => [profile.player_id, profile.name]));
	const rows = (leaderboardData as LeaderboardRow[]).filter(
		(row) => row.league === league.id && row.status !== "inactive",
	);

	const award = (stat: "goals" | "assists"): LeagueAward | null => {
		const count = Math.max(0, ...rows.map((row) => row[stat]));
		if (count === 0) return null;
		const winners = rows
			.filter((row) => row[stat] === count)
			.map((row) => ({ id: row.id, name: names.get(row.player_id) ?? row.player_id }))
			.sort((a, b) => a.name.localeCompare(b.name, "ko"));
		return { winners, count };
	};

	return { championTeamIds, goldenBoot: award("goals"), topAssists: award("assists") };
}
