// Procedural world: terrain height field, airports and runway geometry definitions.
import { createNoise2D, smoothstep, clamp, lerp } from './noise.js';

const SEED = 20261109;
const n1 = createNoise2D(SEED);
const n2 = createNoise2D(SEED + 17);
const n3 = createNoise2D(SEED + 91);

function fbm(noise, x, z, oct, lac = 2.03, gain = 0.5) {
	let sum = 0, amp = 1, f = 1, norm = 0;
	for (let i = 0; i < oct; i++) {
		sum += noise(x * f, z * f) * amp;
		norm += amp; amp *= gain; f *= lac;
	}
	return sum / norm;
}

function ridged(noise, x, z, oct) {
	let sum = 0, amp = 0.55, f = 1, weight = 1;
	for (let i = 0; i < oct; i++) {
		let v = 1 - Math.abs(noise(x * f, z * f));
		v *= v; v *= weight;
		weight = clamp(v * 1.8, 0, 1);
		sum += v * amp;
		f *= 2.07; amp *= 0.5;
	}
	return sum;
}

// Raw procedural height (meters above mean sea level), before airport flattening.
export function baseHeight(x, z) {
	const qx = n2(x * 0.000045 + 5.2, z * 0.000045 + 1.3);
	const qz = n2(x * 0.000045 + 9.1, z * 0.000045 - 4.7);
	const wx = x + qx * 4000, wz = z + qz * 4000;
	const rx = x + qx * 1200, rz = z + qz * 1200;

	// Continental shape: > 0 land, < 0 sea.
	let c = fbm(n1, wx * 0.000018 + 0.37, wz * 0.000018 - 0.71, 5);
	const d2 = (x * x + z * z) / (11000 * 11000);
	c = lerp(c, 0.07, Math.exp(-d2));
	c += 0.13;

	// Mountain mask - keep a flat coastal plain around the main airport.
	const dist = Math.sqrt(x * x + z * z);
	let m = smoothstep(0.06, 0.42, c + 0.18 * n3(x * 0.00009, z * 0.00009));
	m *= smoothstep(4500, 13000, dist);

	const r = ridged(n3, rx * 0.00009 + 3.3, rz * 0.00009 - 1.9, 7);
	const hills = fbm(n2, wx * 0.0006, wz * 0.0006, 4);
	const detail = fbm(n1, x * 0.005, z * 0.005, 3);

	let h;
	if (c > 0) {
		h = c * 520 + m * (r * r * 3600 + r * 500) + hills * (25 + 220 * m) + detail * (2 + 10 * m);
	} else {
		// sea floor
		h = c * 900 + hills * 30 + detail * 2;
	}
	// gentle beaches: compress heights near sea level
	if (h > 0 && h < 6) h *= 0.6 + 0.4 * (h / 6);
	return h;
}

// ---------------------------------------------------------------------------
// Airports
// ---------------------------------------------------------------------------
export const airports = [];

function makeAirport(def) {
	const hd = def.heading * Math.PI / 180;
	const ap = {
		...def,
		hdRad: hd,
		dir: { x: Math.sin(hd), z: -Math.cos(hd) },
		right: { x: Math.cos(hd), z: Math.sin(hd) },
	};
	ap.elev = def.elev ?? Math.max(8, baseHeight(def.x, def.z));
	ap.numA = Math.round(def.heading / 10) % 36 || 36;
	ap.numB = Math.round(((def.heading + 180) % 360) / 10) % 36 || 36;
	ap.flatU = def.length / 2 + 420;
	ap.flatVmin = -170;
	ap.flatVmax = 430;
	ap.blend = 650;
	return ap;
}

export function toRunwayLocal(ap, x, z) {
	const dx = x - ap.x, dz = z - ap.z;
	return { u: dx * ap.dir.x + dz * ap.dir.z, v: dx * ap.right.x + dz * ap.right.z };
}
export function fromRunwayLocal(ap, u, v) {
	return { x: ap.x + ap.dir.x * u + ap.right.x * v, z: ap.z + ap.dir.z * u + ap.right.z * v };
}

function flattenWeight(ap, x, z) {
	const dx = x - ap.x, dz = z - ap.z;
	const u = dx * ap.dir.x + dz * ap.dir.z;
	const v = dx * ap.right.x + dz * ap.right.z;
	const du = Math.max(0, Math.abs(u) - ap.flatU);
	const dv = Math.max(0, ap.flatVmin - v, v - ap.flatVmax);
	const d = Math.sqrt(du * du + dv * dv);
	if (d >= ap.blend) return 0;
	return 1 - smoothstep(0, ap.blend, d);
}

// Find a reasonably flat site for a secondary airport near a target location.
function findSite(tx, tz, radius, length, minE, maxE, seed) {
	let best = null;
	let s = seed;
	const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
	for (let i = 0; i < 260; i++) {
		const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * radius;
		const x = tx + Math.cos(a) * r, z = tz + Math.sin(a) * r;
		const h0 = baseHeight(x, z);
		if (h0 < minE || h0 > maxE) continue;
		for (let hdg = 0; hdg < 180; hdg += 15) {
			const hr = hdg * Math.PI / 180;
			const dx = Math.sin(hr), dz = -Math.cos(hr);
			let sum = 0, sum2 = 0, k = 0;
			for (let t = -1; t <= 1.0001; t += 0.2) {
				for (let side = -1; side <= 1; side++) {
					const px = x + dx * t * (length / 2 + 400) + Math.cos(hr) * side * 250;
					const pz = z + dz * t * (length / 2 + 400) + Math.sin(hr) * side * 250;
					const h = baseHeight(px, pz);
					sum += h; sum2 += h * h; k++;
				}
			}
			const mean = sum / k;
			const variance = sum2 / k - mean * mean;
			const score = variance + Math.abs(mean - (minE + maxE) * 0.5) * 2;
			if (mean < minE) continue;
			if (!best || score < best.score) best = { x, z, heading: hdg, score, elev: mean };
		}
	}
	return best;
}

// Pick the runway heading whose primary approach (from the -u side) clears terrain best.
function bestHeading(x, z, length, elev) {
	let best = 0, bestScore = -Infinity;
	for (let h = 0; h < 360; h += 10) {
		const r = h * Math.PI / 180, dx = Math.sin(r), dz = -Math.cos(r);
		const clear = [Infinity, Infinity];
		for (const end of [-1, 1]) {
			for (let d = 500; d <= 15000; d += 250) {
				const s = length / 2 + d;
				const glide = elev + 15 + (d + 300) * Math.tan(3 * Math.PI / 180);
				clear[end < 0 ? 0 : 1] = Math.min(clear[end < 0 ? 0 : 1], glide - baseHeight(x + end * dx * s, z + end * dz * s));
			}
		}
		let mn = Infinity, mx = -Infinity;
		for (let u = -length / 2 - 400; u <= length / 2 + 400; u += 100) {
			const hh = baseHeight(x + dx * u, z + dz * u); mn = Math.min(mn, hh); mx = Math.max(mx, hh);
		}
		const score = Math.min(clear[0], 60) + 0.3 * Math.min(clear[1], 60) - (mx - mn) * 0.5;
		if (score > bestScore) { bestScore = score; best = h; }
	}
	return best;
}

export function initWorld() {
	if (airports.length) return;
	airports.push(makeAirport({
		id: 'SKW', name: 'Skyward International', x: 0, z: 0, heading: 100, length: 3200, width: 45, main: true,
	}));
	const mtn = findSite(22000, -20000, 14000, 1800, 400, 1500, 4242);
	if (mtn) {
		const e = Math.max(mtn.elev, 10);
		airports.push(makeAirport({
			id: 'RDG', name: 'Ridgeback Valley', x: mtn.x, z: mtn.z, heading: bestHeading(mtn.x, mtn.z, 1800, e),
			length: 1800, width: 30, elev: Math.max(mtn.elev, 10),
		}));
	}
	const cst = findSite(-30000, 21000, 12000, 2200, 10, 220, 777);
	if (cst) {
		const e = Math.max(cst.elev, 10);
		airports.push(makeAirport({
			id: 'CVE', name: 'Cove Harbour', x: cst.x, z: cst.z, heading: bestHeading(cst.x, cst.z, 2200, e),
			length: 2200, width: 40, elev: Math.max(cst.elev, 10),
		}));
	}
}

export function getHeight(x, z) {
	let h = baseHeight(x, z);
	for (let i = 0; i < airports.length; i++) {
		const ap = airports[i];
		const w = flattenWeight(ap, x, z);
		if (w > 0) h = lerp(h, ap.elev, w);
	}
	return h;
}

const _n = { x: 0, y: 1, z: 0 };
export function getNormal(x, z, e = 1.5) {
	const hx = getHeight(x + e, z) - getHeight(x - e, z);
	const hz = getHeight(x, z + e) - getHeight(x, z - e);
	const nx = -hx, ny = 2 * e, nz = -hz;
	const l = Math.hypot(nx, ny, nz);
	_n.x = nx / l; _n.y = ny / l; _n.z = nz / l;
	return _n;
}

// Height of the solid surface the aircraft can touch (water surface counts at 0).
export function getSurface(x, z) {
	const h = getHeight(x, z);
	return { h: Math.max(h, 0), water: h < 0 };
}

export function nearestAirport(x, z) {
	let best = null, bd = Infinity;
	for (const ap of airports) {
		const d = Math.hypot(ap.x - x, ap.z - z);
		if (d < bd) { bd = d; best = ap; }
	}
	return { ap: best, dist: bd };
}
