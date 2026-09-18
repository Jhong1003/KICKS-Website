// matches: raw match results (src/data/matches.json)
// limit: optional max number of matches to return (omit for the full list)
// Returns completed matches only, most recent first.
export function getRecentMatches(matches, limit) {
	const completed = matches
		.filter((match) => match.status === "completed")
		.sort((a, b) => b.date.localeCompare(a.date));

	return typeof limit === "number" ? completed.slice(0, limit) : completed;
}
