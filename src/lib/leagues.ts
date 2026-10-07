// Shared types/helpers for src/data/leagues.json, which scripts/update_data.py
// builds from the Sheet's teams tab and src/data/league-config.json. A league
// (e.g. FA26-L1) has its own teams, colors and rules, and restarts at week 1;
// nothing here (or anywhere else on the site) combines stats across leagues.

import profilesData from "../data/player_profiles.json";
import leaguesData from "../data/leagues.json";

export interface LeagueTeam {
	team_id: string;
	name: string;
	color: string | null;
}

export type RankingCriterion = "points" | "participation_rate" | "goal_difference" | "goals_for";

export interface LeagueRules {
	weeks: number;
	final_week: number;
	win_points: number;
	final_win_points: number;
	draw_points: number;
	matches_per_week: number;
	matches_per_pair_per_week: number;
	ranking_criteria: RankingCriterion[];
}

export interface League {
	id: string;
	/** The most recent league with at least one completed match — the site's default. */
	latest: boolean;
	/** Has at least one completed match. */
	started: boolean;
	rules: LeagueRules;
	teams: LeagueTeam[];
}

/** In teams-tab order, i.e. oldest first. */
export const leagues = leaguesData as League[];

export const latestLeague: League = leagues.find((league) => league.latest) ?? leagues[leagues.length - 1];

/**
 * The league the League menu (/league) and /players open on: the newest
 * league on the teams tab that already has players entered — so a new
 * league's page is the default as soon as its rosters are on the Sheet,
 * before its first game. Everything else that's about results (homepage
 * standings, finale banner, "latest" in the data) still uses latestLeague,
 * which only moves once the new league has a completed match.
 */
export const currentLeague: League =
	[...leagues].reverse().find((league) => profilesData.some((player) => player.leagues.some((section) => section.league === league.id))) ??
	latestLeague;

/**
 * The season shown in the header and on the Schedule page, e.g. "FA26": the
 * part of the current league's id before the first "-" (FA26-L2 -> FA26), so
 * it moves to SP27 by itself once SP27's first league is on the Sheet.
 */
export const currentSeason: string = currentLeague.id.split("-")[0];

export function getLeague(id: string): League | undefined {
	return leagues.find((league) => league.id === id);
}

export const DEFAULT_TEAM_COLOR = "#7f8c8d";

// The generated JSON refers to teams only by team_id (T1, T2, ...), which is
// unique only within a league — so every lookup goes through the league.
// Names are joined back in here, at render time.

function findTeam(teamId: string | null, league: League | undefined): LeagueTeam | undefined {
	return teamId ? league?.teams.find((entry) => entry.team_id === teamId) : undefined;
}

/**
 * A team's display name. A null id (a fixture whose teams aren't decided
 * yet, e.g. the finals week) reads as "TBD"; an id missing from the league
 * falls back to the raw id rather than breaking the page.
 */
export function getTeamName(teamId: string | null, league: League | undefined): string {
	if (!teamId) return "TBD";
	return findTeam(teamId, league)?.name ?? teamId;
}

/** team_id for a team name as typed by hand (e.g. transfer-news.json), within one league. */
export function getTeamIdByName(name: string, league: League | undefined): string | undefined {
	return league?.teams.find((entry) => entry.name === name)?.team_id;
}

/**
 * A team's color, from its league's entry on the teams tab. Falls back to a
 * neutral gray when the league or team is unknown or has no color yet.
 */
export function getTeamColor(teamId: string | null, league: League | undefined): string {
	return findTeam(teamId, league)?.color || DEFAULT_TEAM_COLOR;
}
