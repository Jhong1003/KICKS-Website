// Published match forecasts (forecasts/forecasts.csv, rules in
// docs/forecast-protocol-v1.md). The CSV is the record: it's append-only and
// committed before each week's deadline. The site only reads it.

import forecastsCsv from "../../forecasts/forecasts.csv?raw";
import titleForecastsCsv from "../../forecasts/title_forecasts.csv?raw";

export type ForecastModel = "baseline" | "poisson-v1";

export interface Forecast {
	league: string;
	week: number;
	teamA: string;
	teamB: string;
	model: ForecastModel;
	pA: number;
	pDraw: number;
	pB: number;
	dataThroughWeek: number;
	generatedAt: string;
	status: string;
}

export const MODEL_LABELS: Record<ForecastModel, { en: string; ko: string }> = {
	"poisson-v1": { en: "Poisson model", ko: "포아송 모델" },
	baseline: { en: "Baseline", ko: "기본 예측" },
};

// Poisson first: from week 2 it's the forecast that uses this league's results.
const MODEL_ORDER: ForecastModel[] = ["poisson-v1", "baseline"];

function parse(csv: string): Forecast[] {
	const [header, ...lines] = csv.trim().split(/\r?\n/);
	const columns = header.split(",");
	return lines
		.filter((line) => line.trim() !== "")
		.map((line) => {
			const cells = line.split(",");
			const row = Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? ""]));
			return {
				league: row.league,
				week: Number(row.week),
				teamA: row.team_a,
				teamB: row.team_b,
				model: row.model as ForecastModel,
				pA: Number(row.p_a),
				pDraw: Number(row.p_draw),
				pB: Number(row.p_b),
				dataThroughWeek: Number(row.data_through_week),
				generatedAt: row.generated_at,
				status: row.status,
			};
		});
}

export const forecasts: Forecast[] = parse(forecastsCsv);

/**
 * The forecasts to show for a league: its most recent forecast week, one row
 * per (pairing, model). Only published rows count; if a later row (e.g. a
 * correction) exists for the same pairing and model, the later one wins.
 */
export function latestForecastWeek(leagueId: string): { week: number; pairings: { teamA: string; teamB: string; rows: Forecast[] }[] } | null {
	const rows = forecasts.filter((row) => row.league === leagueId && row.status === "published");
	if (rows.length === 0) return null;
	const week = Math.max(...rows.map((row) => row.week));
	const byKey = new Map<string, Forecast>();
	for (const row of rows.filter((row) => row.week === week)) byKey.set(`${row.teamA}|${row.teamB}|${row.model}`, row);
	const pairs = [...new Set([...byKey.values()].map((row) => `${row.teamA}|${row.teamB}`))].sort();
	return {
		week,
		pairings: pairs.map((pair) => {
			const [teamA, teamB] = pair.split("|");
			const pairRows = [...byKey.values()]
				.filter((row) => row.teamA === teamA && row.teamB === teamB)
				.sort((a, b) => MODEL_ORDER.indexOf(a.model) - MODEL_ORDER.indexOf(b.model));
			return { teamA, teamB, rows: pairRows };
		}),
	};
}

/** Rounded for display only (the CSV keeps full precision). */
export const percent = (p: number) => `${Math.round(p * 100)}%`;

export interface TitleForecast {
	league: string;
	week: number;
	team: string;
	model: string;
	pTitle: number;
}

function parseTitle(csv: string): TitleForecast[] {
	const [header, ...lines] = csv.trim().split(/\r?\n/);
	const columns = header.split(",");
	return lines
		.filter((line) => line.trim() !== "")
		.map((line) => Object.fromEntries(line.split(",").map((value, index) => [columns[index], value])))
		.filter((row) => row.status === "published")
		.map((row) => ({ league: row.league, week: Number(row.week), team: row.team, model: row.model, pTitle: Number(row.p_title) }));
}

export const titleForecasts: TitleForecast[] = parseTitle(titleForecastsCsv);

/**
 * Published title chances per week for a league: week -> team -> p. Each
 * week uses its own published model (baseline in week 1, Poisson from week
 * 2); a later row for the same week/team/model (a correction) wins.
 */
export function titleHistory(leagueId: string): { week: number; chances: Record<string, number> }[] {
	const byWeek = new Map<number, Record<string, number>>();
	for (const row of titleForecasts.filter((r) => r.league === leagueId)) {
		const chances = byWeek.get(row.week) ?? {};
		chances[row.team] = row.pTitle;
		byWeek.set(row.week, chances);
	}
	return [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([week, chances]) => ({ week, chances }));
}
