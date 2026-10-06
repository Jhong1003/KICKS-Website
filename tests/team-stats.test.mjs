// Team page numbers (src/lib/team-stats.ts) on small hand-made cases and on
// the real FA26-L1 data, checked against league_table.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { teamResults, recentForm, headToHead, teamRecords, teamLeaders } from "../src/lib/team-stats.ts";

const read = (name) => JSON.parse(readFileSync(new URL(`../src/data/${name}`, import.meta.url), "utf8"));
const m = (id, week, round, home, away, hs, as) => ({ league: "X", match_id: id, week, round, home_team_id: home, away_team_id: away, home_score: hs, away_score: as });

test("results are from this team's side, oldest first, unscored skipped", () => {
	const matches = [m("c", 2, 1, "T2", "T1", 0, 3), m("a", 1, 1, "T1", "T2", 2, 2), m("b", 1, 2, "T3", "T1", 1, 0), m("d", 3, 1, "T1", "T3", null, null)];
	const r = teamResults(matches, "X", "T1");
	assert.deepEqual(r.map((x) => [x.match_id, x.ours, x.theirs, x.result, x.opponentId]), [
		["a", 2, 2, "D", "T2"],
		["b", 0, 1, "L", "T3"],
		["c", 3, 0, "W", "T2"],
	]);
	assert.deepEqual(recentForm(r, 2).map((x) => x.match_id), ["b", "c"]);
});

test("records: clean sheets, biggest win ties, streaks", () => {
	const matches = [m("1", 1, 1, "T1", "T2", 2, 0), m("2", 1, 2, "T1", "T3", 3, 1), m("3", 1, 3, "T1", "T2", 1, 1), m("4", 2, 1, "T1", "T3", 0, 1), m("5", 2, 2, "T1", "T2", 1, 0)];
	const rec = teamRecords(teamResults(matches, "X", "T1"));
	assert.equal(rec.cleanSheets, 2);
	assert.deepEqual(rec.biggestWins.map((x) => x.match_id), ["1", "2"]);
	assert.equal(rec.longestWinStreak, 2);
	assert.equal(rec.longestUnbeaten, 3);
	assert.deepEqual(teamRecords([]), { cleanSheets: 0, biggestWins: [], longestWinStreak: 0, longestUnbeaten: 0 });
});

test("leaders count only weeks on this team; ties share; nobody at zero", () => {
	const c = [
		{ playerId: "A", weekly: [{ week: 1, team_id: "T1", goals: 2, assists: 0 }, { week: 2, team_id: "T2", goals: 5, assists: 0 }] },
		{ playerId: "B", weekly: [{ week: 1, team_id: "T1", goals: 2, assists: 0 }] },
	];
	const l = teamLeaders(c, "T1");
	assert.deepEqual(l.goals, { value: 2, playerIds: ["A", "B"] });
	assert.deepEqual(l.assists, { value: 0, playerIds: [] });
});

test("FA26-L1: head-to-head and results add up to league_table.json", () => {
	const matches = read("matches.json");
	const table = read("league_table.json").filter((row) => row.league === "FA26-L1");
	const teams = table.map((row) => row.team_id);
	for (const row of table) {
		const r = teamResults(matches, "FA26-L1", row.team_id);
		const h2h = headToHead(r, teams.filter((t) => t !== row.team_id));
		const sum = (k) => h2h.reduce((s, x) => s + x[k], 0);
		assert.equal(r.length, row.played);
		assert.equal(sum("W"), row.wins);
		assert.equal(sum("D"), row.draws);
		assert.equal(sum("L"), row.losses);
		assert.equal(sum("goalsFor"), row.goals_for);
		assert.equal(sum("goalsAgainst"), row.goals_against);
	}
});
