// Match forecasts shown in fixture order (src/lib/forecast-order.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { orderLikeFixtures } from "../src/lib/forecast-order.ts";

const fx = (id, round, home, away, week = 1) => ({ league: "L", week, round, match_id: id, home_team_id: home, away_team_id: away });
const pairing = (a, b, pA, pB) => ({ teamA: a, teamB: b, rows: [{ model: "baseline", pA, pDraw: 1 - pA - pB, pB }] });

test("follows the first round's order and home/away, swapping probabilities", () => {
	const pairings = [pairing("T1", "T2", 0.5, 0.2), pairing("T1", "T3", 0.4, 0.3), pairing("T2", "T3", 0.1, 0.6)];
	const fixtures = [
		fx("L-W01-M01", 1, "T2", "T3"),
		fx("L-W01-M02", 1, "T3", "T1"),
		fx("L-W01-M03", 1, "T1", "T2"),
		fx("L-W01-M04", 2, "T2", "T3"),
		fx("L-W02-M01", 1, "T1", "T3", 2), // other week: ignored
	];
	const out = orderLikeFixtures(pairings, fixtures, "L", 1);
	assert.deepEqual(out.map((p) => [p.teamA, p.teamB]), [["T2", "T3"], ["T3", "T1"], ["T1", "T2"]]);
	assert.equal(out[1].rows[0].pA, 0.3); // T3's chance
	assert.equal(out[1].rows[0].pB, 0.4); // T1's chance
	assert.equal(out[0].rows[0].pA, 0.1); // unchanged orientation
	assert.equal(pairings[1].rows[0].pA, 0.4); // input not mutated
});

test("no fixtures: original order kept", () => {
	const pairings = [pairing("T1", "T2", 0.5, 0.2), pairing("T1", "T3", 0.4, 0.3)];
	assert.deepEqual(orderLikeFixtures(pairings, [], "L", 1), pairings);
});
