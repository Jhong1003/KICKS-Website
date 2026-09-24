// Shared types/helpers for src/data/leagues.json, which scripts/update_data.py
// builds from the Sheet's teams tab and src/data/league-config.json. A league
// (e.g. FA26-L1) has its own teams, colors and rules, and restarts at week 1;
// nothing here (or anywhere else on the site) combines stats across leagues.

import leaguesData from "../data/leagues.json";

export interface LeagueTeam {
	team_id: string;
	name: string;
	color: string | null;
}

export interface LeagueRules {
	weeks: number;
	final_week: number;
	win_points: number;
	final_win_points: number;
	draw_points: number;
	matches_per_week: number;
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

export function getLeague(id: string): League | undefined {
	return leagues.find((league) => league.id === id);
}

export const DEFAULT_TEAM_COLOR = "#7f8c8d";

/**
 * A team's color, from its league's entry on the teams tab. Falls back to a
 * neutral gray when the league or team is unknown or has no color yet.
 */
export function getTeamColor(team: string, league: League | undefined): string {
	return league?.teams.find((entry) => entry.name === team)?.color || DEFAULT_TEAM_COLOR;
}
