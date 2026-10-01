// Geometry for the points-race chart (src/components/PointsRaceChart.astro):
// cumulative points per team after each week, from standings_history.json.
// Pure function of the data, so it can be checked without a browser.

export interface HistoryRow {
	league: string;
	week: number;
	team_id: string;
	rank: number;
	points: number;
	goal_difference: number;
}

export interface RaceTeam {
	id: string;
	name: string;
	color: string;
}

export type Shape = "circle" | "square" | "diamond";
const SHAPES: Shape[] = ["circle", "square", "diamond"];

/** SVG user units; on-screen text size is set in CSS per screen width. */
export const RACE_SIZE = { width: 360, height: 220, top: 22, right: 86, bottom: 26, left: 28 };
/** Shorter version for the popup (PointsRaceDialog). */
export const COMPACT_RACE_SIZE = { width: 360, height: 170, top: 18, right: 86, bottom: 22, left: 26 };
export type RaceSize = typeof RACE_SIZE;

/** id of a league's points-chart popup, shared by the dialog and the links that open it. */
export const pointsRaceDialogId = (league: string) => `points-race-dialog-${league}`;
const LABEL_GAP = 13;

export function buildPointsRace(rows: HistoryRow[], teams: RaceTeam[], totalWeeks: number, size: RaceSize = RACE_SIZE) {
	const { width, height, top, right, bottom, left } = size;
	const plotW = width - left - right;
	const plotH = height - top - bottom;
	const weeks = [...new Set(rows.map((row) => row.week))].sort((a, b) => a - b);

	const maxPoints = Math.max(1, ...rows.map((row) => row.points));
	const step = maxPoints > 20 ? 10 : 5;
	const yMax = Math.ceil(maxPoints / step) * step;
	const x = (week: number) => left + (week / totalWeeks) * plotW;
	const y = (points: number) => top + plotH - (points / yMax) * plotH;

	// Shape follows the team (its order in the league), never its rank.
	const shaped = teams.map((team, index) => ({ ...team, shape: SHAPES[index % SHAPES.length] }));
	// Legend/series order = latest table order, so it reads like the standings.
	const latest = rows.filter((row) => row.week === weeks.at(-1)).sort((a, b) => a.rank - b.rank);
	const ordered = [
		...latest.flatMap((row) => shaped.filter((team) => team.id === row.team_id)),
		...shaped.filter((team) => !latest.some((row) => row.team_id === team.id)),
	];

	const series = ordered.map((team) => {
		const points = [
			{ week: 0, points: 0 },
			...weeks.map((week) => ({
				week,
				points: rows.find((row) => row.week === week && row.team_id === team.id)?.points ?? 0,
			})),
		];
		const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.week).toFixed(1)},${y(p.points).toFixed(1)}`).join(" ");
		return { ...team, points: points.map((p) => ({ ...p, cx: x(p.week), cy: y(p.points) })), path };
	});

	// Direct labels at each line's end, nudged apart so tied teams don't overlap.
	const labels = series
		.map((team) => ({ id: team.id, name: team.name, x: x(team.points.at(-1)!.week) + 9, y: y(team.points.at(-1)!.points) }))
		.sort((a, b) => a.y - b.y);
	for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + LABEL_GAP);
	const overflow = labels.length ? labels.at(-1)!.y - (top + plotH) : 0;
	if (overflow > 0) for (const label of labels) label.y -= overflow;

	const half = plotW / totalWeeks / 2;
	return {
		weeks,
		series,
		labels,
		yTicks: Array.from({ length: yMax / step + 1 }, (_, i) => ({ value: i * step, y: y(i * step) })),
		weekTicks: Array.from({ length: totalWeeks }, (_, i) => ({ week: i + 1, x: x(i + 1) })),
		hits: weeks.map((week) => ({ week, x: x(week) - half, width: half * 2 })),
		plot: { left, top, width: plotW, height: plotH, bottom: top + plotH },
		band: (week: number) => ({ x: x(week - 1), width: x(week) - x(week - 1) }),
		tooltip: Object.fromEntries(
			weeks.map((week) => [
				week,
				rows
					.filter((row) => row.week === week)
					.sort((a, b) => a.rank - b.rank)
					.map((row) => ({ team: row.team_id, rank: row.rank, points: row.points, gd: row.goal_difference })),
			]),
		),
	};
}

/** Picks the right Korean particle (은/는, 이/가) for a name by its last syllable. */
function particle(name: string, withBatchim: string, without: string): string {
	const code = name.charCodeAt(name.length - 1) - 0xac00;
	if (code < 0 || code > 11171) return `${name}${without}`;
	return `${name}${code % 28 ? withBatchim : without}`;
}

export interface RaceStory {
	headline: { en: string; ko: string };
	/** Points between 1st and 2nd after each week (0 when level). */
	gaps: number[];
}

/**
 * One sentence about the race so far, written from standings_history rows:
 * who leads and since when. `names` maps team_id to display name.
 */
export function raceStory(rows: HistoryRow[], names: Record<string, string>, finished: boolean): RaceStory | null {
	const weeks = [...new Set(rows.map((row) => row.week))].sort((a, b) => a - b);
	if (weeks.length === 0) return null;
	const leadersOf = (week: number) => rows.filter((row) => row.week === week && row.rank === 1).map((row) => row.team_id);
	const gaps = weeks.map((week) => {
		const points = rows.filter((row) => row.week === week).map((row) => row.points).sort((a, b) => b - a);
		return (points[0] ?? 0) - (points[1] ?? 0);
	});

	const last = weeks.at(-1)!;
	const leaders = leadersOf(last);
	if (leaders.length > 1) {
		const list = leaders.map((id) => names[id]);
		return {
			headline: {
				en: `${list.join(" and ")} are level at the top.`,
				ko: `${particle(list.slice(0, -1).join(", "), "과", "와")} ${particle(list.at(-1)!, "이", "가")} 1위를 나눠 갖고 있어요.`,
			},
			gaps,
		};
	}

	const leader = leaders[0];
	const name = names[leader];
	// First week of the leader's current unbroken run at the top (sole or shared).
	let since = last;
	for (let i = weeks.length - 1; i >= 0 && leadersOf(weeks[i]).includes(leader); i--) since = weeks[i];

	let headline: { en: string; ko: string };
	if (weeks.length === 1) {
		headline = { en: `${name} top the table after Week ${last}.`, ko: `${particle(name, "이", "가")} ${last}주차 1위로 출발했어요.` };
	} else if (since === weeks[0]) {
		headline = finished
			? { en: `${name} led from Week ${since} and never let go.`, ko: `${particle(name, "은", "는")} ${since}주차부터 한 번도 1위를 내주지 않았어요.` }
			: { en: `${name} have led since Week ${since}.`, ko: `${particle(name, "이", "가")} ${since}주차부터 계속 1위를 지키고 있어요.` };
	} else {
		headline = finished
			? { en: `${name} took the lead in Week ${since} and held on.`, ko: `${particle(name, "이", "가")} ${since}주차에 1위로 올라서 끝까지 지켰어요.` }
			: { en: `${name} took the lead in Week ${since}.`, ko: `${particle(name, "이", "가")} ${since}주차에 1위로 올라섰어요.` };
	}
	return { headline, gaps };
}
