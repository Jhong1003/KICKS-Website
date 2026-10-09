// "Team style" hexagon on the team page (/league/<league>/team/<team_id>).
// Six corners, all within one league (teams are re-drawn every league, so
// nothing here crosses leagues). Pure functions over already-generated data,
// tested by tests/team-profile.test.mjs.
//
// Every corner is on a FIXED scale (0..1), never rescaled against the other
// teams: with only three teams, a relative scale would always draw one team
// full and one empty even when they're nearly equal. The raw number is shown
// next to the chart, so the shape is only a picture of it.

export interface ProfileMatch {
	league: string;
	home_team_id: string | null;
	away_team_id: string | null;
	home_score: number | null;
	away_score: number | null;
}

export interface ProfileWeek {
	team_id: string;
	games: number;
	goals: number;
	assists: number;
}

export interface ProfilePlayer {
	weekly: ProfileWeek[];
}

export type AxisKey = "attack" | "linkup" | "oneteam" | "attendance" | "defense" | "late";

export interface AxisValue {
	key: AxisKey;
	/** 0..1 on the axis's fixed scale, or null when there's no data for it. */
	value: number | null;
	/** The raw number behind it, for the list next to the chart. */
	raw: { en: string; ko: string };
}

export interface AxisInfo {
	key: AxisKey;
	icon: string;
	en: string;
	ko: string;
	/** What it measures, in one line. */
	noteEn: string;
	noteKo: string;
}

/** Clockwise from the top. */
export const AXES: AxisInfo[] = [
	{ key: "attack", icon: "⚔️", en: "Attack", ko: "공격", noteEn: "Goals per match (full at 2.5)", noteKo: "경기당 득점 (2.5골이면 만점)" },
	{ key: "linkup", icon: "🔗", en: "Link-up", ko: "연계", noteEn: "Share of goals that had an assist", noteKo: "어시스트가 붙은 골의 비율" },
	{ key: "oneteam", icon: "🤝", en: "One team", ko: "원팀", noteEn: "Share of the squad who scored", noteKo: "골을 넣어본 선수의 비율" },
	{ key: "attendance", icon: "📋", en: "Attendance", ko: "출석", noteEn: "Participation rate (league table)", noteKo: "팀 참여율 (순위표와 같은 값)" },
	{ key: "defense", icon: "🛡️", en: "Defense", ko: "수비", noteEn: "Fewer goals conceded per match (0 = full)", noteKo: "경기당 실점이 적을수록 (0실점이면 만점)" },
	{ key: "late", icon: "⏱️", en: "Late goals", ko: "뒷심", noteEn: "Share of goals in minutes 9–12", noteKo: "9~12분에 넣은 골의 비율" },
];

/** Goals per match that fills the attack corner / empties the defense corner. */
export const GOALS_PER_MATCH_FULL = 2.5;
/** Two weeks of matches (6 a week) before a team's shape means anything. */
export const MIN_MATCHES = 12;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const pct = (x: number) => `${Math.round(x * 100)}%`;

export interface TeamProfile {
	matches: number;
	axes: AxisValue[];
}

/**
 * One team's six corners in one league, or null before MIN_MATCHES scored
 * matches. `players` are everyone's weekly rows in this league (only weeks
 * on this team count); `participationRate` is the league table's value.
 * Late goals need goal minutes, which aren't wired in yet: always null.
 */
export function teamProfile(
	leagueId: string,
	teamId: string,
	matches: ProfileMatch[],
	players: ProfilePlayer[],
	participationRate: number | null,
): TeamProfile | null {
	let played = 0;
	let scored = 0;
	let conceded = 0;
	for (const m of matches) {
		if (m.league !== leagueId || m.home_score === null || m.away_score === null) continue;
		if (m.home_team_id === teamId) {
			played += 1;
			scored += m.home_score;
			conceded += m.away_score;
		} else if (m.away_team_id === teamId) {
			played += 1;
			scored += m.away_score;
			conceded += m.home_score;
		}
	}
	if (played < MIN_MATCHES) return null;

	let squad = 0;
	let scorers = 0;
	let playerGoals = 0;
	let assists = 0;
	for (const player of players) {
		const here = player.weekly.filter((week) => week.team_id === teamId);
		if (!here.some((week) => week.games > 0)) continue;
		squad += 1;
		const goals = here.reduce((sum, week) => sum + week.goals, 0);
		if (goals > 0) scorers += 1;
		playerGoals += goals;
		assists += here.reduce((sum, week) => sum + week.assists, 0);
	}

	const perMatch = (n: number) => (n / played).toFixed(2);
	const linkup = playerGoals > 0 ? clamp01(assists / playerGoals) : null;

	const axes: AxisValue[] = [
		{
			key: "attack",
			value: clamp01(scored / played / GOALS_PER_MATCH_FULL),
			raw: { en: `${perMatch(scored)} per match`, ko: `경기당 ${perMatch(scored)}골` },
		},
		{
			key: "linkup",
			value: linkup,
			raw:
				linkup === null
					? { en: "No goals yet", ko: "아직 골 없음" }
					: { en: `${pct(linkup)} of goals assisted`, ko: `골의 ${pct(linkup)}에 어시스트` },
		},
		{
			key: "oneteam",
			value: squad > 0 ? scorers / squad : null,
			raw: { en: `${scorers} of ${squad} players scored`, ko: `${squad}명 중 ${scorers}명 득점` },
		},
		{
			key: "attendance",
			value: participationRate === null ? null : clamp01(participationRate),
			raw:
				participationRate === null
					? { en: "—", ko: "—" }
					: { en: `${(participationRate * 100).toFixed(1)}%`, ko: `${(participationRate * 100).toFixed(1)}%` },
		},
		{
			key: "defense",
			value: clamp01(1 - conceded / played / GOALS_PER_MATCH_FULL),
			raw: { en: `${perMatch(conceded)} conceded per match`, ko: `경기당 ${perMatch(conceded)}실점` },
		},
		{
			key: "late",
			value: null,
			raw: { en: "Shown once goal times are recorded", ko: "골 시간이 기록되면 표시돼요" },
		},
	];
	return { matches: played, axes };
}

/** Per-corner mean over the profiles that have a value there (null if none do). */
export function averageProfile(profiles: TeamProfile[]): (number | null)[] {
	return AXES.map((_, index) => {
		const values = profiles.map((profile) => profile.axes[index].value).filter((value): value is number => value !== null);
		return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
	});
}
