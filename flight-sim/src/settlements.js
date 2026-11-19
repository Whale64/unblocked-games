// Procedural human geography: towns & cities on flat lowland, a highway network routed over the
// terrain with A*, town street grids and building lots. Pure data (no rendering) so it can be
// queried by terrain/forest placement and tested headlessly.
import { getHeight, airports, fromRunwayLocal, toRunwayLocal } from './world.js';
import { rng } from './noise.js';

export const towns = [];
export const roads = []; // { pts: Float32Array [x,z,...], cum: Float32Array, len, kind: 'highway'|'street'|'avenue', width }
const NAMES = ['Bayford', 'Larkhill', 'Westmere', 'Ashbourne', 'Kestrel Point', 'Millbrook', 'Harrowgate', 'Elmstead', 'Fenwick',
	'Thornbury', 'Oakridge', 'Saltcombe', 'Redwater', 'Hollowell', 'Brightsea', 'Calder', 'Dunmore', 'Pinehurst', 'Starling', 'Wrenfield',
	'Marlow Cove', 'Eastvale', 'Northgate', 'Silverbay'];

function flatness(x, z, r) {
	const h0 = getHeight(x, z);
	let mx = 0;
	for (let k = 0; k < 8; k++) {
		const a = k / 8 * Math.PI * 2;
		mx = Math.max(mx, Math.abs(getHeight(x + Math.cos(a) * r, z + Math.sin(a) * r) - h0));
		mx = Math.max(mx, Math.abs(getHeight(x + Math.cos(a) * r * 0.5, z + Math.sin(a) * r * 0.5) - h0));
	}
	return { h0, rough: mx };
}

function nearAirport(x, z, margin) {
	for (const ap of airports) {
		const l = toRunwayLocal(ap, x, z);
		if (Math.abs(l.u) < ap.flatU + margin && l.v > ap.flatVmin - margin && l.v < ap.flatVmax + margin) return true;
	}
	return false;
}

// ---------------------------------------------------------------- road geometry helpers
function finishRoad(pts, kind, width) {
	const n = pts.length / 2;
	const cum = new Float32Array(n);
	for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
	return { pts: Float32Array.from(pts), cum, len: cum[n - 1], kind, width };
}

function chaikin(p, iters) {
	for (let it = 0; it < iters; it++) {
		const q = [p[0], p[1]];
		for (let i = 0; i < p.length / 2 - 1; i++) {
			const x0 = p[i * 2], z0 = p[i * 2 + 1], x1 = p[i * 2 + 2], z1 = p[i * 2 + 3];
			q.push(x0 * 0.75 + x1 * 0.25, z0 * 0.75 + z1 * 0.25, x0 * 0.25 + x1 * 0.75, z0 * 0.25 + z1 * 0.75);
		}
		q.push(p[p.length - 2], p[p.length - 1]);
		p = q;
	}
	return p;
}

// A* over a 250 m grid: penalise grade, avoid water (short bridges allowed) and high mountains.
function findPath(ax, az, bx, bz) {
	const C = 250, M = 6000;
	const x0 = Math.min(ax, bx) - M, z0 = Math.min(az, bz) - M;
	const nx = Math.ceil((Math.max(ax, bx) + M - x0) / C) + 1, nz = Math.ceil((Math.max(az, bz) + M - z0) / C) + 1;
	const N = nx * nz;
	const H = new Float32Array(N).fill(NaN);
	const h = (i) => { if (Number.isNaN(H[i])) H[i] = getHeight(x0 + (i % nx) * C, z0 + Math.floor(i / nx) * C); return H[i]; };
	const g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
	const cell = (x, z) => Math.round((z - z0) / C) * nx + Math.round((x - x0) / C);
	const s = cell(ax, az), t = cell(bx, bz);
	const tx = t % nx, tz = Math.floor(t / nx);
	const heap = [];
	const push = (i, f) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
	const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = k * 2 + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
	g[s] = 0; push(s, 0);
	let iter = 0;
	while (heap.length && iter++ < 120000) {
		const [, i] = pop();
		if (closed[i]) continue;
		closed[i] = 1;
		if (i === t) break;
		const ix = i % nx, iz = Math.floor(i / nx);
		const hi = h(i);
		for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
			if (!dx && !dz) continue;
			const jx = ix + dx, jz = iz + dz;
			if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
			const j = jz * nx + jx;
			if (closed[j]) continue;
			const d = C * Math.hypot(dx, dz);
			const hj = h(j);
			const grade = Math.abs(hj - hi) / d;
			let cost = d * (1 + 60 * grade * grade + (grade > 0.12 ? 25 : 0) + (hj < 0.5 ? 25 : 0) + (hj > 1600 ? 4 : 0));
			const ng = g[i] + cost;
			if (ng < g[j]) { g[j] = ng; from[j] = i; push(j, ng + C * Math.hypot(jx - tx, jz - tz)); }
		}
	}
	if (from[t] < 0) return null;
	const cells = [];
	for (let i = t; i >= 0; i = from[i]) { cells.push(i); if (i === s) break; }
	cells.reverse();
	// no long causeways: reject links that spend more than ~2 km over water
	let wet = 0;
	for (const c of cells) if (h(c) < 0.5) wet += C;
	if (wet > 2000) return null;
	// keep turning points only, then smooth
	const p = [ax, az];
	for (let k = 1; k < cells.length - 1; k++) {
		const a = cells[k - 1], b = cells[k], c = cells[k + 1];
		if (b - a !== c - b) p.push(x0 + (b % nx) * C, z0 + Math.floor(b / nx) * C);
	}
	p.push(bx, bz);
	return chaikin(p, 3);
}

// ---------------------------------------------------------------- spatial index for road queries
const GRID = 500;
const roadGrid = new Map();
function indexRoad(ri) {
	const r = roads[ri];
	for (let k = 0; k < r.pts.length / 2 - 1; k++) {
		const xa = r.pts[k * 2], za = r.pts[k * 2 + 1], xb = r.pts[k * 2 + 2], zb = r.pts[k * 2 + 3];
		const i0 = Math.floor(Math.min(xa, xb) / GRID) - 1, i1 = Math.floor(Math.max(xa, xb) / GRID) + 1;
		const j0 = Math.floor(Math.min(za, zb) / GRID) - 1, j1 = Math.floor(Math.max(za, zb) / GRID) + 1;
		for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
			const key = i + ',' + j;
			let l = roadGrid.get(key); if (!l) roadGrid.set(key, (l = []));
			l.push(ri, k);
		}
	}
}

// distance to the nearest road centre-line minus half its width (<0 = on the road)
export function roadClearance(x, z) {
	const l = roadGrid.get(Math.floor(x / GRID) + ',' + Math.floor(z / GRID));
	if (!l) return 1e9;
	let best = 1e9;
	for (let n = 0; n < l.length; n += 2) {
		const r = roads[l[n]], k = l[n + 1];
		const xa = r.pts[k * 2], za = r.pts[k * 2 + 1], xb = r.pts[k * 2 + 2], zb = r.pts[k * 2 + 3];
		const dx = xb - xa, dz = zb - za, L2 = dx * dx + dz * dz || 1;
		const t = Math.max(0, Math.min(1, ((x - xa) * dx + (z - za) * dz) / L2));
		const d = Math.hypot(x - xa - dx * t, z - za - dz * t) - r.width / 2;
		if (d < best) best = d;
	}
	return best;
}

export function townAt(x, z, pad = 0) {
	for (const t of towns) if ((x - t.x) ** 2 + (z - t.z) ** 2 < (t.r + pad) ** 2) return t;
	return null;
}

// position + heading at distance s along a road
export function roadPoint(r, s, out) {
	s = Math.max(0, Math.min(r.len, s));
	let lo = 0, hi = r.cum.length - 1;
	while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.cum[m] <= s) lo = m; else hi = m; }
	const t = (s - r.cum[lo]) / Math.max(1e-6, r.cum[hi] - r.cum[lo]);
	const xa = r.pts[lo * 2], za = r.pts[lo * 2 + 1], xb = r.pts[hi * 2], zb = r.pts[hi * 2 + 1];
	out.x = xa + (xb - xa) * t; out.z = za + (zb - za) * t; out.dx = (xb - xa); out.dz = (zb - za);
	const l = Math.hypot(out.dx, out.dz) || 1; out.dx /= l; out.dz /= l;
	return out;
}

// ---------------------------------------------------------------- generation
export function initSettlements() {
	if (towns.length) return;
	const rand = rng(90210);
	// candidates on a 2.5 km lattice
	const cands = [];
	for (let z = -66000; z <= 66000; z += 2500) for (let x = -66000; x <= 66000; x += 2500) {
		const jx = x + (rand() - 0.5) * 1500, jz = z + (rand() - 0.5) * 1500;
		const f = flatness(jx, jz, 700);
		if (f.h0 < 6 || f.h0 > 650 || f.rough > 22) continue;
		if (nearAirport(jx, jz, 1500)) continue;
		cands.push({ x: jx, z: jz, h: f.h0, score: f.rough + rand() * 8 + f.h0 * 0.01 });
	}
	cands.sort((a, b) => a.score - b.score);
	const main = airports[0];
	const pick = (c, kind, r) => {
		towns.push({ x: c.x, z: c.z, r, kind, angle: rand() * Math.PI, seed: Math.floor(rand() * 1e9), name: NAMES[towns.length % NAMES.length], elev: c.h });
	};
	// a city on the plain near the main airport
	const cityC = cands.filter((c) => { const d = Math.hypot(c.x - main.x, c.z - main.z); return d > 5500 && d < 13000; })[0];
	if (cityC) pick(cityC, 'city', 2300);
	for (const c of cands) {
		if (towns.length >= 22) break;
		const minSep = towns.some((t) => Math.hypot(t.x - c.x, t.z - c.z) < (t.kind === 'city' ? 8000 : 6000));
		if (minSep) continue;
		const n = towns.length;
		pick(c, n < 5 ? 'town' : 'village', n < 5 ? 1200 : 520);
	}
	// shrink settlements that would spill into water or an airport
	for (const t of towns) {
		for (let k = 0; k < 16; k++) {
			const a = k / 16 * Math.PI * 2;
			for (let rr = t.r; rr > 200; rr -= 100) {
				const x = t.x + Math.cos(a) * rr, z = t.z + Math.sin(a) * rr;
				if (getHeight(x, z) > 2 && !nearAirport(x, z, 300)) break;
				t.r = Math.min(t.r, rr - 100);
			}
		}
		t.r = Math.max(t.r, 250);
	}

	// highway network: each settlement to its two nearest neighbours, airports to the nearest town
	const nodes = towns.map((t) => ({ x: t.x, z: t.z }));
	airports.forEach((ap) => { const p = fromRunwayLocal(ap, 0, 520); nodes.push({ x: p.x, z: p.z, ap: true }); });
	const edges = new Set();
	nodes.forEach((a, i) => {
		const near = nodes.map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.z - b.z) })).filter((e) => e.j !== i && !(a.ap && nodes[e.j].ap)).sort((p, q) => p.d - q.d);
		for (const e of near.slice(0, a.ap ? 1 : 2)) if (e.d < 38000) edges.add(Math.min(i, e.j) + '-' + Math.max(i, e.j));
	});
	for (const e of edges) {
		const [i, j] = e.split('-').map(Number);
		const p = findPath(nodes[i].x, nodes[i].z, nodes[j].x, nodes[j].z);
		if (p) { roads.push(finishRoad(p, 'highway', 11)); indexRoad(roads.length - 1); }
	}

	// town street grids (clipped to the settlement, broken where they hit water or cliffs)
	for (const t of towns) {
		const B = t.kind === 'city' ? 115 : t.kind === 'town' ? 95 : 80;
		t.block = B;
		const ca = Math.cos(t.angle), sa = Math.sin(t.angle);
		const toW = (a, b) => [t.x + a * ca - b * sa, t.z + a * sa + b * ca];
		const n = Math.ceil(t.r / B);
		for (let dir = 0; dir < 2; dir++) {
			for (let k = -n; k <= n; k++) {
				const off = k * B;
				const half = Math.sqrt(Math.max(0, t.r * t.r - off * off));
				if (half < B) continue;
				let seg = [];
				for (let s = -half; s <= half + 1; s += 20) {
					const [x, z] = dir ? toW(off, s) : toW(s, off);
					const ok = getHeight(x, z) > 1.5 && !nearAirport(x, z, 60);
					if (ok) seg.push(x, z);
					if ((!ok || s + 20 > half + 1) && seg.length >= 8) {
						const isMain = k === 0 || (t.kind === 'city' && Math.abs(k) % 4 === 0);
						roads.push(finishRoad(seg, isMain ? 'avenue' : 'street', isMain ? 14 : 8));
						indexRoad(roads.length - 1);
						seg = [];
					} else if (!ok) seg = [];
				}
			}
		}
	}
}

// Building lots for one settlement: { towers, blocks, houses } each a flat array of
// [x, y, z, w, h, d, angle, colourIndex]
export function townLots(t) {
	const rand = rng(t.seed);
	const B = t.block, ca = Math.cos(t.angle), sa = Math.sin(t.angle);
	const toW = (a, b) => [t.x + a * ca - b * sa, t.z + a * sa + b * ca];
	const out = { towers: [], blocks: [], houses: [] };
	const n = Math.ceil(t.r / B);
	const place = (list, a, b, w, d, h, ang, col) => {
		const [x, z] = toW(a, b);
		const ext = Math.max(w, d) * 0.5;
		let lo = Infinity, hi = -Infinity;
		for (const [ox, oz] of [[0, 0], [ext, ext], [-ext, ext], [ext, -ext], [-ext, -ext]]) { const hh = getHeight(x + ox, z + oz); lo = Math.min(lo, hh); hi = Math.max(hi, hh); }
		if (lo < 1.2 || hi - lo > 7) return;
		if (roadClearance(x, z) < ext * 0.75 + 2) return;
		if (nearAirport(x, z, 80)) return;
		list.push(x, lo - 0.4, z, w, h + (hi - lo), d, t.angle + ang, col);
	};
	for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
		const a0 = i * B + B / 2, b0 = j * B + B / 2;
		const dn = Math.hypot(a0, b0) / t.r;
		if (dn > 0.97) continue;
		const inner = B - (t.kind === 'city' ? 22 : 16);
		if (t.kind === 'city' && dn < 0.3) {
			const k = rand() < 0.5 ? 1 : 2;
			for (let m = 0; m < k; m++) {
				const fw = inner / k * (0.7 + rand() * 0.25), fd = inner * (0.55 + rand() * 0.4);
				const hgt = 28 + Math.pow(1 - dn / 0.3, 1.6) * (60 + rand() * 120) + rand() * 25;
				place(out.towers, a0 - inner / 2 + inner / k * (m + 0.5), b0, fw, fd, hgt, 0, Math.floor(rand() * 6));
			}
		} else if ((t.kind === 'city' && dn < 0.65) || (t.kind === 'town' && dn < 0.38)) {
			for (let m = 0; m < 4; m++) {
				if (rand() < 0.15) continue;
				const q = inner / 2;
				const fw = q * (0.7 + rand() * 0.25), fd = q * (0.7 + rand() * 0.25);
				const hgt = (t.kind === 'city' ? 12 : 8) + rand() * (t.kind === 'city' ? 26 : 10);
				place(out.blocks, a0 + (m & 1 ? q / 2 : -q / 2), b0 + (m & 2 ? q / 2 : -q / 2), fw, fd, hgt, 0, Math.floor(rand() * 6));
			}
		} else {
			// detached houses lining the four sides of the block
			const step = 16 + rand() * 4;
			const sideLen = inner - 10;
			for (let side = 0; side < 4; side++) {
				for (let s = -sideLen / 2 + step / 2; s < sideLen / 2; s += step) {
					if (rand() < (t.kind === 'village' ? 0.45 : 0.18)) continue;
					const inset = inner / 2 - 8;
					const la = side < 2 ? s : (side === 2 ? -inset : inset);
					const lb = side < 2 ? (side === 0 ? -inset : inset) : s;
					const rot = (side < 2 ? 0 : Math.PI / 2) + (rand() - 0.5) * 0.08;
					place(out.houses, a0 + la, b0 + lb, 8 + rand() * 3, 10 + rand() * 3, 5.5 + rand() * 1.5, rot, Math.floor(rand() * 8));
				}
			}
		}
	}
	return out;
}
