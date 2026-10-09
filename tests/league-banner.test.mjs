// Homepage league banner (src/lib/league-banner.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bannerMode, weekSummary, daysUntil, dDayLabel } from "../src/lib/league-banner.ts";

const m = (week, hs, as, league = "L") => ({ league, week, home_score: hs, away_score: as });

test("mode follows the league's scored matches", () => {
	assert.equal(bannerMode("L", []), "kickoff");
	assert.equal(bannerMode("L", [m(1, null, null), m(1, null, null)]), "kickoff");
	assert.equal(bannerMode("L", [m(1, 1, 0), m(2, null, null)]), "week");
	assert.equal(bannerMode("L", [m(1, 1, 0), m(2, 0, 0)]), "finale");
	assert.equal(bannerMode("L", [m(1, 1, 0, "OTHER")]), "kickoff");
});

test("week summary: latest scored week, leaders, that week's top scorers (ties, no inactive)", () => {
	const matches = [m(1, 2, 1), m(2, 1, 1), m(3, null, null)];
	const table = [
		{ league: "L", team_id: "T1", rank: 1, points: 6 },
		{ league: "L", team_id: "T2", rank: 2, points: 4 },
	];
	const p = (id, name, status, weekly) => ({ id, name, status, leagues: [{ league: "L", weekly_stats: weekly }] });
	const profiles = [
		p("a", "나", "active", [{ week: 1, goals: 5 }, { week: 2, goals: 2 }]),
		p("b", "가", "active", [{ week: 2, goals: 2 }]),
		p("c", "다", "inactive", [{ week: 2, goals: 9 }]),
	];
	const s = weekSummary("L", matches, table, profiles);
	assert.equal(s.week, 2);
	assert.deepEqual(s.leaders, [{ teamId: "T1", points: 6 }]);
	assert.deepEqual(s.topScorers, { goals: 2, players: [{ id: "b", name: "가" }, { id: "a", name: "나" }] });
	assert.equal(weekSummary("L", [m(1, null, null)], table, profiles), null);
	assert.equal(weekSummary("L", [m(1, 0, 0)], table, [p("a", "나", "active", [{ week: 1, goals: 0 }])]).topScorers, null);
});

test("D-day labels", () => {
	assert.equal(daysUntil("2026-10-10", "2026-10-09"), 1);
	assert.equal(daysUntil("2026-11-01", "2026-10-31"), 1); // across a month (and DST weekend)
	assert.equal(dDayLabel("2026-10-10", "2026-10-09"), "D-1");
	assert.equal(dDayLabel("2026-10-10", "2026-10-10"), "D-DAY");
	assert.equal(dDayLabel("2026-10-10", "2026-10-11"), null);
});
