// Shared by the browser and Worker: ranked scores are recomputed from shot inputs.
export const VERSION = 1;
export const DIRECTIONS = ['tl', 'tr', 'bl', 'br', 'center'];
export const MAX_SHOTS = 30;
export const SAVE_WINDOW = 100;
export const PERFECT_WINDOW = 50;
export const MAX_DURATION = 100000;

export function shotsFor(seed) {
  let state = seed >>> 0, start = 0;
  return Array.from({ length: MAX_SHOTS }, (_, index) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const flight = Math.max(260, 500 - index * 10);
    const impact = start + 350 + flight;
    const shot = { index, start, impact, end: impact + 650, flight, direction: DIRECTIONS[state % 5] };
    start = shot.end;
    return shot;
  });
}

// The keeper starts in the middle, so a shot down the middle is saved by
// standing still or by tapping at any time; only a well-timed tap is perfect.
// Diving to a corner on a central shot leaves the middle open.
export function judge(shot, input) {
  if (shot.direction === 'center') {
    if (!input) return { kind: 'save', reason: 'stay', points: 100 };
    if (input.direction !== 'center') return { kind: 'goal', reason: 'direction', points: 0 };
    return Math.abs(input.at - shot.impact) <= PERFECT_WINDOW
      ? { kind: 'perfect', reason: 'perfect', points: 200 }
      : { kind: 'save', reason: 'save', points: 100 };
  }
  // Corner shots: diving the right way at any point in the shot's window puts
  // the gloves where the ball goes, so it is a save; timing it to the moment
  // the ball arrives makes it perfect. The wrong way, or no dive, concedes.
  if (!input) return { kind: 'goal', reason: 'late', points: 0 };
  if (input.direction !== shot.direction) return { kind: 'goal', reason: 'direction', points: 0 };
  return Math.abs(input.at - shot.impact) <= PERFECT_WINDOW
    ? { kind: 'perfect', reason: 'perfect', points: 200 }
    : { kind: 'save', reason: 'save', points: 100 };
}

export function replay(seed, inputs, elapsed = MAX_DURATION) {
  let score = 0, lives = 3, saves = 0, perfect = 0, combo = 0, bestCombo = 0, resolved = 0, finishedAt = 0;
  const shots = shotsFor(seed);
  const outcomes = [];
  for (const shot of shots) {
    if (elapsed < shot.impact + SAVE_WINDOW) break;
    const input = inputs.find((entry) => entry.at >= shot.start && entry.at <= shot.impact + SAVE_WINDOW);
    const result = judge(shot, input);
    if (result.kind === 'goal') { lives--; combo = 0; }
    else { saves++; combo++; bestCombo = Math.max(bestCombo, combo); if (result.kind === 'perfect') perfect++; score += result.points + Math.min(100, Math.floor(combo / 3) * 10); }
    resolved++;
    outcomes.push({ ...result, index: shot.index });
    if (lives === 0 || resolved === MAX_SHOTS) { finishedAt = shot.impact + SAVE_WINDOW; break; }
  }
  return { score, lives, saves, perfect, combo, bestCombo, resolved, outcomes, finished: finishedAt > 0, finishedAt };
}

export function validInputs(seed, inputs) {
  if (!Array.isArray(inputs) || inputs.length > MAX_SHOTS) return false;
  const shots = shotsFor(seed), seen = new Set();
  let previous = -1;
  for (const input of inputs) {
    if (!input || !DIRECTIONS.includes(input.direction) || !Number.isFinite(input.at) || input.at < 0 || input.at <= previous) return false;
    const shot = shots.find((s) => input.at >= s.start && input.at <= s.impact + SAVE_WINDOW);
    if (!shot || seen.has(shot.index)) return false;
    seen.add(shot.index); previous = input.at;
  }
  return true;
}
