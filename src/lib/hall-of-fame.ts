// KICKS 2.0 Hall of Fame: everything the page shows, worked out from the
// generated JSON (later: from D1). Emphasis drops from top to bottom —
// champions, awards, three all-time numbers, then the detailed records.
//
// Same rules as the rest of the site: only finished leagues get honours,
// ties share, inactive players are left out unless they played a finished
// league to its end (isShownInLeague), and a team is always (league, team).

import leagueTableData from "../data/league_table.json";
import matchesData from "../data/matches.json";
import profilesData from "../data/player_profiles.json";
import teamInfoData from "../data/team-info.json";
import { getLeagueFinale, isLeagueFinished, isShownInLeague } from "./finale";
import { getLeague, getTeamColor, getTeamName, leagueParts, leagues, type League } from "./leagues";
import { getSection, type PlayerProfile } from "./players";
import { buildClubRecords, type ClubRecord } from "./records";
import { AWARDS, manualAwards, type AwardKey } from "./awards";

const profiles = profilesData as PlayerProfile[];
const teamInfo = teamInfoData as Record<string, Record<string, { captain?: string }>>;

export interface Person {
	id: string;
	name: string;
	initials: string;
	captain: boolean;
}

const initials = (name: string) => (name.length <= 2 ? name : name.slice(-2));

export function captainName(leagueId: string, teamId: string): string | undefined {
	return teamInfo[leagueId]?.[teamId]?.captain;
}

/** A team's players in a league: captain first, then by name. */
export function teamRoster(league: League, teamId: string): Person[] {
	const captain = captainName(league.id, teamId);
	return profiles
		.filter((player) => isShownInLeague(player, league.id) && getSection(player, league.id)?.current_team_id === teamId)
		.map((player) => ({ id: player.id, name: player.name, initials: initials(player.name), captain: player.name === captain }))
		.sort((a, b) => Number(b.captain) - Number(a.captain) || a.name.localeCompare(b.name, "ko"));
}

export const finishedLeagues: League[] = leagues.filter((league) => isLeagueFinished(league.id)).reverse();

// ---------- Champions ----------

export interface ChampionCard {
	league: League;
	title: string;
	teamId: string;
	name: string;
	color: string;
	roster: Person[];
}

export function championCards(list: League[] = finishedLeagues): ChampionCard[] {
	return list.flatMap((league) =>
		(getLeagueFinale(league)?.championTeamIds ?? []).map((teamId) => ({
			league,
			title: `${leagueParts(league.id).season} ${leagueParts(league.id).name}`,
			teamId,
			name: getTeamName(teamId, league),
			color: getTeamColor(teamId, league),
			roster: teamRoster(league, teamId),
		})),
	);
}

// ---------- Awards ----------

export interface AwardWinnerCard {
	id?: string;
	name: string;
	initials: string;
	teamName?: string;
	color: string;
}

export interface AwardCardData {
	key: AwardKey;
	en: string;
	ko: string;
	scopeLabel: string;
	leagueId?: string;
	winners: AwardWinnerCard[];
	value?: number;
	unit?: { en: string; ko: string };
	note?: string;
}

function winnerCard(league: League | undefined, id: string | undefined, name: string): AwardWinnerCard {
	const player = profiles.find((profile) => (id ? profile.id === id : profile.name === name));
	const teamId = league && player ? getSection(player, league.id)?.current_team_id ?? null : null;
	return {
		id: player?.id,
		name,
		initials: initials(name),
		teamName: league && teamId ? getTeamName(teamId, league) : undefined,
		color: league && teamId ? getTeamColor(teamId, league) : "#3f5128",
	};
}

/** Golden Boot, Playmaker and any board-chosen awards for one finished league. */
export function leagueAwardCards(league: League): AwardCardData[] {
	const finale = getLeagueFinale(league);
	const { name } = leagueParts(league.id);
	const cards: AwardCardData[] = [];
	if (finale?.goldenBoot) {
		cards.push({
			key: "golden_boot",
			...AWARDS.golden_boot,
			scopeLabel: name,
			leagueId: league.id,
			winners: finale.goldenBoot.winners.map((winner) => winnerCard(league, winner.id, winner.name)),
			value: finale.goldenBoot.count,
			unit: { en: "goals", ko: "골" },
		});
	}
	if (finale?.topAssists) {
		cards.push({
			key: "playmaker",
			...AWARDS.playmaker,
			scopeLabel: name,
			leagueId: league.id,
			winners: finale.topAssists.winners.map((winner) => winnerCard(league, winner.id, winner.name)),
			value: finale.topAssists.count,
			unit: { en: "assists", ko: "어시스트" },
		});
	}
	for (const entry of manualAwards(league.id)) {
		cards.push({
			key: entry.key,
			...AWARDS[entry.key],
			scopeLabel: name,
			leagueId: league.id,
			winners: entry.winners.map((winner) => winnerCard(league, winner.id, winner.name)),
			note: entry.note,
		});
	}
	return cards;
}

/** Season awards (Ballon d'Or, Puskás): no league, so no team color. */
export function seasonAwardCards(season: string): AwardCardData[] {
	return manualAwards(season).map((entry) => ({
		key: entry.key,
		...AWARDS[entry.key],
		scopeLabel: season,
		winners: entry.winners.map((winner) => winnerCard(undefined, winner.id, winner.name)),
		note: entry.note,
	}));
}

// ---------- All-time ----------

export interface AllTimeRecord {
	key: string;
	en: string;
	ko: string;
	value: number;
	holders: Person[];
}

function topOf(entries: { player: PlayerProfile; value: number }[]): { value: number; holders: Person[] } {
	const value = Math.max(0, ...entries.map((entry) => entry.value));
	const holders =
		value > 0
			? entries
					.filter((entry) => entry.value === value)
					.map(({ player }) => ({ id: player.id, name: player.name, initials: initials(player.name), captain: false }))
					.sort((a, b) => a.name.localeCompare(b.name, "ko"))
			: [];
	return { value, holders };
}

export function allTimeRecords(): AllTimeRecord[] {
	const champions = new Set(
		finishedLeagues.flatMap((league) => (getLeagueFinale(league)?.championTeamIds ?? []).map((teamId) => `${league.id}|${teamId}`)),
	);
	const shown = (player: PlayerProfile) => player.leagues.filter((section) => isShownInLeague(player, section.league));
	const totals = profiles.map((player) => {
		const sections = shown(player);
		return {
			player,
			titles: sections.filter((section) => champions.has(`${section.league}|${section.current_team_id}`)).length,
			goals: sections.reduce((sum, section) => sum + section.season_totals.goals, 0),
			assists: sections.reduce((sum, section) => sum + section.season_totals.assists, 0),
		};
	});
	const records: AllTimeRecord[] = [];
	const add = (key: string, en: string, ko: string, pick: (t: (typeof totals)[number]) => number) => {
		const top = topOf(totals.map((t) => ({ player: t.player, value: pick(t) })));
		if (top.holders.length) records.push({ key, en, ko, ...top });
	};
	add("titles", "Most titles", "최다 우승", (t) => t.titles);
	add("goals", "Most goals", "통산 최다 골", (t) => t.goals);
	add("assists", "Most assists", "통산 최다 어시스트", (t) => t.assists);
	return records;
}

// ---------- Detailed records ----------

export interface RecordLine {
	key: string;
	en: string;
	ko: string;
	value: number;
	unit: { en: string; ko: string };
	holders: { name: string; href?: string; contextEn: string; contextKo: string }[];
}

const weekContext = (leagueId: string, week: number) => {
	const { season, name } = leagueParts(leagueId);
	return { contextEn: `${season} ${name} · Week ${week}`, contextKo: `${season} ${name} · ${week}주차` };
};
const leagueContext = (leagueId: string) => {
	const { season, name } = leagueParts(leagueId);
	return { contextEn: `${season} ${name}`, contextKo: `${season} ${name}` };
};

function fromClubRecord(record: ClubRecord | undefined, en: string, ko: string): RecordLine | null {
	if (!record) return null;
	return {
		key: record.key,
		en,
		ko,
		value: record.value,
		unit: record.unit,
		holders: record.holders.map((holder) => {
			// records.ts writes "FA26-L1 · Week 3" / "FA26-L1"; rename to "FA26 League 1 · Week 3".
			const match = holder.context.en.match(/^(\S+?)(?: · Week (\d+))?$/);
			const context = match ? (match[2] ? weekContext(match[1], Number(match[2])) : leagueContext(match[1])) : { contextEn: holder.context.en, contextKo: holder.context.ko };
			return {
				name: holder.name,
				href: holder.playerId ? `/players/${holder.playerId}/${holder.league ? `?league=${holder.league}` : ""}` : undefined,
				...context,
			};
		}),
	};
}

interface MatchRow {
	league: string;
	week: number;
	match_id: string;
	home_team_id: string | null;
	away_team_id: string | null;
	home_score: number | null;
	away_score: number | null;
}

/** Longest run of matches without a loss, by one team inside one league, in match order. */
function longestUnbeaten(): RecordLine | null {
	const matches = (matchesData as MatchRow[])
		.filter((m) => m.home_score !== null && m.away_score !== null)
		.sort((a, b) => a.match_id.localeCompare(b.match_id));
	const runs = new Map<string, { current: number; best: number; league: string; teamId: string }>();
	for (const m of matches) {
		for (const [teamId, own, other] of [
			[m.home_team_id, m.home_score!, m.away_score!],
			[m.away_team_id, m.away_score!, m.home_score!],
		] as const) {
			if (!teamId) continue;
			const key = `${m.league}|${teamId}`;
			const run = runs.get(key) ?? { current: 0, best: 0, league: m.league, teamId };
			run.current = own >= other ? run.current + 1 : 0;
			run.best = Math.max(run.best, run.current);
			runs.set(key, run);
		}
	}
	const all = [...runs.values()];
	const value = Math.max(0, ...all.map((run) => run.best));
	if (!value) return null;
	return {
		key: "unbeaten",
		en: "Longest unbeaten run",
		ko: "최장 무패",
		value,
		unit: { en: "matches", ko: "경기" },
		holders: all
			.filter((run) => run.best === value)
			.map((run) => ({ name: getTeamName(run.teamId, getLeague(run.league)), ...leagueContext(run.league) })),
	};
}

function leagueTableBest(key: string, en: string, ko: string, unit: { en: string; ko: string }, pick: (row: (typeof leagueTableData)[number]) => number, lowest = false): RecordLine | null {
	const finishedIds = new Set(finishedLeagues.map((league) => league.id));
	const rows = leagueTableData.filter((row) => finishedIds.has(row.league));
	if (!rows.length) return null;
	const values = rows.map(pick);
	const value = lowest ? Math.min(...values) : Math.max(...values);
	return {
		key,
		en,
		ko,
		value,
		unit,
		holders: rows
			.filter((row) => pick(row) === value)
			.map((row) => ({ name: getTeamName(row.team_id, getLeague(row.league)), ...leagueContext(row.league) })),
	};
}

export function detailedRecords(): { players: RecordLine[]; teams: RecordLine[] } {
	const club = buildClubRecords();
	const byKey = (key: string) => club.find((record) => record.key === key);
	const players = [
		fromClubRecord(byKey("week-goals"), "Most goals in a week", "한 주 최다 골"),
		fromClubRecord(byKey("week-assists"), "Most assists in a week", "한 주 최다 어시스트"),
		fromClubRecord(byKey("league-goals"), "Most goals in a league", "한 리그 최다 골"),
		fromClubRecord(byKey("league-assists"), "Most assists in a league", "한 리그 최다 어시스트"),
	].filter((line): line is RecordLine => line !== null);
	const teams = [
		leagueTableBest("points", "Most points in a league", "한 리그 최다 승점", { en: "pts", ko: "점" }, (row) => row.points),
		leagueTableBest("conceded", "Fewest goals conceded", "한 리그 최소 실점", { en: "conceded", ko: "실점" }, (row) => row.goals_against, true),
		longestUnbeaten(),
		fromClubRecord(byKey("biggest-win"), "Biggest win", "최다 점수 차 승리"),
		fromClubRecord(byKey("team-week-goals"), "Most goals in a week", "한 주 최다 득점"),
	].filter((line): line is RecordLine => line !== null);
	return { players, teams };
}
