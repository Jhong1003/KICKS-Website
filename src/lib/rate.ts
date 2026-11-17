// Shared by /rate (raters) and /rate/admin (staff). See AGENTS.md, "Player ratings".

/** [name, newbie 0|1] */
export type RatePlayer = [string, number];
/** [a, b, result]: 0 = a better, 1 = b better, 2 = about the same. */
export type Comparison = [number, number, number];

export const SCALE = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

/** Base64url JSON — the same encoding the team-balance tool reads ("KICKS-RES1:" codes). */
export function encodeCode(obj: unknown): string {
	const bytes = new TextEncoder().encode(JSON.stringify(obj));
	let s = "";
	bytes.forEach((b) => (s += String.fromCharCode(b)));
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCode(str: string): unknown {
	const t = str.replace(/-/g, "+").replace(/_/g, "/");
	const bin = atob(t + "===".slice((t.length + 3) % 4));
	return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

/** One "KICKS-RES1:" line per rater, for the team-balance tool's "결과 추가" box. */
export function resultCode(who: string, players: RatePlayer[], s: Record<string, number>, c: Comparison[]): string {
	return "KICKS-RES1:" + encodeCode({ v: 1, who, p: players, s, c });
}

/**
 * Players for a new session, from either the team-balance tool's "KICKS-RATE1:" code
 * or one name per line ("이름", "이름, 신입", "이름 *" mark a newcomer).
 */
export function parseRoster(text: string): RatePlayer[] {
	const code = text.match(/KICKS-RATE1:\s*([A-Za-z0-9_-]+)/);
	if (code) {
		try {
			const d = decodeCode(code[1]) as { p?: unknown };
			if (Array.isArray(d.p)) return d.p.map((p) => [String(p[0]).trim(), p[1] ? 1 : 0] as RatePlayer).filter((p) => p[0]);
		} catch { /* fall through to lines */ }
	}
	const out: RatePlayer[] = [];
	const seen = new Set<string>();
	for (const raw of text.split(/\n+/)) {
		let line = raw.trim();
		if (!line) continue;
		let newbie = 0;
		const mark = /(\s*[,\t]\s*(신입|new|newbie|1)|\s*\*)\s*$/i;
		if (mark.test(line)) { newbie = 1; line = line.replace(mark, "").trim(); }
		line = line.split("\t")[0].trim();
		if (line && !seen.has(line)) { seen.add(line); out.push([line, newbie]); }
	}
	return out;
}

const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** Next pair: the least-compared player against a partner they haven't met yet (skipped pairs count as met). */
export function nextPair(n: number, comps: Comparison[], skipped: Set<string>, rand = Math.random): [number, number] | null {
	if (n < 2) return null;
	const cnt = new Array(n).fill(0);
	const seen = new Set(skipped);
	comps.forEach(([a, b]) => { cnt[a]++; cnt[b]++; seen.add(key(a, b)); });
	const order = [...Array(n).keys()].sort((x, y) => cnt[x] - cnt[y] || rand() - 0.5);
	for (const a of order) {
		const opts = [...Array(n).keys()].filter((b) => b !== a && !seen.has(key(a, b)));
		if (!opts.length) continue;
		opts.sort((x, y) => cnt[x] - cnt[y] || rand() - 0.5);
		const b = opts[Math.floor(rand() * Math.min(3, opts.length))];
		return rand() < 0.5 ? [a, b] : [b, a];
	}
	return null;
}

export const pairKey = key;
