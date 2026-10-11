// Goals on the clock (src/lib/match-timeline.ts): the per-match timeline and
// the league goal clock, plus the real FA26-L2 numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GOAL_CLOCK_MIN_GOALS, goalClock, matchTimelines } from "../src/lib/match-timeline.ts";

const read = (name) => JSON.parse(readFileSync(new URL(`../src/data/${name}`, import.meta.url), "utf8"));
const name = (id) => `name:${id}`;

const goal = (overrides) => ({
	league: "L",
	match_id: "M1",
	minute: 6,
	scorer_id: "P1",
	assist_id: null,
	own_goal: false,
	team_id: "T1",
	roles: [],
	...overrides,
});

test("timeline: one entry per goal, minute order, position across the match", () => {
	const timelines = matchTimelines([goal({ minute: 9 }), goal({ minute: 3 })], "L", 12, name);
	const entries = timelines.get("M1");
	assert.deepEqual(entries.map((entry) => entry.minute), [3, 9]);
	assert.equal(entries[0].at, 0.25);
	assert.equal(entries[1].at, 0.75);
	assert.equal(entries[0].scorer, "name:P1");
});

test("timeline: other leagues and untimed goals are left out entirely", () => {
	const timelines = matchTimelines(
		[goal({ league: "OTHER" }), goal({ minute: null, match_id: "M2" })],
		"L",
		12,
		name,
	);
	assert.equal(timelines.size, 0);
	// A match with no timed goals is absent rather than present-and-empty, so
	// the component can treat "not in the map" as "no timeline to draw".
	assert.equal(timelines.get("M2"), undefined);
});

test("timeline: one role mark per goal, winner first, opener never marked", () => {
	const timelines = matchTimelines(
		[
			goal({ minute: 1, roles: ["opener"] }),
			goal({ minute: 2, roles: ["equaliser"] }),
			goal({ minute: 3, roles: ["comeback", "winner"] }),
		],
		"L",
		12,
		name,
	);
	assert.deepEqual(timelines.get("M1").map((entry) => entry.role), [null, "equaliser", "winner"]);
});

test("timeline: an assist is carried through, an own goal has none", () => {
	const timelines = matchTimelines(
		[goal({ minute: 2, assist_id: "P9" }), goal({ minute: 4, own_goal: true })],
		"L",
		12,
		name,
	);
	const [assisted, own] = timelines.get("M1");
	assert.equal(assisted.assist, "name:P9");
	assert.equal(own.ownGoal, true);
	assert.equal(own.assist, null);
});

test("goal clock: a bucket per minute, shared busiest minutes, own goals counted", () => {
	// Own goals count here: this is about when goals happen, not about credit.
	const goals = [
		...Array.from({ length: 4 }, () => goal({ minute: 3 })),
		...Array.from({ length: 4 }, () => goal({ minute: 7, own_goal: true })),
		...Array.from({ length: 2 }, () => goal({ minute: 12 })),
	];
	const clock = goalClock(goals, "L", 12);
	assert.equal(clock.total, 10);
	assert.equal(clock.minutes.length, 12);
	assert.equal(clock.peak, 4);
	assert.deepEqual(clock.busiest, [3, 7]);
	assert.equal(clock.minutes[0].goals, 0);
});

test("goal clock: nothing to draw below the minimum, or out of range", () => {
	const few = Array.from({ length: GOAL_CLOCK_MIN_GOALS - 1 }, () => goal({}));
	assert.equal(goalClock(few, "L", 12), null);
	assert.notEqual(goalClock([...few, goal({})], "L", 12), null);
	// A minute outside the match is dropped, not clamped into a bucket.
	const withStray = [...few, goal({}), goal({ minute: 99 }), goal({ minute: 0 })];
	assert.equal(goalClock(withStray, "L", 12).total, GOAL_CLOCK_MIN_GOALS);
});

test("real FA26-L2: every goal lands on a match and inside the clock", () => {
	const goals = read("goal_events.json");
	const matches = new Map(read("matches.json").map((match) => [match.match_id, match]));
	const timelines = matchTimelines(goals, "FA26-L2", 12, (id) => id);
	for (const [matchId, entries] of timelines) {
		assert.ok(matches.has(matchId), `${matchId} is not a real match`);
		for (const entry of entries) {
			assert.ok(entry.minute >= 1 && entry.minute <= 12, `${matchId} minute ${entry.minute}`);
			assert.ok(entry.at >= 0 && entry.at <= 1);
		}
	}
	const clock = goalClock(goals, "FA26-L2", 12);
	assert.equal(
		clock.total,
		goals.filter((g) => g.league === "FA26-L2" && g.minute !== null).length,
	);
	// Every goal is in exactly one bucket.
	assert.equal(clock.minutes.reduce((sum, bucket) => sum + bucket.goals, 0), clock.total);
});
