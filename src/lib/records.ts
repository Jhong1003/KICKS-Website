// Club records ("KICKS Records"): the best single-week and single-league
// performances across every league so far, computed from the generated JSON.
//
// Ties share a record (every holder is listed). Inactive players are left
// out, same as everywhere else on the site. L1 was recorded as weekly totals,
// so player records are per week or per league; per-match player records
// (e.g. most goals in a match) can be added once goal_events has data (FA26-L2).

import matchesData from "../data/matches.json";
import profilesData from "../data/player_profiles.json";
import { isShownInLeague } from "./finale";
import { getLeague, getTeamName } from "./leagues";
import type { PlayerProfile } from "./players";
import type { Text } from "./wrapped";

export interface RecordHolder {
	/** Player slug for a /players/<id> link; absent for team records. */
	playerId?: string;
	name: string;
	/** Where it happened, e.g. "FA26-L1 · Week 3". */
	context: Text;
}

export interface ClubRecord {
	key: string;
	icon: string;
	label: Text;
	value: number;
	unit: Text;
	holders: RecordHolder[];
	/** Optional extra line, e.g. the scoreline of the biggest win. */
	detail?: Text;
}

interface MatchRow {
	league: string;
	week: number;
	home_team_id: string | null;
	away_team_id: string | null;
	home_score: number | null;
	away_score: number | null;
}

const weekText = (league: string, week: number): Text => ({ en: `${league} · Week ${week}`, ko: `${league} · ${week}주차` });
const leagueText = (league: string): Text => ({ en: league, ko: league });

/** Keeps the entries with the highest value (all of them on a tie); none if the best is 0. */
function best<T>(items: T[], value: (item: T) => number): { value: number; items: T[] } {
	const top = Math.max(0, ...items.map(value));
	return { value: top, items: top > 0 ? items.filter((item) => value(item) === top) : [] };
}

export function buildClubRecords(): ClubRecord[] {
	// A player's league counts if they're listed in it (isShownInLeague):
	// inactive players keep the leagues they played through to the end.
	const players = profilesData as PlayerProfile[];
	const shownSections = (player: PlayerProfile) =>
		player.leagues.filter((section) => isShownInLeague(player, section.league));
	const weeks = players.flatMap((player) =>
		shownSections(player).flatMap((section) =>
			section.weekly_stats.map((week) => ({ player, league: section.league, ...week })),
		),
	);
	const seasons = players.flatMap((player) =>
		shownSections(player).map((section) => ({ player, league: section.league, ...section.season_totals })),
	);
	const matches = (matchesData as MatchRow[]).filter((match) => match.home_score !== null && match.away_score !== null);
	const records: ClubRecord[] = [];

	const playerWeek = (key: string, icon: string, label: Text, unit: (n: number) => Text, pick: (w: (typeof weeks)[number]) => number) => {
		const top = best(weeks, pick);
		if (top.items.length === 0) return;
		records.push({
			key,
			icon,
			label,
			value: top.value,
			unit: unit(top.value),
			holders: top.items.map((w) => ({ playerId: w.player.id, name: w.player.name, context: weekText(w.league, w.week) })),
		});
	};
	const playerLeague = (key: string, icon: string, label: Text, unit: (n: number) => Text, pick: (s: (typeof seasons)[number]) => number) => {
		const top = best(seasons, pick);
		if (top.items.length === 0) return;
		records.push({
			key,
			icon,
			label,
			value: top.value,
			unit: unit(top.value),
			holders: top.items.map((s) => ({ playerId: s.player.id, name: s.player.name, context: leagueText(s.league) })),
		});
	};

	const goals = (n: number): Text => ({ en: n === 1 ? "goal" : "goals", ko: "골" });
	const assists = (n: number): Text => ({ en: n === 1 ? "assist" : "assists", ko: "어시스트" });
	const points = (n: number): Text => ({ en: n === 1 ? "attacking point" : "attacking points", ko: "공격포인트" });

	playerWeek("week-goals", "⚽", { en: "Most goals in a week", ko: "한 주 최다골" }, goals, (w) => w.goals);
	playerWeek("week-assists", "🎯", { en: "Most assists in a week", ko: "한 주 최다 어시스트" }, assists, (w) => w.assists);
	playerWeek("week-points", "🔥", { en: "Most attacking points in a week", ko: "한 주 최다 공격포인트" }, points, (w) => w.goals + w.assists);
	playerLeague("league-goals", "👟", { en: "Most goals in a league", ko: "한 리그 최다골" }, goals, (s) => s.goals);
	playerLeague("league-assists", "🎼", { en: "Most assists in a league", ko: "한 리그 최다 어시스트" }, assists, (s) => s.assists);

	// Biggest winning margin in a single match.
	const margin = best(matches, (m) => Math.abs((m.home_score as number) - (m.away_score as number)));
	if (margin.items.length > 0) {
		records.push({
			key: "biggest-win",
			icon: "💥",
			label: { en: "Biggest win", ko: "최다 점수차 승리" },
			value: margin.value,
			unit: { en: margin.value === 1 ? "goal margin" : "goal margin", ko: "점차" },
			holders: margin.items.map((m) => {
				const league = getLeague(m.league);
				const homeWon = (m.home_score as number) > (m.away_score as number);
				const [winner, loser] = homeWon ? [m.home_team_id, m.away_team_id] : [m.away_team_id, m.home_team_id];
				const [high, low] = homeWon ? [m.home_score, m.away_score] : [m.away_score, m.home_score];
				return {
					name: `${getTeamName(winner, league)} ${high}–${low} ${getTeamName(loser, league)}`,
					context: weekText(m.league, m.week),
				};
			}),
		});
	}

	// Most goals by one team in a week (all its matches that week).
	const teamWeeks = new Map<string, { league: string; week: number; teamId: string; goals: number }>();
	for (const m of matches) {
		for (const [teamId, scored] of [
			[m.home_team_id, m.home_score],
			[m.away_team_id, m.away_score],
		] as const) {
			if (!teamId) continue;
			const key = `${m.league}|${m.week}|${teamId}`;
			const entry = teamWeeks.get(key) ?? { league: m.league, week: m.week, teamId, goals: 0 };
			entry.goals += scored as number;
			teamWeeks.set(key, entry);
		}
	}
	const teamBest = best([...teamWeeks.values()], (entry) => entry.goals);
	if (teamBest.items.length > 0) {
		records.push({
			key: "team-week-goals",
			icon: "🏟️",
			label: { en: "Most team goals in a week", ko: "팀 한 주 최다 득점" },
			value: teamBest.value,
			unit: goals(teamBest.value),
			holders: teamBest.items.map((entry) => ({
				name: getTeamName(entry.teamId, getLeague(entry.league)),
				context: weekText(entry.league, entry.week),
			})),
		});
	}

	return records;
}
