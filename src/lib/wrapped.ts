// KICKS Wrapped: a player's end-of-league recap (/wrapped/<league>/<id>).
//
// Everything is computed at build time from the generated JSON, per league,
// and only for *finished* leagues (every fixture scored). The recap is a
// celebration, not a scouting report, so:
//
// - League ranks are only mentioned when they're good: top 3, or top 25% of
//   the league's active players ("Top 25%" rather than "7th"). Ties share a rank.
// - Every player gets several highlights to pick from (team/position leader,
//   share of team goals, clutch final week, ...), and the best three are shown.
//   Each one has a guard so it can't be hollow or misleading on tiny samples
//   (see the comments below); nothing here claims a player *caused* a result.
// - Absences are never spelled out: we say "12 games played", never "2 of 4 weeks".
// - Own goals get a fun slide but never a highlight or the shareable card.

import leaderboardData from "../data/player_leaderboard.json";
import leagueTableData from "../data/league_table.json";
import matchesData from "../data/matches.json";
import profilesData from "../data/player_profiles.json";
import { isLeagueFinished } from "./finale";
import { getTeamName, type League } from "./leagues";
import { getSection, type PlayerLeagueSection, type PlayerPosition, type PlayerProfile } from "./players";

export interface Text {
	en: string;
	ko: string;
}

export interface Highlight {
	/** What kind of fact this is — used to keep the top three varied. */
	kind: string;
	icon: string;
	title: Text;
	sub: Text;
	/** Higher = more impressive; only used to pick the top three. */
	score: number;
}

export interface TeamResult {
	teamId: string;
	teamName: string;
	rank: number;
	champion: boolean;
}

export interface WrappedData {
	league: { id: string; weeks: number; matches: number; goals: number };
	games: number;
	goals: number;
	assists: number;
	attackingPoints: number;
	highlights: Highlight[];
	/** The team the player finished the league with, plus any earlier team. */
	team: TeamResult;
	previousTeams: string[];
	ownGoalAward: boolean;
}

interface MatchRow {
	league: string;
	week: number;
	home_team_id: string | null;
	away_team_id: string | null;
	home_score: number | null;
	away_score: number | null;
}

interface LeaderboardRow {
	league: string;
	player_id: string;
	goals: number;
	assists: number;
	attacking_points: number;
	status: string;
}

type Stat = "goals" | "assists" | "attacking_points";

const STAT_TEXT: Record<Stat, Text> = {
	goals: { en: "goals", ko: "득점" },
	assists: { en: "assists", ko: "도움" },
	attacking_points: { en: "attacking points", ko: "공격포인트" },
};

const AWARD_TEXT: Partial<Record<Stat, Text>> = {
	goals: { en: "Golden Boot", ko: "득점왕" },
	assists: { en: "Top Assists", ko: "도움왕" },
};

const STAT_UNIT: Record<Stat, (n: number) => Text> = {
	goals: (n) => ({ en: `${n} goal${n === 1 ? "" : "s"}`, ko: `${n}골` }),
	assists: (n) => ({ en: `${n} assist${n === 1 ? "" : "s"}`, ko: `${n}어시스트` }),
	attacking_points: (n) => ({ en: `${n} attacking point${n === 1 ? "" : "s"}`, ko: `공격포인트 ${n}개` }),
};

const POSITION_TEXT: Record<PlayerPosition, Text> = {
	GK: { en: "goalkeepers", ko: "골키퍼" },
	DF: { en: "defenders", ko: "수비수" },
	MF: { en: "midfielders", ko: "미드필더" },
	FW: { en: "forwards", ko: "공격수" },
};

const STATS: Stat[] = ["goals", "assists", "attacking_points"];

/** Top-25% cutoff, but never fewer than the top 3. */
const TOP_SHARE = 0.25;
/** Share-of-team-goals needs this many weeks played, so one lucky week can't read as "50%". */
const CONTRIBUTION_MIN_WEEKS = 2;
const CONTRIBUTION_MIN_SHARE = 0.2;
/** A position group needs this many players, so "best GK" isn't automatic for the only GK. */
const POSITION_MIN_PLAYERS = 3;
const DEFENSE_MIN_CLEAN_SHEETS = 2;
/** "Rising": the last week played was the best, with at least this many attacking points. */
const RISING_MIN_POINTS = 2;

const profiles = profilesData as PlayerProfile[];
const matchesAll = matchesData as MatchRow[];

/** "문전박대와" / "오늘밤 샴페인과": 와 after a vowel, 과 after a final consonant. */
const withKo = (name: string) => {
	const code = name.charCodeAt(name.length - 1) - 0xac00;
	return `${name}${code >= 0 && code <= 11171 && code % 28 !== 0 ? "과" : "와"}`;
};

const pointsOf = (row: { goals: number; assists: number }) => row.goals + row.assists;

/** Competition rank (1 + how many are strictly better); ties share a rank. */
const rankOf = (value: number, values: number[]) => 1 + values.filter((other) => other > value).length;

/** Players that get a Wrapped page in this league: finished league, played in it, not inactive. */
export function wrappedPlayers(league: League): { player: PlayerProfile; section: PlayerLeagueSection }[] {
	if (!isLeagueFinished(league.id)) return [];
	return profiles.flatMap((player) => {
		const section = getSection(player, league.id);
		return section && player.status !== "inactive" ? [{ player, section }] : [];
	});
}

export function buildWrapped(player: PlayerProfile, section: PlayerLeagueSection, league: League): WrappedData {
	const matches = matchesAll.filter(
		(match) => match.league === league.id && match.home_score !== null && match.away_score !== null,
	);
	const active = profiles.flatMap((other) => {
		const otherSection = getSection(other, league.id);
		return otherSection && other.status !== "inactive" ? [{ player: other, section: otherSection }] : [];
	});
	const leaderboard = (leaderboardData as LeaderboardRow[]).filter(
		(row) => row.league === league.id && row.status !== "inactive",
	);
	const weeks = section.weekly_stats;
	const attended = weeks.filter((week) => week.games > 0);
	const totals = section.season_totals;
	const gamesPlayed = weeks.reduce((sum, week) => sum + week.games, 0);
	const highlights: Highlight[] = [];
	const coveredStats = new Set<Stat>();

	// 1. League rank — only when it's good.
	const cutoff = Math.max(3, Math.ceil(leaderboard.length * TOP_SHARE));
	for (const stat of STATS) {
		const value = totals[stat];
		if (value <= 0) continue;
		const values = leaderboard.map((row) => row[stat]);
		const rank = rankOf(value, values);
		if (rank > cutoff) continue;
		const tied = values.filter((other) => other === value).length > 1;
		coveredStats.add(stat);
		const label = STAT_TEXT[stat];
		// First place in goals/assists is an award in its own right (same names as
		// the homepage finale banner); ties share it.
		const award = rank === 1 ? AWARD_TEXT[stat] : undefined;
		const awardEn = award ? ` (${tied ? "Joint " : ""}${award.en})` : "";
		const awardKo = award ? ` (${tied ? "공동 " : ""}${award.ko})` : "";
		highlights.push({
			kind: "rank",
			icon: rank === 1 ? "👑" : rank <= 3 ? "🏅" : "⭐",
			title:
				rank <= 3
					? {
							en: `${tied ? "T-" : "#"}${rank} in the league for ${label.en}${awardEn}`,
							ko: `리그 ${label.ko} ${tied ? "공동 " : ""}${rank}위${awardKo}`,
						}
					: { en: `Top 25% in the league for ${label.en}`, ko: `리그 ${label.ko} 상위 25%` },
			sub: STAT_UNIT[stat](value),
			score: rank <= 3 ? 100 - rank : 80,
		});
	}

	// Per-team totals for "team leader" (a mid-league move counts each team separately).
	const teamTotals = (teamId: string, rows: typeof weeks) =>
		rows
			.filter((week) => week.team_id === teamId)
			.reduce((sum, week) => ({ goals: sum.goals + week.goals, assists: sum.assists + week.assists }), {
				goals: 0,
				assists: 0,
			});

	// 2. Team leader — easier to reach than a league rank (there are only three teams).
	const myTeams = [...new Set(weeks.map((week) => week.team_id))];
	for (const teamId of myTeams) {
		const mine = teamTotals(teamId, weeks);
		const teammates = active
			.filter(({ section: other }) => other.weekly_stats.some((week) => week.team_id === teamId && week.games > 0))
			.map(({ section: other }) => teamTotals(teamId, other.weekly_stats));
		for (const stat of STATS) {
			if (coveredStats.has(stat)) continue;
			const value = stat === "attacking_points" ? pointsOf(mine) : mine[stat];
			if (value <= 0) continue;
			const values = teammates.map((row) => (stat === "attacking_points" ? pointsOf(row) : row[stat]));
			if (rankOf(value, values) !== 1) continue;
			coveredStats.add(stat);
			const name = getTeamName(teamId, league);
			const tied = values.filter((other) => other === value).length > 1;
			highlights.push({
				kind: "team",
			icon: "🥇",
				title: {
					en: `${tied ? "Joint top" : "Top"} for ${STAT_TEXT[stat].en} at ${name}`,
					ko: `${name} 팀 내 ${STAT_TEXT[stat].ko} ${tied ? "공동 " : ""}1위`,
				},
				sub: STAT_UNIT[stat](value),
				score: 70,
			});
		}
	}

	// 3. Position leader — only in groups big enough to mean something.
	const position = player.positions[0];
	if (position) {
		const group = active.filter(({ player: other }) => other.positions[0] === position);
		if (group.length >= POSITION_MIN_PLAYERS) {
			for (const stat of STATS) {
				if (coveredStats.has(stat)) continue;
				const value = totals[stat];
				if (value <= 0) continue;
				const values = group.map(({ section: other }) => other.season_totals[stat]);
				if (rankOf(value, values) !== 1) continue;
				coveredStats.add(stat);
				const tied = values.filter((other) => other === value).length > 1;
				highlights.push({
					kind: "position",
			icon: "🎖️",
					title: {
						en: `${tied ? "Joint best" : "Best"} among ${POSITION_TEXT[position].en} for ${STAT_TEXT[stat].en}`,
						ko: `${POSITION_TEXT[position].ko} 중 ${STAT_TEXT[stat].ko} ${tied ? "공동 " : ""}1위`,
					},
					sub: STAT_UNIT[stat](value),
					score: 68,
				});
			}
		}
	}

	// Team goals/clean sheets in the weeks this player was there.
	const teamWeek = (week: number, teamId: string) =>
		matches
			.filter((match) => match.week === week && (match.home_team_id === teamId || match.away_team_id === teamId))
			.map((match) =>
				match.home_team_id === teamId
					? { scored: match.home_score as number, conceded: match.away_score as number }
					: { scored: match.away_score as number, conceded: match.home_score as number },
			);
	const myTeamGames = attended.flatMap((week) => teamWeek(week.week, week.team_id));

	// 4. Share of team goals.
	const teamGoals = myTeamGames.reduce((sum, game) => sum + game.scored, 0);
	if (attended.length >= CONTRIBUTION_MIN_WEEKS && teamGoals > 0) {
		const share = pointsOf(totals) / teamGoals;
		if (share >= CONTRIBUTION_MIN_SHARE) {
			const pct = Math.round(share * 100);
			highlights.push({
				kind: "share",
			icon: "🔗",
				title: { en: `Involved in ${pct}% of the team's goals`, ko: `팀 골의 ${pct}%에 관여` },
				sub: { en: "in the weeks you played", ko: "함께 뛴 주 기준" },
				score: 60 + pct / 10,
			});
		}
	}

	// 5. Clean sheets alongside a defender/keeper (a weekly fact, not a claim of cause).
	if (position === "DF" || position === "GK") {
		const cleanSheets = myTeamGames.filter((game) => game.conceded === 0).length;
		if (cleanSheets >= DEFENSE_MIN_CLEAN_SHEETS) {
			highlights.push({
				kind: "defense",
			icon: "🧱",
				title: { en: `${cleanSheets} clean sheets`, ko: `무실점 ${cleanSheets}경기` },
				sub: { en: "kept by your team in the weeks you played", ko: "함께한 주에 팀이 기록" },
				score: 58,
			});
		}
	}

	// 6. Clutch: attacking points in the final week, when wins were worth more.
	const finalWeek = attended.find((week) => week.week === league.rules.final_week);
	if (finalWeek && pointsOf(finalWeek) >= 1) {
		highlights.push({
			kind: "clutch",
			icon: "⏱️",
			title: { en: "Delivered in the final week", ko: "가장 중요한 마지막 주에 해냈어요" },
			sub: {
				en: `${STAT_UNIT.attacking_points(pointsOf(finalWeek)).en} when a win was worth ${league.rules.final_win_points}`,
				ko: `승리가 ${league.rules.final_win_points}점인 ${league.rules.final_week}주차에 공격포인트 ${pointsOf(finalWeek)}개`,
			},
			score: 50 + pointsOf(finalWeek),
		});
	}

	// 7. Rising: the last week played was the best one, and a real one.
	if (attended.length >= 2) {
		const last = attended[attended.length - 1];
		const before = Math.max(...attended.slice(0, -1).map(pointsOf));
		if (pointsOf(last) >= RISING_MIN_POINTS && pointsOf(last) > before) {
			highlights.push({
				kind: "rising",
			icon: "📈",
				title: { en: "Heated up as the league went on", ko: "갈수록 뜨거워졌어요" },
				sub: {
					en: `Best week saved for last: ${STAT_UNIT.attacking_points(pointsOf(last)).en} in week ${last.week}`,
					ko: `마지막으로 뛴 ${last.week}주차가 최고의 주 (공격포인트 ${pointsOf(last)}개)`,
				},
				score: 48,
			});
		}
	}

	// 8. Never missed a week (since joining).
	const joinedWeek = weeks[0]?.week ?? 1;
	if (attended.length >= 2 && attended.length === weeks.length) {
		highlights.push({
			kind: "ironman",
			icon: "🦾",
			title:
				joinedWeek === 1
					? { en: `Every week, all ${weeks.length}`, ko: `${weeks.length}주 개근` }
					: { en: "Never missed a week since joining", ko: "합류한 뒤 한 주도 빠지지 않았어요" },
			sub: { en: `${gamesPlayed} games played`, ko: `${gamesPlayed}경기 출전` },
			score: 45,
		});
	}

	// 9. Hit the ground running after joining mid-league.
	const firstWeek = attended[0];
	if (joinedWeek > 1 && firstWeek && firstWeek.week === joinedWeek && pointsOf(firstWeek) >= 1) {
		highlights.push({
			kind: "joined",
			icon: "🆕",
			title: { en: "Straight into it", ko: "합류하자마자 활약" },
			sub: {
				en: `${STAT_UNIT.attacking_points(pointsOf(firstWeek)).en} in your first week (week ${joinedWeek})`,
				ko: `합류한 ${joinedWeek}주차부터 공격포인트 ${pointsOf(firstWeek)}개`,
			},
			score: 44,
		});
	}

	// 10. Played for two teams.
	const allTeams = [...section.team_history.map((segment) => segment.team_id), section.current_team_id];
	if (allTeams.length > 1) {
		const names = allTeams.map((teamId) => getTeamName(teamId, league));
		highlights.push({
			kind: "teams",
			icon: "🧳",
			title: { en: "A story with two teams", ko: "두 팀의 기억" },
			sub: { en: names.join(" → "), ko: names.join(" → ") },
			score: 40,
		});
	}

	// 11. First goal.
	const firstGoalWeek = weeks.find((week) => week.goals > 0);
	if (firstGoalWeek) {
		highlights.push({
			kind: "first-goal",
			icon: "🎉",
			title: { en: `First goal in week ${firstGoalWeek.week}`, ko: `${firstGoalWeek.week}주차에 리그 첫 골` },
			sub: { en: `${totals.goals} in total`, ko: `리그 통틀어 ${totals.goals}골` },
			score: 30,
		});
	}

	// 13. League winner.
	if (section.badges.includes("champion")) {
		highlights.push({
			kind: "champion",
			icon: "🏆",
			title: { en: `${league.id} champion`, ko: `${league.id} 우승` },
			sub: { en: `with ${getTeamName(section.current_team_id, league)}`, ko: `${withKo(getTeamName(section.current_team_id, league))} 함께` },
			score: 76,
		});
	}

	// 14. First assist.
	const firstAssistWeek = weeks.find((week) => week.assists > 0);
	if (firstAssistWeek) {
		highlights.push({
			kind: "first-assist",
			icon: "🎯",
			title: { en: `First assist in week ${firstAssistWeek.week}`, ko: `${firstAssistWeek.week}주차에 리그 첫 어시스트` },
			sub: { en: `${totals.assists} in total`, ko: `리그 통틀어 ${totals.assists}어시스트` },
			score: 29,
		});
	}

	// 15. The team's record in the weeks played — a plain fact, shown only when it's a winning one.
	const record = myTeamGames.reduce(
		(sum, game) => ({
			w: sum.w + (game.scored > game.conceded ? 1 : 0),
			d: sum.d + (game.scored === game.conceded ? 1 : 0),
			l: sum.l + (game.scored < game.conceded ? 1 : 0),
		}),
		{ w: 0, d: 0, l: 0 },
	);
	if (record.w > record.l) {
		highlights.push({
			kind: "record",
			icon: "📋",
			title: { en: `${record.w}W ${record.d}D ${record.l}L`, ko: `${record.w}승 ${record.d}무 ${record.l}패` },
			sub: { en: "your team's record in the weeks you played", ko: "함께 뛴 주의 팀 전적" },
			score: 20,
		});
	}

	// 16. Runner-up (only three teams, but second is still a podium finish worth naming).
	const finalRank = leagueTableData.find((row) => row.league === league.id && row.team_id === section.current_team_id)?.rank;
	if (finalRank === 2) {
		highlights.push({
			kind: "runner-up",
			icon: "🥈",
			title: { en: `${league.id} runner-up`, ko: `${league.id} 준우승` },
			sub: { en: `with ${getTeamName(section.current_team_id, league)}`, ko: `${withKo(getTeamName(section.current_team_id, league))} 함께` },
			score: 35,
		});
	}

	// 17. The team's best week while this player was there (a week it won at least half its games).
	const bestTeamWeek = attended
		.map((week) => {
			const games = teamWeek(week.week, week.team_id);
			const wins = games.filter((game) => game.scored > game.conceded).length;
			const draws = games.filter((game) => game.scored === game.conceded).length;
			return { week: week.week, games: games.length, wins, draws, losses: games.length - wins - draws };
		})
		.sort((a, b) => b.wins - a.wins || b.draws - a.draws)[0];
	if (bestTeamWeek && bestTeamWeek.games > 0 && bestTeamWeek.wins * 2 >= bestTeamWeek.games) {
		const { week, wins, draws, losses } = bestTeamWeek;
		highlights.push({
			kind: "team-week",
			icon: "🔥",
			title: { en: `Week ${week}: ${wins}W ${draws}D ${losses}L`, ko: `${week}주차 ${wins}승 ${draws}무 ${losses}패` },
			sub: { en: "your team's best week with you on it", ko: "함께 뛴 주 중 팀 최고의 주" },
			score: 25,
		});
	}

	// 18. Goalkeepers: games in goal.
	if (position === "GK" && gamesPlayed > 0) {
		highlights.push({
			kind: "keeper",
			icon: "🧤",
			title: { en: `Guarded the goal for ${gamesPlayed} games`, ko: `${gamesPlayed}경기 골문을 지켰어요` },
			sub: { en: "as a goalkeeper", ko: "골키퍼로 출전" },
			score: 55,
		});
	}

	// 12. Always there: games played (never compared with weeks missed).
	highlights.push({
		kind: "games",
			icon: "⚽",
		title: { en: `${gamesPlayed} games played`, ko: `${gamesPlayed}경기 출전` },
		sub: { en: `Part of ${league.id}`, ko: "이번 리그를 함께 뛰었어요" },
		score: 10,
	});

	highlights.sort((a, b) => b.score - a.score);
	// Keep the three varied: at most two league-rank lines, and no games-played
	// card next to "never missed a week" (it says the same thing).
	const top: Highlight[] = [];
	for (const highlight of highlights) {
		if (top.length === 3) break;
		if (highlight.kind === "rank" && top.filter((other) => other.kind === "rank").length === 2) continue;
		if (highlight.kind === "games" && highlights.some((other) => other.kind === "ironman")) continue;
		top.push(highlight);
	}

	const tableRow = leagueTableData.find((row) => row.league === league.id && row.team_id === section.current_team_id);

	return {
		league: {
			id: league.id,
			weeks: new Set(matches.map((match) => match.week)).size,
			matches: matches.length,
			goals: matches.reduce((sum, match) => sum + (match.home_score as number) + (match.away_score as number), 0),
		},
		games: gamesPlayed,
		goals: totals.goals,
		assists: totals.assists,
		attackingPoints: totals.attacking_points,
		highlights: top,
		team: {
			teamId: section.current_team_id,
			teamName: getTeamName(section.current_team_id, league),
			rank: tableRow?.rank ?? 0,
			champion: section.badges.includes("champion"),
		},
		previousTeams: section.team_history.map((segment) => getTeamName(segment.team_id, league)),
		ownGoalAward: section.badges.includes("own_goal_award"),
	};
}
