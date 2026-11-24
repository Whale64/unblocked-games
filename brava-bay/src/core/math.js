// Shared math helpers: deterministic RNG, hashing, value/gradient noise, easing, angles.
// Conventions (see CONTRACT.md): metres, +Y up, +X east, +Z south (north = -Z).
// Entity yaw: forward = (sin(yaw), 0, cos(yaw)); right = (-cos(yaw), 0, sin(yaw)).

export const TAU = Math.PI * 2;

export function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
export function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function invLerp(a, b, x) { return (x - a) / (b - a); }
export function smoothstep(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
export function sign(x) { return x < 0 ? -1 : 1; }

/** Frame-rate independent exponential approach: move `a` toward `b` with rate `k` (1/s). */
export function damp(a, b, k, dt) { return b + (a - b) * Math.exp(-k * dt); }

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a) {
	a = (a + Math.PI) % TAU;
	if (a < 0) a += TAU;
	return a - Math.PI;
}
/** Shortest signed difference b - a between two angles. */
export function angleDiff(a, b) { return wrapAngle(b - a); }
export function dampAngle(a, b, k, dt) { return a + angleDiff(a, b) * (1 - Math.exp(-k * dt)); }

export function yawFromDir(dx, dz) { return Math.atan2(dx, dz); }
export function forwardX(yaw) { return Math.sin(yaw); }
export function forwardZ(yaw) { return Math.cos(yaw); }
export function rightX(yaw) { return -Math.cos(yaw); }
export function rightZ(yaw) { return Math.sin(yaw); }

/** mulberry32 seeded PRNG: returns a function producing floats in [0, 1). */
export function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a = (a + 0x6D2B79F5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Convenience RNG wrapper with helpers. */
export class RNG {
	constructor(seed = 1) { this.f = mulberry32(seed); }
	next() { return this.f(); }
	range(a, b) { return a + (b - a) * this.f(); }
	int(a, b) { return a + Math.floor(this.f() * (b - a + 1)); } // inclusive
	pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
	chance(p) { return this.f() < p; }
	/** Weighted pick: items = [[value, weight], ...] */
	weighted(items) {
		let total = 0;
		for (const it of items) total += it[1];
		let r = this.f() * total;
		for (const it of items) { r -= it[1]; if (r <= 0) return it[0]; }
		return items[items.length - 1][0];
	}
	normal() { // Box-Muller
		const u = Math.max(1e-9, this.f()), v = this.f();
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
	}
}

/** Integer hash of 2 ints -> float in [0,1). Stable across runs. */
export function hash2(x, y) {
	let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}
export function hash1(x) { return hash2(x, 0x9e3779b9 | 0); }
/** Hash of a string -> uint32 */
export function hashStr(s) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
	return h >>> 0;
}

/** 2D value noise in [-1, 1], smooth (quintic). */
export function valueNoise2(x, y) {
	const xi = Math.floor(x), yi = Math.floor(y);
	const xf = x - xi, yf = y - yi;
	const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
	const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
	const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
	return (lerp(lerp(a, b, u), lerp(c, d, u), v)) * 2 - 1;
}
/** Fractal value noise, roughly in [-1, 1]. */
export function fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
	let sum = 0, amp = 1, norm = 0;
	for (let i = 0; i < octaves; i++) {
		sum += valueNoise2(x, y) * amp;
		norm += amp;
		amp *= gain; x *= lacunarity; y *= lacunarity;
		x += 17.13; y += 9.71;
	}
	return sum / norm;
}

/** Signed distance to a rounded rectangle; NEGATIVE inside, positive outside. */
export function roundedRectSDF(x, z, minX, minZ, maxX, maxZ, r) {
	const cx = (minX + maxX) * 0.5, cz = (minZ + maxZ) * 0.5;
	const hx = (maxX - minX) * 0.5 - r, hz = (maxZ - minZ) * 0.5 - r;
	const qx = Math.abs(x - cx) - hx, qz = Math.abs(z - cz) - hz;
	const ox = Math.max(qx, 0), oz = Math.max(qz, 0);
	return Math.hypot(ox, oz) + Math.min(Math.max(qx, qz), 0) - r;
}

export function pointInRect(x, z, r) { return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ; }
export function rectsOverlap(a, b) { return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ; }

/** Distance from point to segment (2D) and the param t in [0,1]. Writes into out {d, t, x, z}. */
export function pointSegment(px, pz, ax, az, bx, bz, out = {}) {
	const dx = bx - ax, dz = bz - az;
	const l2 = dx * dx + dz * dz;
	let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
	t = clamp01(t);
	const x = ax + dx * t, z = az + dz * t;
	out.t = t; out.x = x; out.z = z; out.d = Math.hypot(px - x, pz - z);
	return out;
}

/** Bridge/vertical-curve profile: smooth hump, 0 at t=0 and t=1, 1 at t=0.5, zero slope at ends. */
export function humpProfile(t) {
	t = clamp01(t);
	const s = t * (1 - t);
	return 16 * s * s;
}
export function humpSlope(t) { // d/dt of humpProfile
	t = clamp01(t);
	return 32 * t * (1 - t) * (1 - 2 * t);
}

/** Format money as $1,234,567 */
export function fmtMoney(n) {
	const s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	return (n < 0 ? '-$' : '$') + s;
}
