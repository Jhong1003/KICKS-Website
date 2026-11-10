// Drawing for the free kick game: pitch, goal, the KICKS keeper (the same
// figure as /keeper), wall players, the kicker seen from behind, and the ball.
// Everything is drawn in canvas units (640 × 560) from the shared camera.
import { VIEW, GOAL_W, GOAL_H, BALL_R, camera, project } from "./rules.js";

export type Pt = [number, number];
type Kick = ReturnType<typeof import("./rules.js").kicksFor>[number];
type Cam = ReturnType<typeof camera>;
export type Body = Record<"head" | "neck" | "shL" | "shR" | "elL" | "elR" | "haL" | "haR" | "hipL" | "hipR" | "knL" | "knR" | "ftL" | "ftR", Pt>;

export const KIT = { cream: "#f1ebdd", creamShade: "#ddd4c0", seam: "#b8ad96", olive: "#3f5128", oliveDark: "#2c3a1b" };
export const K = { navy: "#141b2d", red: "#e31b23", blue: "#1d3f9e", skin: "#e2b48c", hair: "#201a17", glove: "#f5f5f2" };
const SKIN_LINE = "#b98a66";
// The other team in the wall: slate shirts, navy shorts.
const OPP = { shirt: "#3a4a6b", shade: "#2c3954", trim: "#e9edf5", shorts: "#1c2335" };
const UNIT = 0.0131; // metres per body unit (a figure is about 137 units tall)

const ease = (p: number) => 1 - (1 - p) ** 3;
export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const mid = (a: Pt, b: Pt, f = 0.5): Pt => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
export const blend = (a: Body, b: Body, p: number) =>
	Object.fromEntries(Object.keys(a).map((k) => {
		const [ax, ay] = a[k as keyof Body], [bx, by] = b[k as keyof Body];
		return [k, [ax + (bx - ax) * p, ay + (by - ay) * p]];
	})) as Body;

// ----- poses (body units, hips at the origin, y down) -----
const READY: Body = { head: [0, -66], neck: [0, -54], shL: [-19, -47], shR: [19, -47], elL: [-30, -29], elR: [30, -29], haL: [-36, -12], haR: [36, -12],
	hipL: [-9, 0], hipR: [9, 0], knL: [-16, 29], knR: [16, 29], ftL: [-20, 59], ftR: [20, 59] };
const DIVE: Body = { head: [0, -67], neck: [0, -54], shL: [-15, -48], shR: [15, -48], elL: [-12, -73], elR: [12, -73], haL: [-8, -95], haR: [8, -95],
	hipL: [-8, 0], hipR: [8, 0], knL: [-5, 31], knR: [10, 27], ftL: [-7, 61], ftR: [19, 54] };
const JUMP: Body = { head: [0, -66], neck: [0, -54], shL: [-17, -48], shR: [17, -48], elL: [-25, -71], elR: [25, -71], haL: [-23, -93], haR: [23, -93],
	hipL: [-9, 0], hipR: [9, 0], knL: [-14, 24], knR: [14, 24], ftL: [-13, 52], ftR: [13, 52] };
// Wall: hands crossed low in front, feet together.
const WALL: Body = { head: [0, -66], neck: [0, -54], shL: [-18, -47], shR: [18, -47], elL: [-17, -26], elR: [17, -26], haL: [-3, -8], haR: [3, -6],
	hipL: [-8, 0], hipR: [8, 0], knL: [-9, 29], knR: [9, 29], ftL: [-10, 59], ftR: [10, 59] };
const WALL_UP: Body = { ...WALL, knL: [-11, 25], knR: [11, 25], ftL: [-9, 52], ftR: [9, 52] };
// Kicker, from behind (his right is screen right). Feet further away sit
// higher and shorter; a heel kicked up behind shows as a raised foot.
const STAND: Body = { head: [0, -66], neck: [0, -54], shL: [-17, -47], shR: [17, -47], elL: [-21, -26], elR: [21, -26], haL: [-22, -6], haR: [22, -6],
	hipL: [-9, 0], hipR: [9, 0], knL: [-10, 29], knR: [10, 29], ftL: [-11, 59], ftR: [11, 59] };
const RUN_A: Body = { head: [1, -66], neck: [1, -54], shL: [-16, -47], shR: [18, -47], elL: [-25, -30], elR: [19, -33], haL: [-26, -12], haR: [14, -20],
	hipL: [-9, 0], hipR: [9, 0], knL: [-9, 25], knR: [12, 31], ftL: [-10, 49], ftR: [15, 26] };
const RUN_B: Body = { head: [-1, -66], neck: [-1, -54], shL: [-18, -47], shR: [16, -47], elL: [-19, -33], elR: [25, -30], haL: [-14, -20], haR: [26, -12],
	hipL: [-9, 0], hipR: [9, 0], knL: [-12, 31], knR: [9, 25], ftL: [-15, 26], ftR: [10, 49] };
const PLANT: Body = { head: [-4, -64], neck: [-4, -52], shL: [-21, -45], shR: [14, -47], elL: [-36, -42], elR: [26, -30], haL: [-50, -38], haR: [30, -12],
	hipL: [-9, 0], hipR: [9, 0], knL: [-14, 29], knR: [15, 24], ftL: [-16, 58], ftR: [21, 6] };
const FOLLOW: Body = { head: [-5, -63], neck: [-5, -51], shL: [-22, -44], shR: [13, -47], elL: [-38, -44], elR: [24, -36], haL: [-52, -42], haR: [26, -18],
	hipL: [-9, 0], hipR: [9, 0], knL: [-14, 29], knR: [6, 16], ftL: [-16, 58], ftR: [3, 26] };
const CHEER: Body = { ...STAND, elL: [-27, -68], elR: [27, -68], haL: [-30, -90], haR: [30, -90] };
const HANDS_HEAD: Body = { ...STAND, elL: [-28, -66], elR: [28, -66], haL: [-9, -76], haR: [9, -76] };

export function makeDraw(ctx: CanvasRenderingContext2D) {
	const FACE = new Image(); FACE.src = "/keeper/face.webp";
	const CREST = new Image(); CREST.src = "/keeper/crest.webp";
	const ready = (img: HTMLImageElement) => img.complete && img.naturalWidth > 0;

	function taper(a: Pt, b: Pt, wa: number, wb: number, colour: string, outline?: string, round = true) {
		const shape = (grow: number) => {
			const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
			const ra = wa / 2 + grow, rb = wb / 2 + grow, angle = Math.atan2(dy, dx);
			const path = new Path2D();
			path.moveTo(a[0] + nx * ra, a[1] + ny * ra);
			path.lineTo(b[0] + nx * rb, b[1] + ny * rb);
			if (round) path.arc(b[0], b[1], rb, angle + Math.PI / 2, angle - Math.PI / 2, true);
			else path.lineTo(b[0] - nx * rb, b[1] - ny * rb);
			path.lineTo(a[0] - nx * ra, a[1] - ny * ra);
			if (round) path.arc(a[0], a[1], ra, angle - Math.PI / 2, angle + Math.PI / 2, true);
			path.closePath();
			return path;
		};
		if (outline) { ctx.fillStyle = outline; ctx.fill(shape(1.1)); }
		ctx.fillStyle = colour; ctx.fill(shape(0));
	}
	function boot(foot: Pt, out: number, back = false) {
		ctx.fillStyle = "#111318";
		ctx.beginPath();
		if (back) { ctx.ellipse(foot[0], foot[1] + 1, 4.6, 3.4, 0, 0, Math.PI * 2); ctx.fill(); return; }
		ctx.moveTo(foot[0] - 4 * out, foot[1] - 3);
		ctx.quadraticCurveTo(foot[0] + 10 * out, foot[1] - 3, foot[0] + 11 * out, foot[1] + 2);
		ctx.lineTo(foot[0] - 5 * out, foot[1] + 3);
		ctx.quadraticCurveTo(foot[0] - 7 * out, foot[1], foot[0] - 4 * out, foot[1] - 3);
		ctx.fill();
	}
	// Socks: white with two olive hoops (KICKS) or plain colour (opponents).
	function leg(hip: Pt, knee: Pt, foot: Pt, sock: string, hoops: boolean, back = false) {
		taper(hip, knee, 15, 10, K.skin, SKIN_LINE);
		taper(knee, mid(knee, foot, 0.4), 10, 11, K.skin, SKIN_LINE);
		taper(mid(knee, foot, 0.2), foot, 11, 7, sock, "rgba(20,27,45,0.3)");
		if (hoops) {
			taper(mid(knee, foot, 0.22), mid(knee, foot, 0.27), 10.8, 10.6, KIT.olive, undefined, false);
			taper(mid(knee, foot, 0.31), mid(knee, foot, 0.36), 10.4, 10.1, KIT.olive, undefined, false);
		}
		boot(foot, foot[0] < 0 ? -1 : 1, back);
	}
	function torsoPath(b: Body) {
		const [sl, sr, hl, hr] = [b.shL, b.shR, b.hipL, b.hipR];
		const waistL = mid(sl, hl, 0.68), waistR = mid(sr, hr, 0.68);
		const p = new Path2D();
		p.moveTo(b.neck[0] - 5, b.neck[1] + 4);
		p.quadraticCurveTo(sl[0] + 3, sl[1] - 4, sl[0] - 2, sl[1] + 1);
		p.quadraticCurveTo(sl[0] - 6, sl[1] + 6, sl[0] - 3, sl[1] + 13);
		p.quadraticCurveTo(waistL[0] - 1, waistL[1] - 8, waistL[0] + 1, waistL[1]);
		p.lineTo(hl[0] - 6, hl[1] - 2);
		p.lineTo(hr[0] + 6, hr[1] - 2);
		p.lineTo(waistR[0] - 1, waistR[1]);
		p.quadraticCurveTo(waistR[0] + 1, waistR[1] - 8, sr[0] + 3, sr[1] + 13);
		p.quadraticCurveTo(sr[0] + 6, sr[1] + 6, sr[0] + 2, sr[1] + 1);
		p.quadraticCurveTo(sr[0] - 3, sr[1] - 4, b.neck[0] + 5, b.neck[1] + 4);
		p.closePath();
		return p;
	}
	function shorts(b: Body, fill: string, edge: string) {
		const hemL = mid(b.hipL, b.knL, 0.42), hemR = mid(b.hipR, b.knR, 0.42);
		const n = (h: Pt, k: Pt): Pt => { const l = Math.hypot(k[0] - h[0], k[1] - h[1]) || 1; return [-(k[1] - h[1]) / l, (k[0] - h[0]) / l]; };
		const [lx, ly] = n(b.hipL, b.knL), [rx, ry] = n(b.hipR, b.knR);
		const p = new Path2D();
		p.moveTo(b.hipL[0] - 7, b.hipL[1] - 6); p.lineTo(b.hipR[0] + 7, b.hipR[1] - 6);
		p.lineTo(hemR[0] - rx * 8, hemR[1] - ry * 8); p.lineTo(hemR[0] + rx * 8, hemR[1] + ry * 8);
		p.lineTo((b.hipL[0] + b.hipR[0]) / 2, 9);
		p.lineTo(hemL[0] - lx * 8, hemL[1] - ly * 8); p.lineTo(hemL[0] + lx * 8, hemL[1] + ly * 8);
		p.closePath();
		ctx.fillStyle = fill; ctx.strokeStyle = edge; ctx.lineWidth = 1.2; ctx.lineJoin = "round";
		ctx.fill(p); ctx.stroke(p);
		return { hemL, hemR };
	}
	function plainHead(b: Body, hair: string, skin: string, back = false) {
		const [hx, hy] = b.head;
		taper([b.neck[0], b.neck[1] + 6], b.neck, 8, 7, skin);
		ctx.fillStyle = skin;
		ctx.beginPath(); ctx.ellipse(hx - 11, hy + 1, 2.5, 3.5, 0, 0, Math.PI * 2); ctx.ellipse(hx + 11, hy + 1, 2.5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
		ctx.beginPath(); ctx.ellipse(hx, hy, 11, 12.5, 0, 0, Math.PI * 2); ctx.fill();
		ctx.fillStyle = hair;
		if (back) {
			// seen from behind: hair over the whole head, a short skin fade at the nape
			ctx.beginPath(); ctx.ellipse(hx, hy - 1, 11.4, 12.6, 0, 0, Math.PI * 2); ctx.fill();
			ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(hx, hy + 10, 6.5, 3.2, 0, 0, Math.PI); ctx.fill();
			ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1.2;
			ctx.beginPath(); ctx.arc(hx - 2, hy - 4, 7, Math.PI * 1.1, Math.PI * 1.6); ctx.stroke();
			return;
		}
		ctx.beginPath(); ctx.ellipse(hx, hy - 4, 11.6, 9.5, 0, Math.PI * 1.02, Math.PI * 1.98); ctx.closePath(); ctx.fill();
		ctx.beginPath(); ctx.ellipse(hx, hy - 6, 11.4, 6.5, 0, 0, Math.PI * 2); ctx.fill();
		ctx.fillStyle = "#2a211c";
		ctx.beginPath(); ctx.arc(hx - 4, hy + 1, 1.4, 0, Math.PI * 2); ctx.arc(hx + 4, hy + 1, 1.4, 0, Math.PI * 2); ctx.fill();
	}

	// ---------- scene ----------
	function scene(kick: Kick, netFlash: number) {
		const cam = camera(kick);
		const P = (x: number, y: number, z: number) => project(cam, x, y, z);
		const sky = ctx.createLinearGradient(0, 0, 0, 120);
		sky.addColorStop(0, "#eef0ea"); sky.addColorStop(1, "#f7f6f2");
		ctx.fillStyle = sky; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
		// grass from the far boards to the camera, with mowing bands every 2 m
		const far = P(0, 0, -4)[1];
		ctx.fillStyle = "#3f5128"; ctx.fillRect(0, far, VIEW.w, VIEW.h - far);
		for (let z = -4; z < cam.z - 1; z += 4) {
			const a = P(0, 0, z)[1], b = P(0, 0, Math.min(z + 2, cam.z - 1))[1];
			ctx.fillStyle = "#4a5f30"; ctx.fillRect(0, a, VIEW.w, b - a);
		}
		// KICKS boards behind the goal
		const [, bt] = P(0, 0.9, -3.5), [, bb, bk] = P(0, 0, -3.5);
		ctx.fillStyle = K.navy; ctx.fillRect(0, bt, VIEW.w, bb - bt);
		ctx.fillStyle = K.red; ctx.fillRect(0, bb - 3, VIEW.w, 1.5);
		ctx.fillStyle = K.blue; ctx.fillRect(0, bb - 1.5, VIEW.w, 1.5);
		const fs = Math.max(9, bk * 0.42);
		ctx.font = `800 ${fs}px -apple-system, 'Segoe UI', sans-serif`; ctx.textBaseline = "middle"; ctx.textAlign = "center";
		const step = bk * 2.6;
		for (let x = (P(0, 0, -3.5)[0] % step) - step, i = 0; x < VIEW.w + step; x += step, i++) {
			ctx.fillStyle = "#ffffff"; ctx.fillText("KICKS", x, (bt + bb) / 2);
			ctx.fillStyle = i % 2 ? K.red : K.blue; ctx.beginPath(); ctx.arc(x + step / 2, (bt + bb) / 2, fs * 0.2, 0, Math.PI * 2); ctx.fill();
		}
		// lines: goal line and the futsal penalty area (6 m arcs), drawn on the ground
		ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
		const line = (pts: [number, number][]) => { ctx.beginPath(); pts.forEach(([x, z], i) => { const [sx, sy] = P(x, 0, z); ctx[i ? "lineTo" : "moveTo"](sx, sy); }); ctx.stroke(); };
		line([[-12, 0], [12, 0]]);
		const arc = (sign: number) => Array.from({ length: 16 }, (_, i) => { const a = (i / 15) * Math.PI / 2; return [sign * (0.8 + 6 * Math.sin(a)), 6 * Math.cos(a)] as [number, number]; });
		line([...arc(-1).reverse(), ...arc(1)]);
		// the spot where the ball sits
		const [sx, sy, sk] = P(kick.x0, 0, kick.D);
		ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.beginPath(); ctx.ellipse(sx, sy, sk * 0.1, sk * 0.035, 0, 0, Math.PI * 2); ctx.fill();

		// goal: net box, posts and bar
		const h = GOAL_W / 2, depth = 0.9;
		const c = {
			fl: P(-h, 0, 0), fr: P(h, 0, 0), tl: P(-h, GOAL_H, 0), tr: P(h, GOAL_H, 0),
			bl: P(-h, 0, -depth), br: P(h, 0, -depth), btl: P(-h, GOAL_H * 0.85, -depth), btr: P(h, GOAL_H * 0.85, -depth),
		};
		const quad = (pts: number[][], fill: string) => { ctx.fillStyle = fill; ctx.beginPath(); pts.forEach((p, i) => ctx[i ? "lineTo" : "moveTo"](p[0], p[1])); ctx.closePath(); ctx.fill(); };
		quad([c.btl, c.btr, c.br, c.bl], "#d3dac8");
		quad([c.tl, c.btl, c.bl, c.fl], "#c9d1bd");
		quad([c.tr, c.btr, c.br, c.fr], "#c9d1bd");
		quad([c.tl, c.tr, c.btr, c.btl], "#dfe4d6");
		if (netFlash > 0) quad([c.btl, c.btr, c.br, c.bl], `rgba(20,27,45,${0.18 * netFlash})`);
		ctx.strokeStyle = "rgba(20,27,45,0.14)"; ctx.lineWidth = 1;
		ctx.beginPath();
		for (let x = -h; x <= h + 1e-6; x += 0.15) { const a = P(x, GOAL_H * 0.85, -depth), b = P(x, 0, -depth); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
		for (let y = 0; y <= GOAL_H * 0.85 + 1e-6; y += 0.15) { const a = P(-h, y, -depth), b = P(h, y, -depth); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
		ctx.stroke();
		const k0 = c.fl[2];
		ctx.lineJoin = "round"; ctx.lineCap = "butt";
		ctx.strokeStyle = "rgba(20,27,45,0.25)"; ctx.lineWidth = k0 * 0.1;
		ctx.beginPath(); ctx.moveTo(c.fl[0] + 2, c.fl[1]); ctx.lineTo(c.tl[0] + 2, c.tl[1] + 2); ctx.lineTo(c.tr[0] + 2, c.tr[1] + 2); ctx.lineTo(c.fr[0] + 2, c.fr[1]); ctx.stroke();
		ctx.strokeStyle = "#ffffff"; ctx.lineWidth = k0 * 0.08;
		ctx.beginPath(); ctx.moveTo(c.fl[0], c.fl[1]); ctx.lineTo(c.tl[0], c.tl[1]); ctx.lineTo(c.tr[0], c.tr[1]); ctx.lineTo(c.fr[0], c.fr[1]); ctx.stroke();
	}

	// ---------- keeper (same figure and kit as /keeper) ----------
	type Pose = { x: number; y: number; angle: number; body: Body; lift: number; scale: number; ground: number };
	// home: where the hips are at rest. target: where the gloves go (null = ready).
	function keeperPose(kick: Kick, target: Pt | null, high: boolean, p: number, now: number, fall = 0): Pose {
		const cam = camera(kick);
		const [gx, gy, k] = project(cam, kick.keeper.x, 0, 0.3);
		const scale = k * UNIT, home: Pt = [gx, gy - 59 * scale];
		if (!target) return { x: home[0], y: home[1] + Math.sin(now / 180) * 1.2 * scale, angle: 0, body: READY, lift: 0, scale, ground: gy };
		const e = ease(p);
		const dx = target[0] - home[0];
		if (Math.abs(dx) < 26 * scale) {
			// straight up / at the body
			const up = Math.sin(Math.PI * clamp(p * 1.3));
			return { x: home[0] + dx * e, y: home[1] - 14 * scale * up, angle: 0, body: blend(READY, JUMP, ease(clamp(p * 1.6))), lift: up, scale, ground: gy };
		}
		const side = dx < 0 ? -1 : 1;
		const angle = side * (high ? 0.8 : 1.32);
		const [hx, hy] = [(DIVE.haL[0] + DIVE.haR[0]) / 2 * scale, DIVE.haL[1] * scale * 0.95];
		const rootX = target[0] - (hx * Math.cos(angle) - hy * Math.sin(angle));
		const rootY = Math.min(target[1] - (hx * Math.sin(angle) + hy * Math.cos(angle)), gy - 22 * scale);
		const f = fall * fall;
		const y = home[1] + (rootY - home[1]) * e;
		return {
			x: home[0] + (rootX - home[0]) * e, y: y + (gy - 20 * scale - y) * f,
			angle: angle * e + (side * 1.45 - angle) * f, body: blend(READY, DIVE, ease(clamp(p * 1.3))), lift: (high ? e : e * 0.4) * (1 - f), scale, ground: gy,
		};
	}
	function gloves(k: Pose): Pt {
		const w = ([x, y]: Pt): Pt => { x *= k.scale; y *= k.scale; return [k.x + x * Math.cos(k.angle) - y * Math.sin(k.angle), k.y + x * Math.sin(k.angle) + y * Math.cos(k.angle)]; };
		const l = w(k.body.haL), r = w(k.body.haR);
		return [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2];
	}
	function drawGlove(wrist: Pt, hand: Pt) {
		const angle = Math.atan2(hand[1] - wrist[1], hand[0] - wrist[0]);
		ctx.save();
		ctx.translate(...hand); ctx.rotate(angle);
		ctx.fillStyle = K.glove; ctx.strokeStyle = "rgba(20,27,45,0.6)"; ctx.lineWidth = 1.2;
		ctx.beginPath(); ctx.ellipse(1.5, 0, 8.5, 6.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
		ctx.beginPath(); ctx.ellipse(-2, 5.5, 3.6, 2.4, 0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
		ctx.fillStyle = KIT.olive; ctx.fillRect(-6.5, -5, 3, 10);
		ctx.restore();
	}
	function keeper(k: Pose) {
		const b = k.body;
		ctx.fillStyle = `rgba(20,27,45,${0.22 - 0.12 * k.lift})`;
		ctx.beginPath(); ctx.ellipse(k.x, k.ground + 1, (30 + 16 * Math.abs(Math.sin(k.angle))) * k.scale, 5 * k.scale, 0, 0, Math.PI * 2); ctx.fill();
		ctx.save();
		ctx.translate(k.x, k.y); ctx.rotate(k.angle); ctx.scale(k.scale, k.scale);
		for (const [hip, knee, foot] of [[b.hipL, b.knL, b.ftL], [b.hipR, b.knR, b.ftR]] as Pt[][]) leg(hip, knee, foot, "#ffffff", true);
		const { hemL } = shorts(b, KIT.olive, KIT.oliveDark);
		if (ready(CREST)) { const c = mid(b.hipL, hemL, 0.62); ctx.drawImage(CREST, c[0] - 1.5, c[1] - 3, 5, 5); }
		const torso = torsoPath(b);
		const shade = ctx.createLinearGradient(b.shL[0] - 6, 0, b.shR[0] + 6, 0);
		shade.addColorStop(0, "#fbf7ee"); shade.addColorStop(0.55, KIT.cream); shade.addColorStop(1, KIT.creamShade);
		ctx.fillStyle = shade; ctx.fill(torso);
		ctx.save(); ctx.clip(torso);
		const chestY = b.shL[1] + 9, chestX = (b.shL[0] + b.shR[0]) / 2;
		ctx.fillStyle = KIT.olive; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
		ctx.font = "italic 900 6px system-ui, sans-serif"; ctx.fillText("K", chestX - 9, chestY + 1);
		if (ready(CREST)) ctx.drawImage(CREST, chestX + 5, chestY - 5, 7, 7);
		ctx.font = "900 10px system-ui, sans-serif"; ctx.fillText("KICKS", chestX, chestY + 13, 32);
		ctx.restore();
		ctx.strokeStyle = KIT.seam; ctx.lineWidth = 1.2; ctx.stroke(torso);
		for (const [sh, el, ha] of [[b.shL, b.elL, b.haL], [b.shR, b.elR, b.haR]] as Pt[][]) {
			const wrist = mid(el, ha, 0.82);
			taper(mid(sh, el, -0.08), el, 10.5, 8, KIT.cream, KIT.seam);
			taper(el, wrist, 8, 6.5, KIT.cream, KIT.seam);
			taper(mid(el, ha, 0.72), wrist, 7.4, 7, KIT.olive, undefined, false);
			drawGlove(wrist, ha);
		}
		taper([b.neck[0], b.neck[1] + 6], b.neck, 8, 7, K.skin);
		ctx.strokeStyle = KIT.olive; ctx.lineWidth = 2.2; ctx.lineJoin = "miter";
		ctx.beginPath(); ctx.moveTo(b.neck[0] - 6, b.neck[1] + 3.5); ctx.lineTo(b.neck[0], b.neck[1] + 10); ctx.lineTo(b.neck[0] + 6, b.neck[1] + 3.5); ctx.stroke();
		if (ready(FACE)) {
			const h = 31, w = h * FACE.naturalWidth / FACE.naturalHeight, chin = b.neck[1] + 4;
			ctx.save(); ctx.shadowColor = "rgba(20,27,45,0.45)"; ctx.shadowBlur = 3;
			ctx.drawImage(FACE, b.head[0] - w / 2, chin - h, w, h);
			ctx.restore();
		} else plainHead(b, K.hair, K.skin);
		ctx.restore();
	}

	// ---------- wall players ----------
	const LOOKS = [["#201a17", "#e2b48c"], ["#3b2a1e", "#c99a72"], ["#0f0d0c", "#f0c7a2"], ["#5a3d24", "#d8a67c"], ["#151515", "#b98563"]];
	function wallMan(kick: Kick, x: number, lift: number, i: number, number: number) {
		const cam = camera(kick);
		const z = kick.D - 5;
		const [gx, gy, k] = project(cam, x, 0, z);
		const [, ly] = project(cam, x, lift, z);
		const s = k * UNIT;
		ctx.fillStyle = `rgba(20,27,45,${0.22 - 0.3 * lift})`;
		ctx.beginPath(); ctx.ellipse(gx, gy, 20 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
		const b = blend(WALL, WALL_UP, clamp(lift / 0.3));
		const [hair, skin] = LOOKS[i % LOOKS.length];
		ctx.save();
		ctx.translate(gx, ly - 59 * s); ctx.scale(s, s);
		for (const [hip, knee, foot] of [[b.hipL, b.knL, b.ftL], [b.hipR, b.knR, b.ftR]] as Pt[][]) leg(hip, knee, foot, OPP.shorts, false);
		shorts(b, OPP.shorts, "#0d1220");
		const torso = torsoPath(b);
		const shade = ctx.createLinearGradient(b.shL[0], 0, b.shR[0], 0);
		shade.addColorStop(0, OPP.shirt); shade.addColorStop(1, OPP.shade);
		ctx.fillStyle = shade; ctx.fill(torso);
		ctx.fillStyle = OPP.trim; ctx.font = "800 12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
		ctx.fillText(String(number), 0, -30);
		for (const [sh, el, ha] of [[b.shL, b.elL, b.haL], [b.shR, b.elR, b.haR]] as Pt[][]) {
			taper(mid(sh, el, -0.08), mid(sh, el, 0.55), 10.5, 9, OPP.shirt, OPP.shade);
			taper(mid(sh, el, 0.5), el, 8.5, 8, skin, SKIN_LINE);
			taper(el, ha, 8, 6.5, skin, SKIN_LINE);
		}
		ctx.strokeStyle = OPP.trim; ctx.lineWidth = 1.6;
		ctx.beginPath(); ctx.arc(b.neck[0], b.neck[1] + 2, 5, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
		plainHead(b, hair, skin);
		ctx.restore();
	}

	// ---------- kicker, from behind ----------
	// phase: ms since the swipe ended; strikeAt: when the foot meets the ball.
	function kickerBody(phase: number, strikeAt: number, after: "cheer" | "sad" | null, afterFor: number): Body {
		if (phase < 0) return STAND;
		if (phase < strikeAt - 140) {
			const stride = 140, i = Math.floor(phase / stride), p = (phase % stride) / stride;
			const [a, b] = i % 2 ? [RUN_B, RUN_A] : [RUN_A, RUN_B];
			return blend(i === 0 ? blend(STAND, a, p) : a, b, i === 0 ? 0 : ease(p));
		}
		if (phase < strikeAt) return blend(RUN_B, PLANT, ease((phase - (strikeAt - 140)) / 140));
		if (phase < strikeAt + 220) return blend(PLANT, FOLLOW, ease((phase - strikeAt) / 120));
		if (!after) return FOLLOW;
		return blend(FOLLOW, after === "cheer" ? CHEER : HANDS_HEAD, ease(clamp(afterFor / 260)));
	}
	// World position of the kicker's hips on the ground plane over the run-up.
	function kickerSpot(kick: Kick, phase: number, strikeAt: number): [number, number] {
		const start: [number, number] = [kick.x0 - 1.0, kick.D + 1.8];
		const plant: [number, number] = [kick.x0 - 0.34, kick.D + 0.22];
		if (phase <= 0) return start;
		const p = clamp(phase / strikeAt);
		const end: [number, number] = [kick.x0 - 0.2, kick.D - 0.1];
		if (p < 1) return [start[0] + (plant[0] - start[0]) * p, start[1] + (plant[1] - start[1]) * p];
		const q = ease(clamp((phase - strikeAt) / 400));
		return [plant[0] + (end[0] - plant[0]) * q, plant[1] + (end[1] - plant[1]) * q];
	}
	const KICKER_CHEAT = 0.48; // drawn smaller than true perspective so the goal stays in view
	function kicker(kick: Kick, phase: number, strikeAt: number, after: "cheer" | "sad" | null, afterFor: number) {
		const cam = camera(kick);
		const [wx, wz] = kickerSpot(kick, phase, strikeAt);
		const [gx, gy, k] = project(cam, wx, 0, wz);
		const s = k * UNIT * KICKER_CHEAT;
		const bob = phase > 0 && phase < strikeAt ? Math.abs(Math.sin((phase / 140) * Math.PI)) * 3 * s : 0;
		const b = kickerBody(phase, strikeAt, after, afterFor);
		ctx.fillStyle = "rgba(20,27,45,0.25)";
		ctx.beginPath(); ctx.ellipse(gx, gy, 22 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
		ctx.save();
		ctx.translate(gx, gy - 59 * s - bob); ctx.scale(s, s);
		// the right leg is behind the body while it swings through
		const swingThrough = phase >= strikeAt && phase < strikeAt + 600;
		const legs = [[b.hipL, b.knL, b.ftL], [b.hipR, b.knR, b.ftR]] as Pt[][];
		if (swingThrough) leg(legs[1][0], legs[1][1], legs[1][2], "#ffffff", true, true);
		leg(legs[0][0], legs[0][1], legs[0][2], "#ffffff", true, true);
		if (!swingThrough) leg(legs[1][0], legs[1][1], legs[1][2], "#ffffff", true, true);
		shorts(b, KIT.olive, KIT.oliveDark);
		const torso = torsoPath(b);
		const shade = ctx.createLinearGradient(b.shL[0] - 6, 0, b.shR[0] + 6, 0);
		shade.addColorStop(0, KIT.creamShade); shade.addColorStop(0.45, KIT.cream); shade.addColorStop(1, "#fbf7ee");
		ctx.fillStyle = shade; ctx.fill(torso);
		ctx.save(); ctx.clip(torso);
		// back of the shirt: KICKS over a big number
		const cx = (b.shL[0] + b.shR[0]) / 2;
		ctx.fillStyle = KIT.olive; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
		ctx.font = "900 8px system-ui, sans-serif"; ctx.fillText("KICKS", cx, b.shL[1] + 10, 30);
		ctx.font = "900 22px system-ui, sans-serif"; ctx.fillText("10", cx, b.shL[1] + 31);
		ctx.restore();
		ctx.strokeStyle = KIT.seam; ctx.lineWidth = 1.2; ctx.stroke(torso);
		for (const [sh, el, ha] of [[b.shL, b.elL, b.haL], [b.shR, b.elR, b.haR]] as Pt[][]) {
			taper(mid(sh, el, -0.08), mid(sh, el, 0.6), 10.5, 9, KIT.cream, KIT.seam);
			taper(mid(sh, el, 0.55), el, 8.5, 8, K.skin, SKIN_LINE);
			taper(el, ha, 8, 6.5, K.skin, SKIN_LINE);
			ctx.fillStyle = K.skin; ctx.beginPath(); ctx.arc(ha[0], ha[1], 4, 0, Math.PI * 2); ctx.fill();
		}
		ctx.fillStyle = KIT.olive; ctx.fillRect(b.neck[0] - 5, b.neck[1] + 3, 10, 2.2); // collar
		plainHead(b, K.hair, K.skin, true);
		ctx.restore();
	}

	// ---------- ball ----------
	const PENT = (cx: number, cy: number, r: number, rot: number): Pt[] =>
		Array.from({ length: 5 }, (_, i) => { const a = rot + i * (Math.PI * 2 / 5); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt; });
	// The ball near the camera is drawn a little smaller than true size, to match the kicker.
	function ball(kick: Kick, x: number, y: number, z: number, spin: number, alpha = 1) {
		const cam = camera(kick);
		const [sx, sy, k] = project(cam, x, y, z);
		const [gx, gy] = project(cam, x, 0, z);
		const depth = cam.z - z;
		const r = BALL_R * k * clamp(depth / 13, KICKER_CHEAT + 0.1, 1);
		ctx.fillStyle = `rgba(20,27,45,${0.25 * alpha * clamp(1 - (y - BALL_R) / 3)})`;
		ctx.beginPath(); ctx.ellipse(gx, gy, r * 0.95, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
		const R = 17, scale = r / R;
		ctx.save();
		ctx.globalAlpha = alpha;
		ctx.translate(sx, sy - (r - BALL_R * k)); ctx.scale(scale, scale);
		const body = ctx.createRadialGradient(-5, -6, 2, 0, 0, R);
		body.addColorStop(0, "#ffffff"); body.addColorStop(0.7, "#f1f2f3"); body.addColorStop(1, "#c9ced6");
		ctx.fillStyle = body; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
		ctx.save(); ctx.clip(); ctx.rotate(spin);
		const stepA = Math.PI * 2 / 5;
		const centre = PENT(0, 0, R * 0.31, -Math.PI / 2);
		const outer = Array.from({ length: 5 }, (_, i) => { const a = -Math.PI / 2 + i * stepA; return PENT(Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8, R * 0.27, a + Math.PI); });
		ctx.fillStyle = K.navy;
		for (const pent of [centre, ...outer]) { ctx.beginPath(); pent.forEach((pt, i) => ctx[i ? "lineTo" : "moveTo"](...pt)); ctx.closePath(); ctx.fill(); }
		ctx.strokeStyle = "rgba(20,27,45,0.7)"; ctx.lineWidth = 1;
		ctx.beginPath();
		for (let i = 0; i < 5; i++) {
			ctx.moveTo(...centre[i]); ctx.lineTo(...outer[i][0]);
			const m = -Math.PI / 2 + (i + 0.5) * stepA;
			const joint: Pt = [Math.cos(m) * R * 0.86, Math.sin(m) * R * 0.86];
			ctx.moveTo(...outer[i][3]); ctx.lineTo(...joint); ctx.lineTo(...outer[(i + 1) % 5][2]);
		}
		ctx.stroke();
		ctx.restore();
		const shade = ctx.createRadialGradient(-6, -7, 3, 0, 0, R);
		shade.addColorStop(0, "rgba(255,255,255,0.35)"); shade.addColorStop(0.6, "rgba(255,255,255,0)"); shade.addColorStop(1, "rgba(20,27,45,0.28)");
		ctx.fillStyle = shade; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
		ctx.strokeStyle = K.navy; ctx.lineWidth = 1.6 / scale; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
		ctx.restore();
	}

	return { scene, keeperPose, gloves, keeper, wallMan, kicker, ball };
}
