// Seeded 2D simplex noise + fractal helpers (CPU side, used for terrain heights).

function mulberry32(a) {
	return function () {
		a |= 0; a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export const rng = mulberry32;

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1]);

export function createNoise2D(seed = 1337) {
	const rand = mulberry32(seed);
	const p = new Uint8Array(256);
	for (let i = 0; i < 256; i++) p[i] = i;
	for (let i = 255; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		const t = p[i]; p[i] = p[j]; p[j] = t;
	}
	const perm = new Uint8Array(512);
	const permMod8 = new Uint8Array(512);
	for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod8[i] = (perm[i] & 7) * 2; }

	return function noise2D(xin, yin) {
		let n0 = 0, n1 = 0, n2 = 0;
		const s = (xin + yin) * F2;
		const i = Math.floor(xin + s);
		const j = Math.floor(yin + s);
		const t = (i + j) * G2;
		const x0 = xin - (i - t);
		const y0 = yin - (j - t);
		let i1, j1;
		if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
		const x1 = x0 - i1 + G2;
		const y1 = y0 - j1 + G2;
		const x2 = x0 - 1 + 2 * G2;
		const y2 = y0 - 1 + 2 * G2;
		const ii = i & 255;
		const jj = j & 255;
		let t0 = 0.5 - x0 * x0 - y0 * y0;
		if (t0 >= 0) {
			const g = permMod8[ii + perm[jj]];
			t0 *= t0; n0 = t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0);
		}
		let t1 = 0.5 - x1 * x1 - y1 * y1;
		if (t1 >= 0) {
			const g = permMod8[ii + i1 + perm[jj + j1]];
			t1 *= t1; n1 = t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1);
		}
		let t2 = 0.5 - x2 * x2 - y2 * y2;
		if (t2 >= 0) {
			const g = permMod8[ii + 1 + perm[jj + 1]];
			t2 *= t2; n2 = t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2);
		}
		return 70 * (n0 + n1 + n2); // ~[-1, 1]
	};
}

export function smoothstep(a, b, x) {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
}

export function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
export function lerp(a, b, t) { return a + (b - a) * t; }

// Integer hash -> [0,1)
export function hash2(x, y) {
	let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}
