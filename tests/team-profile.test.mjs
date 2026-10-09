// Team style hexagon (src/lib/team-profile.ts): fixed scales, the minimum
// sample, weeks on other teams ignored, and the real FA26-L1 numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AXES, MIN_MATCHES, teamProfile, averageProfile } from "../src/lib/team-profile.ts";

const read = (name) => JSON.parse(readFileSync(new URL(`../src/data/${name}`, import.meta.url), "utf8"));
const match = (home, away, hs, as) => ({ league: "X", home_team_id: home, away_team_id: away, home_score: hs, away_score: as });
const axis = (profile, key) => profile.axes[AXES.findIndex((a) => a.key === key)];

test("needs MIN_MATCHES scored matches", () => {
	const few = Array.from({ length: MIN_MATCHES - 1 }, () => match("T1", "T2", 1, 0));
	assert.equal(teamProfile("X", "T1", few, [], 0.9), null);
	const unscored = [...few, match("T1", "T2", null, null)];
	assert.equal(teamProfile("X", "T1", unscored, [], 0.9), null);
	assert.notEqual(teamProfile("X", "T1", [...few, match("T2", "T1", 0, 0)], [], 0.9), null);
});

test("fixed scales: attack/defense against 2.5 goals a match, clamped", () => {
	const matches = Array.from({ length: 12 }, () => match("T1", "T2", 5, 0));
	const p = teamProfile("X", "T1", matches, [], 0.5);
	assert.equal(axis(p, "attack").value, 1);
	assert.equal(axis(p, "defense").value, 1);
	assert.equal(axis(p, "attendance").value, 0.5);
	const q = teamProfile("X", "T2", matches, [], null);
	assert.equal(axis(q, "attack").value, 0);
	assert.equal(axis(q, "defense").value, 0);
	assert.equal(axis(q, "attendance").value, null);
	assert.equal(axis(q, "late").value, null);
});

test("link-up and one-team count only weeks on this team", () => {
	const matches = Array.from({ length: 12 }, () => match("T1", "T2", 1, 1));
	const players = [
		{ weekly: [{ team_id: "T1", games: 6, goals: 2, assists: 1 }, { team_id: "T2", games: 6, goals: 9, assists: 9 }] },
		{ weekly: [{ team_id: "T1", games: 6, goals: 0, assists: 1 }] },
		{ weekly: [{ team_id: "T1", games: 0, goals: 0, assists: 0 }] }, // never played for T1
		{ weekly: [{ team_id: "T2", games: 6, goals: 1, assists: 0 }] },
	];
	const p = teamProfile("X", "T1", matches, players, 0.8);
	assert.equal(axis(p, "linkup").value, 1); // 2 assists / 2 goals
	assert.equal(axis(p, "oneteam").value, 0.5); // 1 of 2 who played scored
	assert.deepEqual(axis(p, "oneteam").raw, { en: "1 of 2 players scored", ko: "2명 중 1명 득점" });
});

test("average skips missing corners", () => {
	const matches = Array.from({ length: 12 }, () => match("T1", "T2", 1, 0));
	const a = teamProfile("X", "T1", matches, [], 0.6);
	const b = teamProfile("X", "T2", matches, [], null);
	const avg = averageProfile([a, b]);
	assert.equal(avg[AXES.findIndex((x) => x.key === "attendance")], 0.6);
	assert.equal(avg[AXES.findIndex((x) => x.key === "late")], null);
});

test("real FA26-L1: every team has a shape, goals per match match the league table", () => {
	const matches = read("matches.json");
	const table = read("league_table.json").filter((row) => row.league === "FA26-L1");
	const players = read("player_profiles.json").flatMap((p) =>
		p.leagues.filter((s) => s.league === "FA26-L1").map((s) => ({ weekly: s.weekly_stats })),
	);
	for (const row of table) {
		const p = teamProfile("FA26-L1", row.team_id, matches, players, row.participation_rate);
		assert.ok(p, row.team_id);
		assert.equal(p.matches, row.played);
		assert.ok(Math.abs(axis(p, "attack").value * 2.5 - row.goals_for / row.played) < 1e-9);
		for (const a of p.axes) if (a.value !== null) assert.ok(a.value >= 0 && a.value <= 1, `${row.team_id} ${a.key}`);
	}
});
