import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGoalCountdown, milestoneScorer } from "../src/lib/goals.ts";

const read = (name) => JSON.parse(readFileSync(new URL(`../src/data/${name}`, import.meta.url), "utf8"));
const match = (match_id, date, home_score, away_score) => ({ match_id, date, status: "completed", home_score, away_score });
const goal = (match_id, minute, scorer_id, own_goal = false) => ({ match_id, minute, scorer_id, own_goal });

test("milestone scorer: the nth goal in minute order of the crossing match", () => {
	const matches = [match("A-W01-M01", "2026-01-01", 2, 1), match("A-W01-M02", "2026-01-01", 1, 2)];
	const goals = [goal("A-W01-M02", 9, "P3"), goal("A-W01-M02", 2, "P1"), goal("A-W01-M02", 5, "P2")];
	assert.equal(milestoneScorer(matches, goals, 4), "P1");
	assert.equal(milestoneScorer(matches, goals, 5), "P2");
	assert.equal(milestoneScorer(matches, goals, 6), "P3");
	// Crossing match without per-goal records, an own goal, or past the total.
	assert.equal(milestoneScorer(matches, goals, 2), null);
	assert.equal(milestoneScorer(matches, [goal("A-W01-M02", 2, "P1", true), ...goals.slice(0, 2)], 4), null);
	assert.equal(milestoneScorer(matches, goals, 7), null);
	// Same minute: can't tell which came first.
	assert.equal(milestoneScorer(matches, [goal("A-W01-M02", 2, "P1"), goal("A-W01-M02", 2, "P2"), goal("A-W01-M02", 9, "P3")], 4), null);
});

test("milestone scorer on the real data matches the countdown", () => {
	const matches = read("matches.json");
	const countdown = buildGoalCountdown(matches);
	if (countdown.lastMilestone === null) return;
	const scorer = milestoneScorer(matches, read("goal_events.json"), countdown.lastMilestone);
	if (scorer !== null) assert.match(scorer, /^P\d+$/);
});
