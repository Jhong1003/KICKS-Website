// Free kick rules, shared by the browser and (later) the Worker: a kick's
// result is worked out from the swipe alone, so a replay gives the same result.
//
// World units are metres. x runs across the goal (right is +), y is height,
// z is the distance from the goal line toward the kicker. The goal is a futsal
// goal: 3 m wide, 2 m high. The camera sits behind the ball.
export const VERSION = 1;
export const KICKS = 10;
export const VIEW = { w: 640, h: 560 };
export const GOAL_W = 3;
export const GOAL_H = 2;
export const BALL_R = 0.11;
export const WALL_GAP = 5; // futsal: the wall stands 5 m from the ball
export const WALL_H = 1.7;
export const WALL_HALF = 0.23; // half a player's width in the wall
export const JUMP_H = 0.45;
export const JUMP_TIME = 0.5;
export const V_REF = 15; // the speed at which the ball goes exactly where the swipe ended
export const V_MIN = 7;
export const V_MAX = 26;
export const POINTS = 100;
const POST = GOAL_W / 2;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
}

// Ten kicks that start close and open and get further, wider, with a bigger
// wall that starts to jump and a quicker keeper.
export function kicksFor(seed) {
  const r = rng(seed);
  return Array.from({ length: KICKS }, (_, index) => {
    const D = 9.5 + index * 0.3 + r() * 1.2;
    const x0 = (r() * 2 - 1) * (0.3 + 0.2 * index);
    const side = x0 > 0.05 ? 1 : x0 < -0.05 ? -1 : r() < 0.5 ? -1 : 1; // the wall covers this post
    const n = index < 2 ? 2 : index < 6 ? 3 : 4;
    // The wall starts just outside the line from the ball to the near post and
    // runs toward the middle.
    const line = x0 + (side * POST - x0) * (WALL_GAP / D);
    const wall = Array.from({ length: n }, (_, i) => line + side * 0.12 - side * (i * WALL_HALF * 2));
    const jump = index >= 3 && r() < 0.3 + 0.07 * (index - 3);
    const jumpDelay = 0.04 + r() * 0.12;
    return {
      index, D, x0, side, wall, jump, jumpDelay,
      keeper: { x: -side * (n >= 3 ? 0.4 : 0.15), react: 0.44 - 0.016 * index, speed: 0.85 + 0.12 * index },
    };
  });
}

// The camera for a kick and the projection to canvas units.
export function camera(kick) {
  return { x: kick.x0 * 0.85, y: 2.6, z: kick.D + 7.5, F: 1400, hor: 55 };
}
export function project(cam, x, y, z) {
  const depth = cam.z - z, k = cam.F / depth;
  return [VIEW.w / 2 + (x - cam.x) * k, cam.hor - (y - cam.y) * k, k];
}

// Swipe → shot. Points are [ms, x, y] in canvas units, in time order.
// - Where the finger lifts, seen on the goal plane, is where the ball goes at V_REF.
// - The speed of the last 90 ms sets the power: harder flies higher and
//   quicker (less time for the keeper), softer drops lower.
// - How much the line bows sets the curl; the ball bends back the way it bows.
export function validSwipe(points) {
  if (!Array.isArray(points) || points.length < 3 || points.length > 60) return false;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) return false;
    if (p[1] < -200 || p[1] > VIEW.w + 200 || p[2] < -200 || p[2] > VIEW.h + 200) return false;
    if (i && p[0] < points[i - 1][0]) return false;
  }
  const dur = points.at(-1)[0] - points[0][0];
  return dur > 0 && dur <= 1500 && points[0][2] - points.at(-1)[2] >= 50;
}

export function shotFromSwipe(kick, points) {
  const cam = camera(kick);
  const last = points.at(-1);
  // Power comes from the fastest moment of the swipe (over any 50 ms), so a
  // finger that slows or pauses before lifting still counts as a hard flick.
  let speed = 0;
  for (let i = 1, j = 0; i < points.length; i++) {
    while (j < i - 1 && points[i][0] - points[j + 1][0] >= 50) j++;
    const dt = Math.max(16, points[i][0] - points[j][0]);
    speed = Math.max(speed, Math.hypot(points[i][1] - points[j][1], points[i][2] - points[j][2]) / dt);
  }
  // About 2.5 canvas px/ms is a normal thumb flick on a phone (the canvas is
  // shown at about half size there); power changes gently around it.
  const v = Math.min(V_MAX, Math.max(V_MIN, V_REF * (speed / 2.5) ** 0.5));
  // curl: the largest sideways bow from the straight line, as a share of its length
  const [, x1, y1] = points[0], cx = last[1] - x1, cy = last[2] - y1, len = Math.hypot(cx, cy) || 1;
  let bow = 0;
  for (const [, x, y] of points) {
    const d = (cx * (y - y1) - cy * (x - x1)) / len; // + is to the right of the line on screen
    if (Math.abs(d) > Math.abs(bow)) bow = d;
  }
  // a thumb swipes in a slight arc anyway, so small bows count for little
  const raw = bow / len, curl = Math.sign(raw) * Math.min(0.25, Math.max(0, Math.abs(raw) - 0.04));
  const ax = -curl * 30; // bowed right (+): the ball sets off right and bends back left
  // Aim on the goal plane. A thumb swipe on a phone is often short and stops
  // well below the goal: then the line is carried on in the same direction up
  // to 1.65 m on the goal, so a short flick still goes toward the top half.
  // Carrying a line that far also magnifies a small slant, so a carried aim is
  // kept to just outside the posts.
  let [ex, ey] = [last[1], last[2]], wideCap = 2.6;
  const goalFoot = project(cam, 0, 0, 0)[1];
  if (ey > goalFoot && cy < 0) {
    const reach = project(cam, 0, 1.65, 0)[1];
    ex = x1 + (reach - y1) * (cx / cy);
    ey = reach;
    wideCap = 1.62;
  }
  const dg = cam.z;
  // a finger that flies past the goal still aims just around it
  const aimX = Math.max(-wideCap, Math.min(wideCap, cam.x + (ex - VIEW.w / 2) * dg / cam.F));
  const aimY = Math.max(BALL_R, Math.min(2.6, cam.y - (ey - cam.hor) * dg / cam.F));
  // Lofted shots dip harder (topspin), low ones skim. The dip scales with the
  // square of the speed, so the path keeps the same shape at any power: a soft
  // shot is just slower (and a little lower), never a loop off the screen.
  const G = (3 + 16 * Math.min(1, aimY / 1.8)) * (v / V_REF) ** 2;
  // Power moves the ball up or down from the aim: harder rises 0.8 m per 100%
  // over V_REF, softer drops 2 m per 100% under it, so a soft chip doesn't
  // float up and over the wall.
  const k = v / V_REF, T = kick.D / v, y = aimY + (k >= 1 ? 0.8 : 2) * (k - 1);
  const vx = (aimX - kick.x0 - 0.5 * ax * T * T) / T;
  const vy = (y - BALL_R + 0.5 * G * T * T) / T;
  return { v, power: v / V_MAX, curl, ax, vx, vy, G, aim: [aimX, aimY] };
}

export function ballAt(kick, shot, t) {
  const y = BALL_R + shot.vy * t - 0.5 * shot.G * t * t;
  return [kick.x0 + shot.vx * t + 0.5 * shot.ax * t * t, Math.max(BALL_R, y), kick.D - shot.v * t];
}
export function jumpAt(kick, t) {
  if (!kick.jump) return 0;
  const p = (t - kick.jumpDelay) / JUMP_TIME;
  return p <= 0 || p >= 1 ? 0 : JUMP_H * Math.sin(Math.PI * p);
}

// Where the keeper can reach by time t (seconds after the strike).
export function keeperReach(kick, t, screened) {
  const react = kick.keeper.react + (screened ? 0.12 : 0);
  return Math.min(2.2, 0.5 + Math.max(0, t - react) * kick.keeper.speed);
}

// What happens to a kick: the first thing the ball meets.
// kind: wall | post | over | wide | save | goal; t is seconds after the strike.
export function judgeKick(kick, points) {
  if (!validSwipe(points)) return { kind: 'miss', t: 0, shot: null };
  const shot = shotFromSwipe(kick, points);
  const tw = WALL_GAP / shot.v;
  const [wx, wy] = ballAt(kick, shot, tw);
  const lift = jumpAt(kick, tw);
  for (const x of kick.wall) {
    if (Math.abs(wx - x) < WALL_HALF + BALL_R * 0.5 && wy + BALL_R * 0.5 > lift && wy - BALL_R * 0.5 < lift + WALL_H) {
      return { kind: 'wall', t: tw, shot, at: [wx, wy, kick.D - WALL_GAP] };
    }
  }
  const screened = wy > lift + WALL_H - 0.3 && Math.min(...kick.wall) - WALL_HALF < wx && wx < Math.max(...kick.wall) + WALL_HALF;
  const tg = kick.D / shot.v;
  const [gx, gy] = ballAt(kick, shot, tg);
  const at = [gx, gy, 0];
  // The woodwork is a thin band (ball centre within 6 cm of the line), so a
  // corner shot mostly counts as in or out rather than off the post.
  const nearPost = Math.abs(Math.abs(gx) - POST) < 0.06 && gy < GOAL_H + 0.06;
  const nearBar = Math.abs(gy - GOAL_H) < 0.06 && Math.abs(gx) < POST + 0.06;
  if (nearPost || nearBar) return { kind: 'post', t: tg, shot, at };
  if (gy > GOAL_H) return { kind: 'over', t: tg, shot, at };
  if (Math.abs(gx) > POST) return { kind: 'wide', t: tg, shot, at };
  const high = gy > 1.6 ? (gy - 1.6) * 1.2 : 0;
  const need = Math.abs(gx - kick.keeper.x) + high;
  if (need <= keeperReach(kick, tg, screened)) return { kind: 'save', t: tg, shot, at, screened };
  return { kind: 'goal', t: tg, shot, at, screened };
}

// A whole run: 10 kicks, 100 a goal, a streak multiplies (×1, ×1.5, ×2 … up to ×3).
export function replay(seed, swipes) {
  const kicks = kicksFor(seed);
  let score = 0, goals = 0, combo = 0, bestCombo = 0;
  const outcomes = [];
  for (const kick of kicks) {
    const swipe = swipes[kick.index];
    if (!swipe) break;
    const result = judgeKick(kick, swipe);
    let points = 0;
    if (result.kind === 'goal') {
      combo++; goals++; bestCombo = Math.max(bestCombo, combo);
      points = Math.round(POINTS * Math.min(3, 1 + 0.5 * (combo - 1)));
      score += points;
    } else combo = 0;
    outcomes.push({ index: kick.index, kind: result.kind, points, combo });
  }
  return { score, goals, combo, bestCombo, outcomes, finished: outcomes.length === KICKS };
}
