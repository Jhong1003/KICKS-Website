// Career timeline (src/lib/career.ts): milestones, firsts, honours, ordering.
// Run: node --test tests/career.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCareer, crossedMilestone, GOAL_MILESTONES } from "../src/lib/career.ts";

const w = (week, goals = 0, assists = 0, games = 6, team_id = "T1") => ({ week, team_id, games, goals, assists });
const ctx = (extra = {}) => ({
	leagueOrder: ["L1", "L2"],
	championLeagues: [],
	goldenBootLeagues: [],
	playmakerLeagues: [],
	finalWeeks: { L1: 4, L2: 4 },
	matchGoals: [],
	...extra,
});
const kinds = (career) => career.events.map((e) => `${e.league}-${e.week}-${e.kind}${e.count ? e.count : ""}`);

test("crossedMilestone keeps only the highest step crossed", () => {
	assert.equal(crossedMilestone(GOAL_MILESTONES, 3, 12), 10);
	assert.equal(crossedMilestone(GOAL_MILESTONES, 10, 12), null);
	assert.equal(crossedMilestone(GOAL_MILESTONES, 98, 160), 150);
});

test("debut, firsts and milestones across two leagues, oldest first", () => {
	const sections = [
		{ league: "L2", current_team_id: "T3", weekly_stats: [w(1, 3, 1, 6, "T3"), w(2, 0, 0, 0, "T3")] },
		{ league: "L1", current_team_id: "T1", weekly_stats: [w(1), w(2, 1), w(3, 2, 1), w(4, 0, 0)] },
	];
	const career = buildCareer(sections, ctx());
	assert.deepEqual(kinds(career), [
		"L1-1-debut",
		"L1-2-first_goal",
		"L1-3-first_assist",
		"L2-1-new_league",
		"L2-1-goals5",
	]);
	assert.deepEqual(career.totals, { leagues: 2, goals: 6, assists: 2, weeksPlayed: 5, titles: 0 });
});

test("a player who joins mid-league debuts on their first week played", () => {
	const career = buildCareer([{ league: "L1", current_team_id: "T1", weekly_stats: [w(3, 0, 0, 0), w(4)] }], ctx());
	assert.deepEqual(kinds(career), ["L1-4-debut"]);
});

test("a mid-league move is a transfer", () => {
	const career = buildCareer([{ league: "L1", current_team_id: "T2", weekly_stats: [w(1), w(2), w(3, 0, 0, 6, "T2")] }], ctx());
	assert.deepEqual(kinds(career), ["L1-1-debut", "L1-3-transfer"]);
	assert.equal(career.events[1].teamId, "T2");
});

test("brace, hat-trick and poker: only the first time each level is reached", () => {
	const sections = [{ league: "L2", current_team_id: "T1", weekly_stats: [w(1, 2), w(2, 5), w(3, 2), w(4, 4)] }];
	const matchGoals = [
		{ league: "L2", week: 1, goals: 2 },
		{ league: "L2", week: 2, goals: 3 },
		{ league: "L2", week: 2, goals: 2 },
		{ league: "L2", week: 3, goals: 2 },
		{ league: "L2", week: 4, goals: 4 },
	];
	const multi = buildCareer(sections, ctx({ matchGoals })).events.filter((e) => ["brace", "hat_trick", "poker"].includes(e.kind));
	assert.deepEqual(multi.map((e) => `${e.week}-${e.kind}`), ["1-brace", "2-hat_trick", "4-poker"]);
});

test("honours sit at the final week, after that week's other moments", () => {
	const sections = [{ league: "L1", current_team_id: "T1", weekly_stats: [w(1), w(2), w(3), w(4, 5)] }];
	const career = buildCareer(sections, ctx({ championLeagues: ["L1"], goldenBootLeagues: ["L1"] }));
	assert.deepEqual(kinds(career).slice(-4), ["L1-4-first_goal", "L1-4-goals5", "L1-4-champion", "L1-4-golden_boot"]);
	assert.equal(career.totals.titles, 1);
});

test("no weeks played → no events", () => {
	const career = buildCareer([{ league: "L1", current_team_id: "T1", weekly_stats: [w(1, 0, 0, 0)] }], ctx());
	assert.deepEqual(career.events, []);
});
