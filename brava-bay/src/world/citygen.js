// Brava Bay city layout generator. Pure data (no THREE). Deterministic for a given seed.
// Produces roads (graph), blocks, lots/buildings, props, platforms, POIs and the land/coast height model.
// Everything that rendering and collision must agree on is generated HERE. See CONTRACT.md.
//
// Coordinates: metres, +X east, +Z south (north = -Z), +Y up. Road surface y = 0, blocks/sidewalks y = CURB (0.15).
import { RNG, fbm2, roundedRectSDF, clamp, smoothstep, lerp, humpProfile, humpSlope, hash2 } from '../core/math.js';

export const WORLD = {
	half: 1400,          // world spans [-half, half] in x and z; open ocean beyond
	waterY: -0.6,        // sea surface height
	curb: 0.15,          // sidewalk / block top height above road
	laneW: 3.5,          // lane width
	shoulder: 0.5,       // asphalt beyond the outer lane, each side
	crosswalkW: 3.2,     // zebra crossing width
	stopGap: 0.8,        // gap between crosswalk and stop line
};

// Land masses (rounded rectangles with noisy natural coastlines).
export const LANDS = [
	{ id: 'mainland', name: 'Brava Mainland', minX: -1150, maxX: 400, minZ: -1000, maxZ: 1000, r: 160, wobble: 20 },
	{ id: 'key', name: 'Coral Key', minX: 620, maxX: 990, minZ: -960, maxZ: 960, r: 190, wobble: 9 },
];

export const DISTRICTS = [
	{ id: 'downtown', name: 'Downtown', minX: -190, maxX: 400, minZ: -500, maxZ: 200 },
	{ id: 'heights', name: 'Calloway Heights', minX: -190, maxX: 400, minZ: -1000, maxZ: -500 },
	{ id: 'bayside', name: 'Bayside', minX: -190, maxX: 400, minZ: 200, maxZ: 1000 },
	{ id: 'pintura', name: 'La Pintura', minX: -660, maxX: -190, minZ: -1000, maxZ: 500 },
	{ id: 'mangrove', name: 'Mangrove Park', minX: -1150, maxX: -660, minZ: -1000, maxZ: 500 },
	{ id: 'port', name: 'Port Cayo', minX: -1150, maxX: -190, minZ: 500, maxZ: 1000 },
	{ id: 'coralkey', name: 'Coral Key', minX: 560, maxX: 1300, minZ: -1100, maxZ: 1100 },
	{ id: 'bay', name: 'Brava Bay', minX: 400, maxX: 620, minZ: -1100, maxZ: 1100 },
];

// ---- Road grid definitions ------------------------------------------------------------------
// [coordinate, name, lanesPerDirection, medianWidth]
const MAIN_AVES = [
	[-1020, 'Mangrove Way', 1, 0], [-900, 'Heron Ave', 1, 0], [-780, 'Cypress Ave', 1, 0], [-660, 'Tamarind Ave', 1, 0],
	[-540, 'Calloway Ave', 2, 3], [-420, 'Seagrape Ave', 1, 0], [-300, 'Pintura Ave', 1, 0], [-190, 'Coquina Ave', 1, 0],
	[-80, 'Royal Palm Ave', 2, 0], [30, 'Brava Blvd', 2, 3], [140, 'Sabal Ave', 2, 0], [250, 'Marlin Ave', 1, 0], [360, 'Bayshore Dr', 2, 0],
];
const MAIN_STREETS = (() => {
	const out = [];
	for (let i = 0; i <= 18; i++) {
		const z = -900 + i * 100;
		let name, lanes = 1, med = 0;
		if (z === -900) name = 'Northshore Dr';
		else if (z === 900) name = 'Harbor Dr';
		else if (z === 0) { name = 'Causeway Blvd'; lanes = 2; med = 3; }
		else if (z === -400) { name = 'Hibiscus Blvd'; lanes = 2; med = 3; }
		else if (z === 400) { name = 'Flamingo Blvd'; lanes = 2; med = 3; }
		else name = `${z < 0 ? 'N' : 'S'} ${ordinal(Math.abs(z) / 100)} St`;
		out.push([z, name, lanes, med]);
	}
	return out;
})();
const KEY_AVES = [[660, 'Bayview Dr', 1, 0], [770, 'Coral Ave', 1, 0], [880, 'Sunrise Dr', 1, 0]];
const KEY_STREETS = (() => {
	const out = [];
	for (let i = 0; i <= 14; i++) {
		const z = -840 + i * 120;
		let name = `${ordinal(15 - i)} St`, lanes = 1, med = 0;
		if (z === 0) { name = 'Causeway Blvd'; lanes = 2; med = 3; }
		out.push([z, name, lanes, med]);
	}
	return out;
})();
const BRIDGES = [
	{ z: -600, name: 'Pelican Causeway', lanes: 1, median: 0, h: 7 },
	{ z: 0, name: 'Brava Causeway', lanes: 2, median: 3, h: 9 },
	{ z: 600, name: 'Manatee Causeway', lanes: 1, median: 0, h: 7 },
];
const BRIDGE_X0 = 385, BRIDGE_X1 = 635; // elevated span (abutments on each seawall)

function ordinal(n) {
	const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
	return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function roadWidth(lanes, median) { return 2 * lanes * WORLD.laneW + median + 2 * WORLD.shoulder; }
export function speedLimit(lanes, kind) { return kind === 'bridge' ? 20 : lanes >= 2 ? 17.9 : 13.4; }

// Merged cell groups (internal roads removed) and special single cells.
const MERGES = [
	{ land: 'mainland', i0: 5, i1: 6, j0: 10, j1: 11, kind: 'park', name: 'Palmera Park' },
	{ land: 'mainland', i0: 0, i1: 1, j0: 16, j1: 17, kind: 'port', name: 'Cayo Container Terminal' },
	{ land: 'key', i0: 0, i1: 1, j0: 12, j1: 13, kind: 'park', name: 'Lighthouse Park' },
];
const SPECIAL_CELLS = [
	{ land: 'mainland', i: 11, j: 9, kind: 'park', name: 'Bayfront Park' },
	{ land: 'mainland', i: 2, j: 4, kind: 'park', name: 'Heron Park' },
	{ land: 'mainland', i: 8, j: 13, kind: 'plaza', name: 'Liberty Square' },
	{ land: 'mainland', i: 9, j: 7, kind: 'buildings', role: 'meridian' },
	{ land: 'mainland', i: 7, j: 5, kind: 'buildings', role: 'hospital' },
	{ land: 'mainland', i: 10, j: 11, kind: 'buildings', role: 'police' },
	{ land: 'key', i: 0, j: 10, kind: 'buildings', role: 'police2' },
	{ land: 'mainland', i: 4, j: 12, kind: 'buildings', role: 'garage' },
	{ land: 'mainland', i: 6, j: 6, kind: 'buildings', role: 'sprayshop' },
	{ land: 'mainland', i: 5, j: 7, kind: 'buildings', role: 'cafe' },
	{ land: 'key', i: 0, j: 5, kind: 'buildings', role: 'safehouse' },
	{ land: 'mainland', i: 3, j: 9, kind: 'buildings', role: 'gas' },
	{ land: 'mainland', i: 10, j: 15, kind: 'buildings', role: 'gas' },
	{ land: 'key', i: 1, j: 3, kind: 'buildings', role: 'gas' },
	{ land: 'mainland', i: 1, j: 11, kind: 'buildings', role: 'gas' },
];

const PIER = { minX: 925, maxX: 1100, minZ: -206, maxZ: -194, endMinX: 1100, endMaxX: 1160, endMinZ: -235, endMaxZ: -165, deck: 2.5 };

// ---- Coast model -----------------------------------------------------------------------------
function seawallness(x, z) {
	const mainEast = smoothstep(300, 360, x) * (x < 510 ? 1 : 0);
	const port = smoothstep(860, 930, z) * smoothstep(-260, -330, x);
	const keyWest = smoothstep(720, 660, x) * (x > 510 ? 1 : 0);
	return Math.max(mainEast, port, keyWest);
}
function beachness(x, z) {
	return smoothstep(870, 905, x) * (x > 510 ? 1 : 0);
}
/** Signed distance to the coastline: POSITIVE on land (metres inland), negative over water. */
export function landDist(x, z) {
	let best = -1e9;
	for (const L of LANDS) {
		let d = -roundedRectSDF(x, z, L.minX, L.minZ, L.maxX, L.maxZ, L.r);
		if (d > -200) {
			const sw = seawallness(x, z);
			const amp = L.wobble * (1 - sw) * (beachness(x, z) > 0.5 ? 0.6 : 1);
			if (amp > 0) d += amp * fbm2(x / 160 + (L.id === 'key' ? 40 : 0), z / 160, 3);
		}
		if (d > best) best = d;
	}
	return best;
}
/** Height of the natural (non-road, non-block) ground or seabed at (x, z). */
export function naturalHeight(x, z) {
	const d = landDist(x, z);
	const sw = seawallness(x, z), bh = beachness(x, z);
	const W = WORLD.waterY;
	if (d >= 0) {
		const hN = lerp(W, 0, smoothstep(0, 18, d));
		const hB = lerp(W, WORLD.curb, smoothstep(0, 95, d));
		return lerp(lerp(hN, hB, bh), 0, sw);
	}
	const e = -d;
	const sbN = W - Math.min(14, e * 0.12);
	const sbB = W - Math.min(10, e * 0.035);
	const sbS = -5 - Math.min(9, e * 0.05);
	return lerp(lerp(sbN, sbB, bh), sbS, sw);
}
export function naturalSurface(x, z, y) {
	if (y < WORLD.waterY - 0.02) return 'water';
	if (beachness(x, z) > 0.5) return 'sand';
	if (z > 860 && x < -250) return 'concrete';
	if (seawallness(x, z) > 0.5 && landDist(x, z) < 12) return 'concrete';
	return 'grass';
}
export function districtAt(x, z) {
	for (const d of DISTRICTS) if (x >= d.minX && x <= d.maxX && z >= d.minZ && z <= d.maxZ) return d;
	return { id: 'ocean', name: 'Open Water' };
}

// ---- Palettes --------------------------------------------------------------------------------
const PALETTES = {
	deco: ['#f7c6cf', '#a9e4de', '#fde3a7', '#cdbdf4', '#ffffff', '#a5d6f5', '#ffd1b3', '#c8f0c2'],
	stucco: ['#f4efe6', '#ece2d0', '#f8f4ec', '#e9dccb', '#ddd3c4', '#f1e6d8'],
	shop: ['#e85d75', '#2bb3a8', '#f3b33d', '#6c63d9', '#ff8a5b', '#3a7bd5', '#f6f1e7', '#8bc34a', '#e0457b'],
	glass: ['#5f8fa8', '#3d6e8c', '#7fa7b8', '#8c7a5e', '#4b5d6b', '#6e9fb0', '#2f4f63'],
	concrete: ['#bdb8ae', '#a9a69f', '#c9c3b6', '#9d9a94', '#d0cbc0'],
	house: ['#f5f1e8', '#f2dcc6', '#f6c2a9', '#cfe3d4', '#cde0ef', '#f3e6b8', '#e8d4e8'],
	warehouse: ['#8a929b', '#6d7f8f', '#9a8572', '#7e8b7a', '#a7a29a', '#5f6f7f'],
	container: ['#b8432f', '#2f6db8', '#2f8f4f', '#c98b2b', '#7a3f8f', '#8f8f8f', '#1f5f6f', '#d4c22f'],
};

// ---- Generator -------------------------------------------------------------------------------
export function generateCity(seed = 20261123) {
	const rng = new RNG(seed);
	const city = {
		seed, world: WORLD, lands: LANDS, districts: DISTRICTS,
		roads: [], nodes: [], edges: [], blocks: [], walkways: [], buildings: [], containers: [],
		features: [], platforms: [], landmarks: [], bridges: [], pois: [], parking: [],
		props: { streetlights: [], signals: [], palms: [], trees: [], benches: [], bins: [], hydrants: [], busStops: [], bushes: [] },
		extraColliders: [],
	};
	const W = WORLD;

	// ---------- roads & nodes per land grid ----------
	const grids = {};
	const nodeAt = new Map(); // "x,z" -> node
	function addNode(x, z, land) {
		const k = `${x},${z}`;
		let n = nodeAt.get(k);
		if (!n) {
			n = { id: city.nodes.length, x, z, land, edges: { n: -1, s: -1, e: -1, w: -1 }, wNS: 0, wEW: 0, signal: null, kind: 'end', roadNS: -1, roadEW: -1 };
			city.nodes.push(n);
			nodeAt.set(k, n);
		}
		return n;
	}
	function addRoad(def) {
		def.id = city.roads.length;
		def.width = roadWidth(def.lanes, def.median);
		def.speed = speedLimit(def.lanes, def.kind);
		def.edges = [];
		city.roads.push(def);
		return def;
	}

	function buildGrid(land, aves, streets) {
		const g = { land, aves: [], streets: [], cells: [], X: aves.map((a) => a[0]), Z: streets.map((s) => s[0]) };
		grids[land] = g;
		for (const [x, name, lanes, median] of aves) g.aves.push(addRoad({ axis: 'ns', c: x, name, lanes, median, kind: lanes >= 2 && median > 0 ? 'boulevard' : 'street', land, s0: g.Z[0], s1: g.Z[g.Z.length - 1] }));
		for (const [z, name, lanes, median] of streets) g.streets.push(addRoad({ axis: 'ew', c: z, name, lanes, median, kind: lanes >= 2 && median > 0 ? 'boulevard' : 'street', land, s0: g.X[0], s1: g.X[g.X.length - 1] }));
		// cell -> merge group lookup
		g.cellGroup = (i, j) => {
			for (const m of MERGES) if (m.land === land && i >= m.i0 && i <= m.i1 && j >= m.j0 && j <= m.j1) return m;
			return null;
		};
		return g;
	}
	const gm = buildGrid('mainland', MAIN_AVES, MAIN_STREETS);
	const gk = buildGrid('key', KEY_AVES, KEY_STREETS);

	// Is the avenue segment between streets j and j+1 at avenue index i removed by a merge?
	function aveSegRemoved(g, i, j) {
		// segment lies between cells (i-1, j) and (i, j); removed if both in the same merge group
		const a = g.cellGroup(i - 1, j), b = g.cellGroup(i, j);
		return a && a === b;
	}
	function streetSegRemoved(g, i, j) {
		const a = g.cellGroup(i, j - 1), b = g.cellGroup(i, j);
		return a && a === b;
	}

	function addEdge(road, na, nb, extra = {}) {
		const axis = road.axis;
		const e = {
			id: city.edges.length, road: road.id, a: na.id, b: nb.id, axis, c: road.c,
			s0: axis === 'ns' ? na.z : na.x, s1: axis === 'ns' ? nb.z : nb.x,
			width: road.width, lanes: road.lanes, median: road.median, kind: road.kind, speed: road.speed, name: road.name,
			bridge: null, ...extra,
		};
		e.length = e.s1 - e.s0;
		city.edges.push(e);
		road.edges.push(e.id);
		if (axis === 'ns') { na.edges.s = e.id; nb.edges.n = e.id; } else { na.edges.e = e.id; nb.edges.w = e.id; }
		return e;
	}

	for (const g of [gm, gk]) {
		// avenues (ns): nodes at each street crossing
		g.aves.forEach((road, i) => {
			for (let j = 0; j < g.Z.length - 1; j++) {
				if (aveSegRemoved(g, i, j)) continue;
				const na = addNode(g.X[i], g.Z[j], g.land), nb = addNode(g.X[i], g.Z[j + 1], g.land);
				addEdge(road, na, nb);
			}
		});
		g.streets.forEach((road, j) => {
			for (let i = 0; i < g.X.length - 1; i++) {
				if (streetSegRemoved(g, i, j)) continue;
				const na = addNode(g.X[i], g.Z[j], g.land), nb = addNode(g.X[i + 1], g.Z[j], g.land);
				addEdge(road, na, nb);
			}
		});
	}
	// bridges
	for (const B of BRIDGES) {
		const road = addRoad({ axis: 'ew', c: B.z, name: B.name, lanes: B.lanes, median: B.median, kind: 'bridge', land: 'bay', s0: gm.X[gm.X.length - 1], s1: gk.X[0] });
		const na = nodeAt.get(`${gm.X[gm.X.length - 1]},${B.z}`), nb = nodeAt.get(`${gk.X[0]},${B.z}`);
		const bridge = { id: city.bridges.length, name: B.name, z: B.z, x0: BRIDGE_X0, x1: BRIDGE_X1, h: B.h, width: road.width, walkW: 2.5, road: road.id };
		bridge.deckWidth = road.width + 2 * bridge.walkW;
		city.bridges.push(bridge);
		const e = addEdge(road, na, nb, { bridge: bridge.id });
		bridge.edge = e.id;
	}

	// node widths, kinds, signals
	for (const n of city.nodes) {
		const eN = n.edges.n >= 0 ? city.edges[n.edges.n] : null, eS = n.edges.s >= 0 ? city.edges[n.edges.s] : null;
		const eE = n.edges.e >= 0 ? city.edges[n.edges.e] : null, eW = n.edges.w >= 0 ? city.edges[n.edges.w] : null;
		const ns = eN || eS, ew = eE || eW;
		n.wNS = ns ? ns.width : 0;
		n.wEW = ew ? ew.width : 0;
		n.roadNS = ns ? ns.road : -1;
		n.roadEW = ew ? ew.road : -1;
		// a node where only one axis exists still needs a box for the turn (corner of a removed segment)
		if (!ns) n.wNS = (ew ? ew.width : 8);
		if (!ew) n.wEW = (ns ? ns.width : 8);
		const deg = (eN ? 1 : 0) + (eS ? 1 : 0) + (eE ? 1 : 0) + (eW ? 1 : 0);
		n.degree = deg;
		n.kind = deg === 4 ? 'cross' : deg === 3 ? 'tee' : deg === 2 ? ((eN || eS) && (eE || eW) ? 'corner' : 'straight') : 'end';
		const major = (ns && ns.lanes >= 2) || (ew && ew.lanes >= 2);
		if (deg === 4 || (deg === 3 && major)) {
			const h = hash2(n.x | 0, n.z | 0);
			n.signal = { cycle: 36, offset: Math.floor(h * 36) };
		}
	}

	// ---------- blocks ----------
	const halfW = (g, axis, idx) => (axis === 'ns' ? g.aves[idx].width : g.streets[idx].width) * 0.5;
	function districtSidewalk(d) {
		return { downtown: 5, heights: 4.5, bayside: 4.5, pintura: 4, mangrove: 3, port: 3.5, coralkey: 4.5 }[d] || 4;
	}
	for (const g of [gm, gk]) {
		const done = new Set();
		for (let i = 0; i < g.X.length - 1; i++) {
			for (let j = 0; j < g.Z.length - 1; j++) {
				const m = g.cellGroup(i, j);
				let i0 = i, i1 = i, j0 = j, j1 = j;
				if (m) {
					const key = MERGES.indexOf(m);
					if (done.has(key)) continue;
					done.add(key);
					i0 = m.i0; i1 = m.i1; j0 = m.j0; j1 = m.j1;
				}
				const minX = g.X[i0] + halfW(g, 'ns', i0), maxX = g.X[i1 + 1] - halfW(g, 'ns', i1 + 1);
				const minZ = g.Z[j0] + halfW(g, 'ew', j0), maxZ = g.Z[j1 + 1] - halfW(g, 'ew', j1 + 1);
				const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
				const dist = districtAt(cx, cz);
				const special = SPECIAL_CELLS.find((s) => s.land === g.land && s.i === i && s.j === j);
				let kind = m ? m.kind : special ? special.kind : 'buildings';
				if (!m && !special && kind === 'buildings' && ['pintura', 'heights', 'bayside'].includes(dist.id) && rng.chance(0.05)) kind = 'parking';
				if (!m && !special && dist.id === 'port') kind = rng.chance(0.35) ? 'port' : 'buildings';
				const sw = districtSidewalk(dist.id);
				const block = {
					id: city.blocks.length, land: g.land, i0, i1, j0, j1, minX, maxX, minZ, maxZ, district: dist.id, kind,
					name: m ? m.name : special && special.name ? special.name : null, role: special ? special.role || null : null,
					sidewalk: sw, inner: { minX: minX + sw, maxX: maxX - sw, minZ: minZ + sw, maxZ: maxZ - sw }, buildings: [],
				};
				city.blocks.push(block);
				g.cells[`${i},${j}`] = block.id;
				if (m) for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) g.cells[`${a},${b}`] = block.id;
			}
		}
	}

	// ---------- outer walkways (sidewalks on the outer side of perimeter roads) ----------
	for (const g of [gm, gk]) {
		const x0 = g.X[0], x1 = g.X[g.X.length - 1], z0 = g.Z[0], z1 = g.Z[g.Z.length - 1];
		const wa0 = g.aves[0].width / 2, wa1 = g.aves[g.aves.length - 1].width / 2;
		const ws0 = g.streets[0].width / 2, ws1 = g.streets[g.streets.length - 1].width / 2;
		const ww = 4;
		const eastW = g.land === 'key' ? 6 : 10; // key: beach promenade, mainland: bayfront walk
		// west, east strips run full length incl. corners; north/south strips between them
		city.walkways.push({ id: city.walkways.length, side: 'w', land: g.land, minX: x0 - wa0 - ww, maxX: x0 - wa0, minZ: z0 - ws0 - ww, maxZ: z1 + ws1 + ww });
		city.walkways.push({ id: city.walkways.length, side: 'e', land: g.land, minX: x1 + wa1, maxX: x1 + wa1 + eastW, minZ: z0 - ws0 - ww, maxZ: z1 + ws1 + ww, promenade: true });
		city.walkways.push({ id: city.walkways.length, side: 'n', land: g.land, minX: x0 - wa0, maxX: x1 + wa1, minZ: z0 - ws0 - ww, maxZ: z0 - ws0 });
		city.walkways.push({ id: city.walkways.length, side: 's', land: g.land, minX: x0 - wa0, maxX: x1 + wa1, minZ: z1 + ws1, maxZ: z1 + ws1 + ww });
	}

	// ---------- platforms: bridges & pier ----------
	for (const b of city.bridges) {
		const e = city.edges[b.edge];
		b.heightAt = (x) => (x <= b.x0 || x >= b.x1 ? 0 : b.h * humpProfile((x - b.x0) / (b.x1 - b.x0)));
		b.slopeAt = (x) => (x <= b.x0 || x >= b.x1 ? 0 : b.h * humpSlope((x - b.x0) / (b.x1 - b.x0)) / (b.x1 - b.x0));
		e.heightAt = b.heightAt;
		// railings (segmented so their y-range follows the deck)
		const half = b.deckWidth / 2 + 0.25;
		const seg = 10;
		for (let x = b.x0 - 15; x < b.x1 + 15; x += seg) {
			const xa = x, xb = x + seg;
			const ya = Math.min(b.heightAt(xa), b.heightAt(xb)), yb = Math.max(b.heightAt(xa), b.heightAt(xb));
			for (const s of [-1, 1]) {
				const zc = b.z + s * half;
				city.extraColliders.push({ type: 'box', minX: xa, maxX: xb, minZ: zc - 0.25, maxZ: zc + 0.25, y0: ya - 2, y1: yb + 1.1, kind: 'railing' });
			}
		}
	}
	const pierH = (x) => WORLD.curb + (PIER.deck - WORLD.curb) * smoothstep(PIER.minX, PIER.minX + 35, x);
	city.platforms.push({ id: 0, kind: 'pier', name: 'Coral Key Pier', minX: PIER.minX, maxX: PIER.maxX, minZ: PIER.minZ, maxZ: PIER.maxZ, heightAt: (x) => pierH(x) });
	city.platforms.push({ id: 1, kind: 'pier', name: 'Pier Plaza', minX: PIER.endMinX, maxX: PIER.endMaxX, minZ: PIER.endMinZ, maxZ: PIER.endMaxZ, heightAt: () => PIER.deck });
	// pier railings
	const rail = (minX, maxX, minZ, maxZ) => city.extraColliders.push({ type: 'box', minX, maxX, minZ, maxZ, y0: 0, y1: PIER.deck + 1.1, kind: 'railing' });
	rail(PIER.minX + 30, PIER.maxX, PIER.minZ - 0.3, PIER.minZ);
	rail(PIER.minX + 30, PIER.maxX, PIER.maxZ, PIER.maxZ + 0.3);
	rail(PIER.endMinX, PIER.endMaxX, PIER.endMinZ - 0.3, PIER.endMinZ);
	rail(PIER.endMinX, PIER.endMaxX, PIER.endMaxZ, PIER.endMaxZ + 0.3);
	rail(PIER.endMaxX, PIER.endMaxX + 0.3, PIER.endMinZ, PIER.endMaxZ);
	rail(PIER.endMinX - 0.3, PIER.endMinX, PIER.endMinZ, PIER.minZ);
	rail(PIER.endMinX - 0.3, PIER.endMinX, PIER.maxZ, PIER.endMaxZ);

	// ---------- landmarks ----------
	city.landmarks.push({ id: 'ferris', name: 'Sunwheel', type: 'ferris', x: 1132, z: -200, y: PIER.deck, radius: 22, hubY: PIER.deck + 25, plane: 'yz' });
	city.extraColliders.push({ type: 'box', minX: 1126, maxX: 1138, minZ: -214, maxZ: -186, y0: 0, y1: PIER.deck + 26, kind: 'landmark' });
	city.landmarks.push({ id: 'lighthouse', name: 'Coral Point Light', type: 'lighthouse', x: 820, z: 905, y: naturalHeight(820, 905), radius: 4.5, height: 34 });
	city.extraColliders.push({ type: 'cyl', x: 820, z: 905, r: 5, y0: -5, y1: 40, kind: 'landmark' });
	for (const cx of [-1010, -930, -850]) {
		const lm = { id: `crane${cx}`, name: 'Gantry Crane', type: 'crane', x: cx, z: 975, y: 0, height: 52, span: 26, legW: 18 };
		city.landmarks.push(lm);
		for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
			const lx = cx + sx * lm.legW / 2, lz = 975 + sz * lm.span / 2;
			city.extraColliders.push({ type: 'box', minX: lx - 0.8, maxX: lx + 0.8, minZ: lz - 0.8, maxZ: lz + 0.8, y0: 0, y1: lm.height, kind: 'landmark' });
		}
	}

	// ---------- buildings / lots ----------
	const bRng = new RNG(seed ^ 0x51f15e);
	function addBuilding(block, b) {
		b.id = city.buildings.length;
		b.block = block.id;
		b.district = block.district;
		b.seed = (bRng.next() * 1e9) | 0;
		if (!b.floorH) b.floorH = { glass: 4, office: 4, hospital: 4, police: 4 }[b.style] || 3.4;
		b.floors = Math.max(1, Math.round(b.h / b.floorH));
		city.buildings.push(b);
		block.buildings.push(b.id);
		return b;
	}
	// which side of a rect faces the most important street (n/s/e/w)
	function frontSide(block, rect) {
		const dN = rect.minZ - block.inner.minZ, dS = block.inner.maxZ - rect.maxZ;
		const dW = rect.minX - block.inner.minX, dE = block.inner.maxX - rect.maxX;
		const m = Math.min(dN, dS, dW, dE);
		return m === dN ? 'n' : m === dS ? 's' : m === dW ? 'w' : 'e';
	}
	function boxB(block, r, h, style, color, extra = {}) {
		const b = { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2, w: r.maxX - r.minX, d: r.maxZ - r.minZ, h, style, color, front: frontSide(block, r), roof: 'flat', ...extra };
		return addBuilding(block, b);
	}
	function inset(r, a) { return { minX: r.minX + a, maxX: r.maxX - a, minZ: r.minZ + a, maxZ: r.maxZ - a }; }
	function splitRect(r, axis, t, gap = 0) {
		if (axis === 'x') {
			const x = lerp(r.minX, r.maxX, t);
			return [{ ...r, maxX: x - gap / 2 }, { ...r, minX: x + gap / 2 }];
		}
		const z = lerp(r.minZ, r.maxZ, t);
		return [{ ...r, maxZ: z - gap / 2 }, { ...r, minZ: z + gap / 2 }];
	}
	const rw = (r) => r.maxX - r.minX, rd = (r) => r.maxZ - r.minZ;

	function genDowntown(block, L) {
		const cx = (L.minX + L.maxX) / 2, cz = (L.minZ + L.maxZ) / 2;
		const core = 1 - smoothstep(0, 520, Math.hypot(cx - 80, cz + 160));
		let parts = [L];
		if (Math.max(rw(L), rd(L)) > 70 && bRng.chance(0.7)) parts = splitRect(L, rw(L) > rd(L) ? 'x' : 'z', bRng.range(0.4, 0.6), bRng.chance(0.3) ? 8 : 0);
		for (const P of parts) {
			const style = bRng.chance(0.62) ? 'glass' : 'office';
			const color = bRng.pick(style === 'glass' ? PALETTES.glass : PALETTES.concrete);
			const towerH = 40 + core * bRng.range(40, 170) + bRng.range(0, 30);
			if (bRng.chance(0.55) && rw(P) > 30 && rd(P) > 30) {
				const pod = inset(P, 1);
				const ti = Math.min(rw(P), rd(P)) * bRng.range(0.14, 0.24);
				const T = inset(pod, ti);
				boxB(block, pod, bRng.range(10, 18), style, color, { podiumColor: bRng.pick(PALETTES.concrete), tower: { x: (T.minX + T.maxX) / 2, z: (T.minZ + T.maxZ) / 2, w: rw(T), d: rd(T), h: towerH }, crown: bRng.pick(['flat', 'flat', 'setback', 'spire', 'helipad', 'slant']) });
			} else {
				boxB(block, inset(P, bRng.range(1, 4)), towerH * 0.8, style, color, { crown: bRng.pick(['flat', 'setback', 'helipad', 'slant']) });
			}
		}
	}
	function genMidrise(block, L, tall = 1) {
		let parts = [L];
		const splits = bRng.int(1, 3);
		for (let s = 0; s < splits; s++) {
			const next = [];
			for (const P of parts) {
				const ax = rw(P) > rd(P) ? 'x' : 'z';
				if ((ax === 'x' ? rw(P) : rd(P)) > 46) next.push(...splitRect(P, ax, bRng.range(0.38, 0.62), bRng.chance(0.25) ? 5 : 0));
				else next.push(P);
			}
			parts = next;
		}
		for (const P of parts) {
			const style = bRng.weighted([['condo', 3], ['midrise', 4], ['office', 1], ['deco', 1]]);
			const pal = style === 'deco' ? PALETTES.deco : style === 'office' ? PALETTES.concrete : PALETTES.stucco;
			const h = (style === 'condo' ? bRng.range(24, 70) : bRng.range(14, 42)) * tall;
			boxB(block, inset(P, bRng.range(1, 3)), h, style, bRng.pick(pal), { crown: bRng.pick(['flat', 'flat', 'setback', 'rooftop']) });
		}
	}
	function genPintura(block, L) {
		// back-to-back frontage buildings along the two longer sides, alley in the middle
		const alongX = rw(L) >= rd(L);
		const len = alongX ? rw(L) : rd(L), depthTot = alongX ? rd(L) : rw(L);
		const depth = Math.min(28, depthTot / 2 - 2);
		for (const side of [0, 1]) {
			let s = 0;
			while (s < len - 8) {
				let wFront = bRng.range(12, 28);
				if (len - s - wFront < 10) wFront = len - s;
				const big = bRng.chance(0.14);
				const h = big ? bRng.range(10, 16) : bRng.weighted([[bRng.range(4.5, 7), 3], [bRng.range(7, 11), 3], [bRng.range(11, 17), 1]]);
				const dpt = big ? depth : depth * bRng.range(0.7, 1);
				let r;
				if (alongX) {
					const z0 = side === 0 ? L.minZ : L.maxZ - dpt;
					r = { minX: L.minX + s, maxX: L.minX + s + wFront - 0.4, minZ: z0, maxZ: z0 + dpt };
				} else {
					const x0 = side === 0 ? L.minX : L.maxX - dpt;
					r = { minX: x0, maxX: x0 + dpt, minZ: L.minZ + s, maxZ: L.minZ + s + wFront - 0.4 };
				}
				const style = big ? 'loft' : 'shop';
				boxB(block, r, h, style, bRng.pick(big ? PALETTES.warehouse.concat(PALETTES.shop) : PALETTES.shop), { mural: bRng.chance(0.35), awning: bRng.chance(0.6), neon: bRng.chance(0.45) });
				s += wFront;
			}
		}
	}
	function genSuburb(block, L) {
		const alongX = rw(L) >= rd(L);
		const len = alongX ? rw(L) : rd(L), depthTot = alongX ? rd(L) : rw(L);
		const lotDepth = depthTot / 2;
		for (const side of [0, 1]) {
			let s = 0;
			while (s < len - 14) {
				let lotW = bRng.range(20, 26);
				if (len - s - lotW < 16) lotW = len - s;
				const hw = Math.min(lotW - 7, bRng.range(10, 14)), hd = Math.min(lotDepth - 12, bRng.range(11, 15));
				const setback = bRng.range(5.5, 7.5);
				const twoStory = bRng.chance(0.35);
				const h = twoStory ? 6.6 : 3.6;
				const offs = bRng.range(1.5, lotW - hw - 5.5); // leave room for the driveway on one side
				let r, drive, pool, yard, dYaw;
				if (alongX) {
					const front = side === 0 ? L.minZ : L.maxZ; // block edge facing the street
					const dir = side === 0 ? 1 : -1;            // inward
					const x0 = L.minX + s + offs;
					const zf = front + dir * setback;
					r = { minX: x0, maxX: x0 + hw, minZ: Math.min(zf, zf + dir * hd), maxZ: Math.max(zf, zf + dir * hd) };
					const dx = x0 + hw + 2.4;
					drive = { x: dx, z: front + dir * (setback * 0.55) };
					dYaw = side === 0 ? 0 : Math.PI;
					const pz = zf + dir * (hd + 2.5);
					pool = { minX: x0 + 1, maxX: x0 + Math.min(hw - 1, 9), minZ: Math.min(pz, pz + dir * 4.5), maxZ: Math.max(pz, pz + dir * 4.5) };
					yard = { minX: L.minX + s, maxX: L.minX + s + lotW, minZ: side === 0 ? L.minZ : L.maxZ - lotDepth, maxZ: side === 0 ? L.minZ + lotDepth : L.maxZ };
				} else {
					const front = side === 0 ? L.minX : L.maxX;
					const dir = side === 0 ? 1 : -1;
					const z0 = L.minZ + s + offs;
					const xf = front + dir * setback;
					r = { minX: Math.min(xf, xf + dir * hd), maxX: Math.max(xf, xf + dir * hd), minZ: z0, maxZ: z0 + hw };
					drive = { x: front + dir * (setback * 0.55), z: z0 + hw + 2.4 };
					dYaw = side === 0 ? Math.PI / 2 : -Math.PI / 2;
					const px = xf + dir * (hd + 2.5);
					pool = { minX: Math.min(px, px + dir * 4.5), maxX: Math.max(px, px + dir * 4.5), minZ: z0 + 1, maxZ: z0 + Math.min(hw - 1, 9) };
					yard = { minZ: L.minZ + s, maxZ: L.minZ + s + lotW, minX: side === 0 ? L.minX : L.maxX - lotDepth, maxX: side === 0 ? L.minX + lotDepth : L.maxX };
				}
				const house = boxB(block, r, h, 'house', bRng.pick(PALETTES.house), { roof: bRng.pick(['hip', 'hip', 'gable', 'flat']), roofColor: bRng.pick(['#b4553a', '#8d8a85', '#c46a43', '#5f6b73', '#d9d4c8']), twoStory });
				city.features.push({ type: 'yard', block: block.id, building: house.id, ...yard });
				city.features.push({ type: 'driveway', block: block.id, building: house.id, x: drive.x, z: drive.z, yaw: dYaw, w: 3.2, l: setback * 1.1 });
				city.parking.push({ x: drive.x, z: drive.z, yaw: dYaw, kind: 'driveway', chance: 0.55 });
				if (bRng.chance(0.42)) city.features.push({ type: 'pool', block: block.id, building: house.id, ...pool });
				const pc = bRng.int(0, 2);
				for (let p = 0; p < pc; p++) {
					const px = lerp(yard.minX + 2, yard.maxX - 2, bRng.next()), pz = lerp(yard.minZ + 2, yard.maxZ - 2, bRng.next());
					if (px > r.minX - 2 && px < r.maxX + 2 && pz > r.minZ - 2 && pz < r.maxZ + 2) continue;
					if (Math.hypot(px - drive.x, pz - drive.z) < 4) continue;
					city.props.palms.push({ x: px, z: pz, h: bRng.range(6, 11), lean: bRng.range(0, 0.18), leanDir: bRng.range(0, 6.28), species: bRng.pick(['royal', 'coconut', 'sabal']) });
				}
				s += lotW;
			}
		}
	}
	function genPort(block, L) {
		if (block.kind === 'port') {
			// container yard: rows of stacks
			const alongX = rw(L) >= rd(L);
			const rowsSpacing = 16, stackLen = 12.2, stackW = 2.44;
			const r = inset(L, 3);
			if (alongX) {
				for (let z = r.minZ + 4; z < r.maxZ - stackLen; z += rowsSpacing) {
					for (let x = r.minX; x < r.maxX - 3 * stackW; x += 3 * stackW + 0.6 + (bRng.chance(0.15) ? 8 : 0)) {
						addContainers(x, z, 'z', 3);
					}
				}
			} else {
				for (let x = r.minX + 4; x < r.maxX - stackLen; x += rowsSpacing) {
					for (let z = r.minZ; z < r.maxZ - 3 * stackW; z += 3 * stackW + 0.6 + (bRng.chance(0.15) ? 8 : 0)) {
						addContainers(x, z, 'x', 3);
					}
				}
			}
			city.features.push({ type: 'yardPaving', block: block.id, ...L });
		} else {
			let parts = [L];
			if (Math.max(rw(L), rd(L)) > 80) parts = splitRect(L, rw(L) > rd(L) ? 'x' : 'z', bRng.range(0.4, 0.6), 12);
			for (const P of parts) boxB(block, inset(P, bRng.range(3, 6)), bRng.range(8, 14), 'warehouse', bRng.pick(PALETTES.warehouse), { roof: bRng.chance(0.4) ? 'sawtooth' : 'flat' });
			city.features.push({ type: 'yardPaving', block: block.id, ...L });
		}
	}
	function addContainers(x0, z0, axis, cols) {
		// `cols` stacks side by side; each stack 1..4 high; containers 12.2 x 2.44 x 2.6
		for (let c = 0; c < cols; c++) {
			const levels = bRng.int(1, 4);
			const colors = [];
			for (let l = 0; l < levels; l++) colors.push(bRng.pick(PALETTES.container));
			const w = 2.44, len = 12.2;
			const st = axis === 'z'
				? { x: x0 + c * w + w / 2, z: z0 + len / 2, w, d: len, yaw: 0 }
				: { x: x0 + len / 2, z: z0 + c * w + w / 2, w: len, d: w, yaw: Math.PI / 2 };
			city.containers.push({ id: city.containers.length, ...st, levels, h: levels * 2.6, colors });
		}
	}
	function genKey(block, L) {
		const col = block.i0; // 0: bay side (condos), 1: beach side (deco hotels)
		if (col === 1) {
			// beach hotels fronting Sunrise Dr, smaller buildings on Coral Ave side
			const eastDepth = Math.min(44, rw(L) * 0.58);
			const E = { ...L, minX: L.maxX - eastDepth }, Wr = { ...L, maxX: L.maxX - eastDepth - 4 };
			let z = E.minZ;
			while (z < E.maxZ - 12) {
				let len = bRng.range(26, 44);
				if (E.maxZ - z - len < 18) len = E.maxZ - z;
				const r = { minX: E.minX, maxX: E.maxX - bRng.range(0, 4), minZ: z, maxZ: z + len - 1.5 };
				const tall = bRng.chance(0.2);
				boxB(block, r, tall ? bRng.range(32, 52) : bRng.range(11, 27), 'deco', bRng.pick(PALETTES.deco), { front: 'e', neon: bRng.chance(0.85), fin: bRng.chance(0.6), eyebrows: true, floorH: 3.6 });
				z += len;
			}
			z = Wr.minZ;
			while (z < Wr.maxZ - 12 && rw(Wr) > 12) {
				let len = bRng.range(18, 30);
				if (Wr.maxZ - z - len < 14) len = Wr.maxZ - z;
				boxB(block, { minX: Wr.minX, maxX: Wr.maxX, minZ: z, maxZ: z + len - 2 }, bRng.range(8, 16), bRng.chance(0.5) ? 'deco' : 'midrise', bRng.pick(PALETTES.deco.concat(PALETTES.stucco)), { front: 'w' });
				z += len;
			}
		} else {
			let parts = [L];
			if (rd(L) > 70 && bRng.chance(0.65)) parts = splitRect(L, 'z', bRng.range(0.4, 0.6), 10);
			for (const P of parts) {
				boxB(block, inset(P, bRng.range(2, 5)), bRng.range(45, 125), 'condo', bRng.pick(PALETTES.stucco.concat(['#d8ecf2', '#e7f4f0'])), { front: 'w', balconies: true, crown: bRng.pick(['flat', 'rooftop', 'setback']) });
			}
		}
	}
	function genParking(block, L) {
		city.features.push({ type: 'parkingLot', block: block.id, ...L });
		const alongX = rw(L) >= rd(L);
		const r = inset(L, 3);
		const stallW = 2.7, stallL = 5.5, aisle = 7;
		if (alongX) {
			for (let z = r.minZ; z + 2 * stallL + aisle <= r.maxZ + 0.01; z += 2 * stallL + aisle) {
				for (let x = r.minX + 1.5; x < r.maxX - 1.5; x += stallW) {
					city.parking.push({ x: x + stallW / 2, z: z + stallL / 2, yaw: Math.PI, kind: 'lot', chance: 0.6 });
					city.parking.push({ x: x + stallW / 2, z: z + 2 * stallL + aisle - stallL / 2, yaw: 0, kind: 'lot', chance: 0.6 });
				}
			}
		} else {
			for (let x = r.minX; x + 2 * stallL + aisle <= r.maxX + 0.01; x += 2 * stallL + aisle) {
				for (let z = r.minZ + 1.5; z < r.maxZ - 1.5; z += stallW) {
					city.parking.push({ x: x + stallL / 2, z: z + stallW / 2, yaw: -Math.PI / 2, kind: 'lot', chance: 0.6 });
					city.parking.push({ x: x + 2 * stallL + aisle - stallL / 2, z: z + stallW / 2, yaw: Math.PI / 2, kind: 'lot', chance: 0.6 });
				}
			}
		}
	}
	function genRole(block, L) {
		const role = block.role;
		const cx = (L.minX + L.maxX) / 2, cz = (L.minZ + L.maxZ) / 2;
		const poi = (type, name, b, extra = {}) => {
			// POI on the sidewalk in front of building b
			const sw = block.sidewalk / 2;
			let x = b.x, z = b.z, yaw = 0;
			if (b.front === 'n') { z = block.minZ + sw; yaw = Math.PI; }
			else if (b.front === 's') { z = block.maxZ - sw; yaw = 0; }
			else if (b.front === 'w') { x = block.minX + sw; yaw = -Math.PI / 2; }
			else { x = block.maxX - sw; yaw = Math.PI / 2; }
			city.pois.push({ id: extra.id || type, type, name, x, z, yaw, building: b.id, block: block.id, ...extra });
		};
		if (role === 'meridian') {
			const pod = inset(L, 4);
			const T = { minX: cx - 18, maxX: cx + 18, minZ: cz - 18, maxZ: cz + 18 };
			const b = boxB(block, pod, 18, 'glass', '#6fa3bd', { landmark: 'meridian', name: 'Meridian Tower', podiumColor: '#d7d2c8', tower: { x: cx, z: cz, w: rw(T), d: rd(T), h: 262 }, crown: 'spire', spire: 34 });
			city.landmarks.push({ id: 'meridian', name: 'Meridian Tower', type: 'tower', building: b.id, x: cx, z: cz, height: 296 });
			poi('landmark', 'Meridian Tower', b, { id: 'meridian' });
			return;
		}
		if (role === 'gas') {
			// gas station on the lot corner nearest the busiest road; rest regular
			const g = { minX: L.minX, maxX: Math.min(L.maxX, L.minX + 46), minZ: L.minZ, maxZ: Math.min(L.maxZ, L.minZ + 40) };
			const shop = { minX: g.minX + 2, maxX: g.minX + 16, minZ: g.minZ + 2, maxZ: g.minZ + 12 };
			const b = boxB(block, shop, 4.2, 'gasShop', '#f2f2f2', { name: 'Gas & Go' });
			const can = { minX: g.minX + 20, maxX: g.maxX - 3, minZ: g.minZ + 12, maxZ: g.maxZ - 4 };
			city.features.push({ type: 'gasCanopy', block: block.id, ...can, h: 5.2, pumps: 4 });
			for (const px of [can.minX + 2, can.maxX - 2]) for (const pz of [can.minZ + 2, can.maxZ - 2]) city.extraColliders.push({ type: 'cyl', x: px, z: pz, r: 0.35, y0: 0, y1: 5.2, kind: 'pillar' });
			city.features.push({ type: 'paving', block: block.id, ...g });
			poi('gas', 'Gas & Go', b, { id: `gas${city.pois.filter((p) => p.type === 'gas').length}`, x: (can.minX + can.maxX) / 2, z: (can.minZ + can.maxZ) / 2 });
			// fill the remainder with regular buildings of the district
			const rest = rw(L) - 46 > 20 ? { ...L, minX: L.minX + 50 } : rd(L) - 40 > 20 ? { ...L, minZ: L.minZ + 44 } : null;
			if (rest) fillDistrict(block, rest);
			return;
		}
		const specs = {
			hospital: { h: 38, style: 'hospital', color: '#eef2f4', name: 'St. Brendan Medical Center', type: 'hospital' },
			police: { h: 22, style: 'police', color: '#d9dcdf', name: 'Brava Bay Police HQ', type: 'police' },
			police2: { h: 14, style: 'police', color: '#e2e4e2', name: 'Coral Key Police Station', type: 'police' },
			garage: { h: 9, style: 'garage', color: '#c75b39', name: "Jules' Garage", type: 'garage' },
			sprayshop: { h: 7, style: 'garage', color: '#2bb3a8', name: 'Fresh Coat Auto Spa', type: 'sprayshop' },
			cafe: { h: 8, style: 'shop', color: '#f3b33d', name: 'Café Rosita', type: 'cafe' },
			safehouse: { h: 64, style: 'condo', color: '#f4efe6', name: 'Bayview Residences', type: 'safehouse' },
		}[role];
		if (!specs) { fillDistrict(block, L); return; }
		const small = ['garage', 'sprayshop', 'cafe'].includes(role);
		const r = small ? { minX: L.minX, maxX: Math.min(L.maxX, L.minX + 34), minZ: L.minZ, maxZ: Math.min(L.maxZ, L.minZ + 26) } : inset(L, 3);
		const b = boxB(block, r, specs.h, specs.style, specs.color, { name: specs.name, role, balconies: role === 'safehouse' });
		poi(specs.type, specs.name, b, { id: role });
		if (small) {
			city.features.push({ type: 'paving', block: block.id, minX: r.maxX, maxX: Math.min(L.maxX, r.maxX + 18), minZ: L.minZ, maxZ: r.maxZ });
			const rest = { ...L, minZ: r.maxZ + 3 };
			if (rd(rest) > 18) fillDistrict(block, rest);
		}
	}
	function fillDistrict(block, L) {
		switch (block.district) {
			case 'downtown': genDowntown(block, L); break;
			case 'heights': genMidrise(block, L, 1); break;
			case 'bayside': genMidrise(block, L, (L.maxX > 240 ? 1.4 : 1)); break;
			case 'pintura': genPintura(block, L); break;
			case 'mangrove': genSuburb(block, L); break;
			case 'port': genPort(block, L); break;
			case 'coralkey': genKey(block, L); break;
			default: genMidrise(block, L);
		}
	}
	function genPark(block) {
		const I = block.inner;
		city.features.push({ type: 'park', block: block.id, ...I, name: block.name });
		const pr = new RNG(block.id * 977 + 13);
		const area = rw(I) * rd(I);
		const nPalm = Math.floor(area / 380), nTree = Math.floor(area / 520);
		for (let k = 0; k < nPalm; k++) city.props.palms.push({ x: pr.range(I.minX + 3, I.maxX - 3), z: pr.range(I.minZ + 3, I.maxZ - 3), h: pr.range(7, 15), lean: pr.range(0, 0.25), leanDir: pr.range(0, 6.28), species: pr.pick(['royal', 'coconut', 'coconut', 'sabal']) });
		for (let k = 0; k < nTree; k++) city.props.trees.push({ x: pr.range(I.minX + 5, I.maxX - 5), z: pr.range(I.minZ + 5, I.maxZ - 5), h: pr.range(7, 13), r: pr.range(3.5, 6.5), species: pr.pick(['oak', 'oak', 'seagrape', 'banyan']) });
		// paths: a cross of walkways with benches
		const cx = (I.minX + I.maxX) / 2, cz = (I.minZ + I.maxZ) / 2;
		city.features.push({ type: 'path', block: block.id, minX: I.minX, maxX: I.maxX, minZ: cz - 2, maxZ: cz + 2 });
		city.features.push({ type: 'path', block: block.id, minX: cx - 2, maxX: cx + 2, minZ: I.minZ, maxZ: I.maxZ });
		for (let x = I.minX + 10; x < I.maxX - 10; x += 18) { city.props.benches.push({ x, z: cz - 3, yaw: 0 }); city.props.benches.push({ x: x + 9, z: cz + 3, yaw: Math.PI }); }
		for (let z = I.minZ + 10; z < I.maxZ - 10; z += 18) city.props.benches.push({ x: cx + 3, z, yaw: -Math.PI / 2 });
		city.features.push({ type: 'fountain', block: block.id, x: cx, z: cz, r: Math.min(7, rw(I) / 8) });
		city.extraColliders.push({ type: 'cyl', x: cx, z: cz, r: Math.min(7, rw(I) / 8), y0: 0, y1: 0.9, kind: 'fountain' });
	}

	for (const block of city.blocks) {
		const L = block.inner;
		if (block.kind === 'park') genPark(block);
		else if (block.kind === 'plaza') {
			city.features.push({ type: 'plaza', block: block.id, ...L, name: block.name });
			const cx = (L.minX + L.maxX) / 2, cz = (L.minZ + L.maxZ) / 2;
			city.features.push({ type: 'fountain', block: block.id, x: cx, z: cz, r: 6 });
			city.extraColliders.push({ type: 'cyl', x: cx, z: cz, r: 6, y0: 0, y1: 0.9, kind: 'fountain' });
			for (let a = 0; a < 8; a++) city.props.palms.push({ x: cx + Math.cos(a * Math.PI / 4) * 16, z: cz + Math.sin(a * Math.PI / 4) * 16, h: 11, lean: 0.02, leanDir: 0, species: 'royal' });
		} else if (block.kind === 'parking') genParking(block, L);
		else if (block.role) genRole(block, L);
		else fillDistrict(block, L);
	}

	// ---------- props along roads ----------
	const pRng = new RNG(seed ^ 0xbadc0de);
	const nodeById = city.nodes;
	function blockAtPoint(x, z) {
		for (const g of [gm, gk]) {
			const X = g.X, Z = g.Z;
			if (x < X[0] || x > X[X.length - 1] || z < Z[0] || z > Z[Z.length - 1]) continue;
			let i = 0; while (i < X.length - 2 && x > X[i + 1]) i++;
			let j = 0; while (j < Z.length - 2 && z > Z[j + 1]) j++;
			const id = g.cells[`${i},${j}`];
			if (id === undefined) continue;
			const b = city.blocks[id];
			if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return b;
		}
		return null;
	}
	function walkwayAt(x, z) {
		for (const w of city.walkways) if (x >= w.minX && x <= w.maxX && z >= w.minZ && z <= w.maxZ) return w;
		return null;
	}
	function onSidewalk(x, z) {
		const b = blockAtPoint(x, z);
		if (b) {
			const I = b.inner;
			return !(x > I.minX && x < I.maxX && z > I.minZ && z < I.maxZ);
		}
		return !!walkwayAt(x, z);
	}
	for (const e of city.edges) {
		if (e.bridge !== null) continue;
		const na = nodeById[e.a], nb = nodeById[e.b];
		const trimA = (e.axis === 'ns' ? na.wEW : na.wNS) / 2 + 9, trimB = (e.axis === 'ns' ? nb.wEW : nb.wNS) / 2 + 9;
		const s0 = e.s0 + trimA, s1 = e.s1 - trimB;
		if (s1 <= s0) continue;
		const dist = districtAt(e.axis === 'ns' ? e.c : (e.s0 + e.s1) / 2, e.axis === 'ns' ? (e.s0 + e.s1) / 2 : e.c).id;
		const spacing = dist === 'mangrove' ? 42 : 32;
		for (const side of [-1, 1]) {
			const off = e.width / 2 + 0.7;
			const startOff = side < 0 ? 0 : spacing / 2;
			for (let s = s0 + startOff; s <= s1; s += spacing) {
				const x = e.axis === 'ns' ? e.c + side * off : s, z = e.axis === 'ns' ? s : e.c + side * off;
				if (!onSidewalk(x, z)) continue;
				// light faces the road
				const yaw = e.axis === 'ns' ? (side < 0 ? Math.PI / 2 : -Math.PI / 2) : (side < 0 ? 0 : Math.PI);
				city.props.streetlights.push({ x, z, yaw, h: e.lanes >= 2 ? 10 : 8.5, arm: e.lanes >= 2 ? 3.2 : 2.2, double: e.median > 0 && false });
			}
			// sidewalk trees/palms between lights (downtown / key / bayside / pintura)
			const treeDist = { downtown: 0.9, coralkey: 1, bayside: 0.8, heights: 0.6, pintura: 0.5, mangrove: 0.25, port: 0 }[dist] || 0;
			if (treeDist > 0) {
				for (let s = s0 + startOff + spacing / 2; s <= s1; s += spacing) {
					if (!pRng.chance(treeDist)) continue;
					const off2 = e.width / 2 + 1.1;
					const x = e.axis === 'ns' ? e.c + side * off2 : s, z = e.axis === 'ns' ? s : e.c + side * off2;
					if (!onSidewalk(x, z)) continue;
					if (dist === 'pintura' || dist === 'heights') city.props.trees.push({ x, z, h: pRng.range(6, 9), r: pRng.range(2.5, 3.6), species: pRng.pick(['oak', 'seagrape']), pit: true });
					else city.props.palms.push({ x, z, h: pRng.range(8, 14), lean: pRng.range(0, 0.06), leanDir: pRng.range(0, 6.28), species: dist === 'coralkey' ? pRng.pick(['coconut', 'royal']) : 'royal', pit: true });
				}
			}
		}
		// median palms
		if (e.median > 0) {
			for (let s = s0 - 2; s <= s1 + 2; s += 14) {
				const x = e.axis === 'ns' ? e.c : s, z = e.axis === 'ns' ? s : e.c;
				city.props.palms.push({ x, z, h: pRng.range(9, 13), lean: pRng.range(0, 0.04), leanDir: pRng.range(0, 6.28), species: 'royal', median: true });
			}
		}
		// bus stops on multi-lane roads
		if (e.lanes >= 2 && e.length > 80 && pRng.chance(0.35)) {
			const side = pRng.chance(0.5) ? -1 : 1;
			const s = (s0 + s1) / 2;
			const off = e.width / 2 + 2.2;
			const x = e.axis === 'ns' ? e.c + side * off : s, z = e.axis === 'ns' ? s : e.c + side * off;
			if (onSidewalk(x, z)) {
				const yaw = e.axis === 'ns' ? (side < 0 ? Math.PI / 2 : -Math.PI / 2) : (side < 0 ? 0 : Math.PI);
				city.props.busStops.push({ x, z, yaw, w: 4.2, d: 1.6, h: 2.6 });
			}
		}
	}
	// bridge lights
	for (const b of city.bridges) {
		for (let x = b.x0; x <= b.x1; x += 30) {
			for (const s of [-1, 1]) city.props.streetlights.push({ x, z: b.z + s * (b.deckWidth / 2 - 0.4), yaw: s < 0 ? 0 : Math.PI, h: 9, arm: 2.6, bridge: b.id, y: b.heightAt(x) });
		}
	}
	// signals, hydrants, bins at intersections
	for (const n of city.nodes) {
		const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
		if (n.signal) {
			// one pole per approach, at the right-hand corner before the crosswalk (right-hand traffic)
			const approaches = [];
			if (n.edges.n >= 0) approaches.push({ from: 'n', axis: 'ns', yaw: 0 });            // traffic heading south (+z) arrives from north
			if (n.edges.s >= 0) approaches.push({ from: 's', axis: 'ns', yaw: Math.PI });
			if (n.edges.w >= 0) approaches.push({ from: 'w', axis: 'ew', yaw: Math.PI / 2 });  // heading east
			if (n.edges.e >= 0) approaches.push({ from: 'e', axis: 'ew', yaw: -Math.PI / 2 });
			for (const ap of approaches) {
				// right side of travel direction: right = (-cos yaw, sin yaw)
				const rx = -Math.cos(ap.yaw), rz = Math.sin(ap.yaw);
				const fx = Math.sin(ap.yaw), fz = Math.cos(ap.yaw);
				const halfAlong = (ap.axis === 'ns' ? n.wEW : n.wNS) / 2; // half width of crossing road
				const halfAcross = (ap.axis === 'ns' ? n.wNS : n.wEW) / 2;
				// pole stands on the far-right corner of the approach, i.e. before entering the box
				const x = n.x - fx * (halfAlong + 1.2) + rx * (halfAcross + 1.0);
				const z = n.z - fz * (halfAlong + 1.2) + rz * (halfAcross + 1.0);
				// mast arm extends over the lanes toward the road centre (to the left of travel)
				city.props.signals.push({ x, z, yaw: ap.yaw, node: n.id, axis: ap.axis, arm: halfAcross + 0.5, from: ap.from });
			}
		}
		const hr = hash2(n.x | 0, (n.z | 0) + 7);
		if (hr < 0.5 && n.degree >= 3) {
			const c = corners[Math.floor(hr * 8) % 4];
			const x = n.x + c[0] * (n.wNS / 2 + 1.6), z = n.z + c[1] * (n.wEW / 2 + 3.5);
			if (onSidewalk(x, z)) city.props.hydrants.push({ x, z });
		}
		if (hr > 0.35 && n.degree >= 3) {
			const c = corners[Math.floor(hr * 13) % 4];
			const x = n.x + c[0] * (n.wNS / 2 + 3.4), z = n.z + c[1] * (n.wEW / 2 + 1.5);
			if (onSidewalk(x, z)) city.props.bins.push({ x, z, yaw: 0 });
		}
	}
	// beach & promenade
	{
		const br = new RNG(seed ^ 0xbeac4);
		for (let z = -820; z <= 820; z += 13) {
			if (z > -215 && z < -185) continue; // pier entrance
			const x = 893 + br.range(-0.5, 0.5);
			if (br.chance(0.8)) city.props.palms.push({ x, z: z + br.range(-2, 2), h: br.range(8, 13), lean: br.range(0.05, 0.3), leanDir: Math.PI / 2 + br.range(-0.6, 0.6), species: 'coconut', promenade: true });
			if (br.chance(0.35)) city.props.benches.push({ x: 888.6, z: z + 6, yaw: Math.PI / 2 });
		}
		for (let k = 0; k < 120; k++) {
			const z = br.range(-820, 820), x = br.range(898, 935);
			if (Math.abs(z + 200) < 20) continue;
			city.props.palms.push({ x, z, h: br.range(6, 12), lean: br.range(0.1, 0.45), leanDir: Math.PI / 2 + br.range(-0.8, 0.8), species: 'coconut', beach: true });
		}
		// lifeguard towers & beach features
		for (let z = -700; z <= 700; z += 175) city.features.push({ type: 'lifeguard', x: 948, z: z + br.range(-15, 15), yaw: Math.PI / 2 });
		for (let k = 0; k < 90; k++) {
			const z = br.range(-800, 800), x = br.range(915, 965);
			if (Math.abs(z + 200) < 15) continue;
			city.features.push({ type: 'umbrella', x, z, color: br.pick(['#ff5a5f', '#ffb400', '#00a699', '#ffffff', '#3d7eff', '#ff7ac6']) });
		}
	}
	// natural shoreline palms & bushes (mainland outer land, key south)
	{
		const nr = new RNG(seed ^ 0x5eaf0);
		let tries = 0;
		while (city.props.bushes.length < 700 && tries++ < 20000) {
			const x = nr.range(-1150, 990), z = nr.range(-1000, 1000);
			const d = landDist(x, z);
			if (d < 2 || d > 70) continue;
			if (blockAtPoint(x, z) || walkwayAt(x, z)) continue;
			if (isRoadNear(x, z, 3)) continue;
			if (beachness(x, z) > 0.3 || (z > 860 && x < -250) || seawallness(x, z) > 0.5) continue;
			if (nr.chance(0.25)) city.props.palms.push({ x, z, h: nr.range(6, 12), lean: nr.range(0.05, 0.35), leanDir: nr.range(0, 6.28), species: nr.pick(['coconut', 'sabal']), wild: true });
			else city.props.bushes.push({ x, z, r: nr.range(1.2, 3.2), h: nr.range(1, 2.6), species: d < 12 ? 'mangrove' : nr.pick(['seagrape', 'palmetto', 'hibiscus']) });
		}
	}
	function isRoadNear(x, z, m) {
		for (const g of [gm, gk]) {
			for (let i = 0; i < g.X.length; i++) if (Math.abs(x - g.X[i]) < g.aves[i].width / 2 + m && z > g.Z[0] - 20 && z < g.Z[g.Z.length - 1] + 20) return true;
			for (let j = 0; j < g.Z.length; j++) if (Math.abs(z - g.Z[j]) < g.streets[j].width / 2 + m && x > g.X[0] - 20 && x < g.X[g.X.length - 1] + 20) return true;
		}
		for (const b of city.bridges) if (Math.abs(z - b.z) < b.deckWidth / 2 + m && x > 360 && x < 660) return true;
		return false;
	}

	// remove props that collide with buildings or each other (simple pass)
	const bInside = (x, z, pad) => {
		for (const id of (blockAtPoint(x, z) || { buildings: [] }).buildings) {
			const b = city.buildings[id];
			if (Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad) return true;
		}
		return false;
	};
	city.props.palms = city.props.palms.filter((p) => !bInside(p.x, p.z, 1.2));
	city.props.trees = city.props.trees.filter((p) => !bInside(p.x, p.z, p.r * 0.6));
	for (const k of ['palms', 'trees', 'bushes', 'benches']) {
		city.props[k] = city.props[k].filter((p) => {
			for (const c of city.extraColliders) {
				if (c.type === 'cyl' && Math.hypot(p.x - c.x, p.z - c.z) < c.r + 1.5) return false;
			}
			return true;
		});
	}
	// stable ids
	for (const k of Object.keys(city.props)) city.props[k].forEach((p, i) => { p.id = i; p.type = k; });

	// ---------- POIs (beyond role buildings) ----------
	city.pois.push({ id: 'pier', type: 'landmark', name: 'Coral Key Pier', x: 940, z: -200, yaw: Math.PI / 2 });
	city.pois.push({ id: 'lighthouse', type: 'landmark', name: 'Coral Point Light', x: 820, z: 890, yaw: 0 });
	city.pois.push({ id: 'marina', type: 'marina', name: 'Bayside Marina', x: 385, z: 300, yaw: Math.PI / 2 });
	city.pois.push({ id: 'terminal', type: 'landmark', name: 'Cayo Container Terminal', x: -900, z: 940, yaw: Math.PI });
	city.pois.push({ id: 'beach', type: 'landmark', name: 'Sunrise Beach', x: 930, z: 120, yaw: Math.PI / 2 });

	// ---------- lookups ----------
	city.grids = grids;
	city.blockAtPoint = blockAtPoint;
	city.walkwayAt = walkwayAt;
	city.onSidewalk = onSidewalk;
	city.districtAt = districtAt;
	city.landDist = landDist;
	city.naturalHeight = naturalHeight;
	city.naturalSurface = naturalSurface;
	city.poi = (id) => city.pois.find((p) => p.id === id) || null;
	city.streetNameAt = (x, z) => {
		let best = null, bd = 1e9;
		for (const e of city.edges) {
			const along = e.axis === 'ns' ? z : x, across = e.axis === 'ns' ? x : z;
			if (along < e.s0 - 10 || along > e.s1 + 10) continue;
			const d = Math.abs(across - e.c);
			if (d < bd) { bd = d; best = e; }
		}
		return best && bd < 60 ? best.name : null;
	};

	city.stats = {
		roads: city.roads.length, nodes: city.nodes.length, edges: city.edges.length, blocks: city.blocks.length,
		buildings: city.buildings.length, containers: city.containers.length,
		streetlights: city.props.streetlights.length, palms: city.props.palms.length, trees: city.props.trees.length,
		signals: city.props.signals.length, parking: city.parking.length,
	};
	return city;
}
