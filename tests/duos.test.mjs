// Team duos (src/lib/duos.ts): direction ignored, own goals excluded, the two
// minimums, and the real FA26-L2 numbers.
// Run: node --test tests/duos.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DUO_MIN_GOALS, DUO_MIN_TEAM_GOALS, teamDuos } from "../src/lib/duos.ts";

const goal = (scorer, assist, extra = {}) => ({
	league: "X",
	team_id: "T1",
	scorer_id: scorer,
	assist_id: assist,
	own_goal: false,
	...extra,
});

/** DUO_MIN_TEAM_GOALS assisted goals by pairs nobody cares about, to get past the gate. */
const filler = () =>
	Array.from({ length: DUO_MIN_TEAM_GOALS }, (_, i) => goal(`F${i}`, `G${i}`));

test("a pair counts both ways round: one duo, not two", () => {
	const goals = [...filler(), goal("A", "B"), goal("B", "A")];
	const duos = teamDuos(goals, "X", "T1");
	assert.equal(duos.length, 1);
	assert.deepEqual(duos[0], { playerIds: ["A", "B"], goals: 2 });
});

test("nothing until the team has DUO_MIN_TEAM_GOALS assisted goals", () => {
	const short = Array.from({ length: DUO_MIN_TEAM_GOALS - 1 }, () => goal("A", "B"));
	assert.deepEqual(teamDuos(short, "X", "T1"), []);
	assert.equal(teamDuos([...short, goal("A", "B")], "X", "T1")[0].goals, DUO_MIN_TEAM_GOALS);
});

test("a pair on one goal is not a duo", () => {
	const goals = [...filler(), goal("A", "B")];
	assert.equal(DUO_MIN_GOALS, 2);
	assert.deepEqual(teamDuos(goals, "X", "T1"), []);
});

test("own goals make no pair, and neither do unassisted goals", () => {
	const goals = [
		...filler(),
		goal("A", "B", { own_goal: true }),
		goal("A", "B", { own_goal: true }),
		goal("C", null),
		goal("C", null),
		goal("D", "D"),
		goal("D", "D"),
	];
	assert.deepEqual(teamDuos(goals, "X", "T1"), []);
});

test("another team's and another league's goals are not this team's", () => {
	const goals = [
		...filler(),
		goal("A", "B", { team_id: "T2" }),
		goal("A", "B", { team_id: "T2" }),
		goal("A", "B", { league: "Y" }),
		goal("A", "B", { league: "Y" }),
	];
	assert.deepEqual(teamDuos(goals, "X", "T1"), []);
});

test("most goals first, capped at the limit", () => {
	const goals = [
		...filler(),
		goal("A", "B"), goal("A", "B"), goal("A", "B"),
		goal("C", "D"), goal("D", "C"),
		goal("E", "F"), goal("E", "F"),
		goal("G", "H"), goal("G", "H"),
	];
	const duos = teamDuos(goals, "X", "T1", 2);
	assert.deepEqual(duos.map((duo) => duo.goals), [3, 2]);
	assert.deepEqual(duos[0].playerIds, ["A", "B"]);
});

test("FA26-L1 was recorded as weekly totals, so it has no duos", () => {
	const events = JSON.parse(readFileSync(new URL("../src/data/goal_events.json", import.meta.url), "utf8"));
	assert.equal(events.some((row) => row.league === "FA26-L1"), false);
	assert.deepEqual(teamDuos(events, "FA26-L1", "T1"), []);
});

test("FA26-L2 is still inside the minimum sample, so nothing is claimed yet", () => {
	const events = JSON.parse(readFileSync(new URL("../src/data/goal_events.json", import.meta.url), "utf8"));
	// Week 1 gave every team fewer than DUO_MIN_TEAM_GOALS assisted goals.
	for (const teamId of ["T1", "T2", "T3"]) {
		assert.deepEqual(teamDuos(events, "FA26-L2", teamId), []);
	}
});
