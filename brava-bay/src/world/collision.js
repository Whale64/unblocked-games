// Static collision world + ground/surface queries + dynamic entity grid.
// Built from city data (citygen.js). No THREE dependency. See CONTRACT.md for the API.
import { WORLD } from './citygen.js';

const CELL = 16;                 // static collider grid cell (m)
const HALF = WORLD.half;
const NC = Math.ceil((HALF * 2) / CELL);
const RCELL = 32;                // road/edge grid cell
const NRC = Math.ceil((HALF * 2) / RCELL);

const cellIdx = (x, z) => {
	const cx = Math.floor((x + HALF) / CELL), cz = Math.floor((z + HALF) / CELL);
	if (cx < 0 || cz < 0 || cx >= NC || cz >= NC) return -1;
	return cz * NC + cx;
};

/**
 * Collider shapes:
 *  box: { type:'box', minX,maxX,minZ,maxZ,y0,y1, kind, ref, breakable, broken }
 *  cyl: { type:'cyl', x,z,r,y0,y1, kind, ref, breakable, broken }
 * kind: 'building' | 'container' | 'prop' | 'railing' | 'landmark' | 'pillar' | 'fountain' | 'shelter'
 */
export class Collision {
	constructor(city) {
		this.city = city;
		this.colliders = [];
		this.grid = new Map();       // cell index -> collider index array
		this.roadGrid = new Map();   // road cell -> [{edge or bridge walk rect}]
		this._stamp = 1;
		this._stamps = null;
		this._tmpSurf = { y: 0, type: 'road', edge: null, block: null, bridge: null, platform: null };
		this._build();
	}

	// ------------------------------------------------------------------ build
	_add(c) {
		c.id = this.colliders.length;
		if (c.breakable === undefined) c.breakable = false;
		c.broken = false;
		this.colliders.push(c);
		const [minX, maxX, minZ, maxZ] = c.type === 'box' ? [c.minX, c.maxX, c.minZ, c.maxZ] : [c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r];
		const x0 = Math.floor((minX + HALF) / CELL), x1 = Math.floor((maxX + HALF) / CELL);
		const z0 = Math.floor((minZ + HALF) / CELL), z1 = Math.floor((maxZ + HALF) / CELL);
		for (let cz = Math.max(0, z0); cz <= Math.min(NC - 1, z1); cz++) {
			for (let cx = Math.max(0, x0); cx <= Math.min(NC - 1, x1); cx++) {
				const k = cz * NC + cx;
				let list = this.grid.get(k);
				if (!list) { list = []; this.grid.set(k, list); }
				list.push(c.id);
			}
		}
		return c;
	}

	_build() {
		const city = this.city;
		const C = WORLD.curb;
		for (const b of city.buildings) {
			b.colliders = [];
			b.colliders.push(this._add({ type: 'box', minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, y0: -1, y1: C + b.h + (b.roof && b.roof !== 'flat' && b.style === 'house' ? 1.2 : 0), kind: 'building', ref: b }).id);
			if (b.tower) {
				const t = b.tower;
				b.colliders.push(this._add({ type: 'box', minX: t.x - t.w / 2, maxX: t.x + t.w / 2, minZ: t.z - t.d / 2, maxZ: t.z + t.d / 2, y0: C + b.h - 0.5, y1: C + t.h, kind: 'building', ref: b }).id);
			}
		}
		for (const s of city.containers) {
			this._add({ type: 'box', minX: s.x - s.w / 2, maxX: s.x + s.w / 2, minZ: s.z - s.d / 2, maxZ: s.z + s.d / 2, y0: -1, y1: C + s.h, kind: 'container', ref: s });
		}
		const P = city.props;
		const cyl = (p, r, h, breakable, kind = 'prop') => {
			const y = p.y !== undefined ? p.y : C;
			p.collider = this._add({ type: 'cyl', x: p.x, z: p.z, r, y0: y - 0.5, y1: y + h, kind, ref: p, breakable }).id;
		};
		for (const p of P.streetlights) cyl(p, 0.18, p.h, true);
		for (const p of P.signals) cyl(p, 0.26, 7, false);
		for (const p of P.palms) cyl(p, 0.32, p.h, false);
		for (const p of P.trees) cyl(p, 0.45, p.h, false);
		for (const p of P.bins) cyl(p, 0.35, 1.05, true);
		for (const p of P.hydrants) cyl(p, 0.22, 0.8, true);
		for (const p of P.benches) {
			const rot = Math.abs(Math.sin(p.yaw)) > 0.5;
			const hw = rot ? 0.32 : 0.95, hd = rot ? 0.95 : 0.32;
			p.collider = this._add({ type: 'box', minX: p.x - hw, maxX: p.x + hw, minZ: p.z - hd, maxZ: p.z + hd, y0: 0, y1: C + 0.9, kind: 'prop', ref: p, breakable: true }).id;
		}
		for (const p of P.busStops) {
			const rot = Math.abs(Math.sin(p.yaw)) > 0.5;
			const hw = (rot ? p.d : p.w) / 2, hd = (rot ? p.w : p.d) / 2;
			p.collider = this._add({ type: 'box', minX: p.x - hw, maxX: p.x + hw, minZ: p.z - hd, maxZ: p.z + hd, y0: 0, y1: C + p.h, kind: 'shelter', ref: p, breakable: false }).id;
		}
		for (const f of city.features) {
			if (f.type === 'lifeguard') this._add({ type: 'box', minX: f.x - 1.6, maxX: f.x + 1.6, minZ: f.z - 1.6, maxZ: f.z + 1.6, y0: -1, y1: 4.5, kind: 'prop', ref: f });
		}
		for (const c of city.extraColliders) this._add({ ...c });

		// road grid: edges (rect incl. node boxes at ends) + bridge walkways
		const addR = (minX, maxX, minZ, maxZ, item) => {
			const x0 = Math.floor((minX + HALF) / RCELL), x1 = Math.floor((maxX + HALF) / RCELL);
			const z0 = Math.floor((minZ + HALF) / RCELL), z1 = Math.floor((maxZ + HALF) / RCELL);
			for (let cz = Math.max(0, z0); cz <= Math.min(NRC - 1, z1); cz++) for (let cx = Math.max(0, x0); cx <= Math.min(NRC - 1, x1); cx++) {
				const k = cz * NRC + cx;
				let l = this.roadGrid.get(k);
				if (!l) { l = []; this.roadGrid.set(k, l); }
				l.push(item);
			}
		};
		for (const e of city.edges) {
			const na = city.nodes[e.a], nb = city.nodes[e.b];
			let r;
			if (e.axis === 'ns') r = { minX: e.c - e.width / 2, maxX: e.c + e.width / 2, minZ: e.s0 - na.wEW / 2, maxZ: e.s1 + nb.wEW / 2 };
			else r = { minX: e.s0 - na.wNS / 2, maxX: e.s1 + nb.wNS / 2, minZ: e.c - e.width / 2, maxZ: e.c + e.width / 2 };
			e.rect = r;
			addR(r.minX, r.maxX, r.minZ, r.maxZ, { kind: 'edge', e, ...r });
		}
		for (const b of city.bridges) {
			const hw = b.width / 2;
			for (const s of [-1, 1]) {
				const r = s < 0 ? { minX: b.x0, maxX: b.x1, minZ: b.z - b.deckWidth / 2, maxZ: b.z - hw } : { minX: b.x0, maxX: b.x1, minZ: b.z + hw, maxZ: b.z + b.deckWidth / 2 };
				addR(r.minX, r.maxX, r.minZ, r.maxZ, { kind: 'bridgeWalk', b, ...r });
			}
		}
		this._stamps = new Uint32Array(this.colliders.length);
	}

	// ------------------------------------------------------------------ ground & surfaces
	/**
	 * Walk/drive surface under (x,z). yRef: the querying object's current height; elevated surfaces
	 * (bridge decks, pier) more than 2.5 m above yRef are ignored (so you can be under a bridge).
	 * Returns a shared object { y, type, edge, block, bridge, platform } — copy it if you need to keep it.
	 * type: 'road' | 'bridge' | 'sidewalk' | 'lot' | 'park' | 'pier' | 'sand' | 'grass' | 'concrete' | 'water'
	 * For 'water', y is the SEABED height (use WORLD.waterY for the surface).
	 */
	surfaceAt(x, z, yRef = 1e9, out = this._tmpSurf) {
		out.edge = null; out.block = null; out.bridge = null; out.platform = null;
		const city = this.city;
		const cx = Math.floor((x + HALF) / RCELL), cz = Math.floor((z + HALF) / RCELL);
		if (cx >= 0 && cz >= 0 && cx < NRC && cz < NRC) {
			const list = this.roadGrid.get(cz * NRC + cx);
			if (list) {
				for (let i = 0; i < list.length; i++) {
					const it = list[i];
					if (x < it.minX || x > it.maxX || z < it.minZ || z > it.maxZ) continue;
					if (it.kind === 'edge') {
						const e = it.e;
						if (e.bridge !== null) {
							const b = city.bridges[e.bridge];
							const y = b.heightAt(x);
							if (y > 0.05 && yRef < y - 2.5) continue; // below the deck
							out.y = y; out.type = y > 0.05 ? 'bridge' : 'road'; out.edge = e; out.bridge = b;
							return out;
						}
						out.y = 0; out.type = 'road'; out.edge = e;
						return out;
					} else {
						const b = it.b;
						const y = b.heightAt(x) + WORLD.curb;
						if (yRef < y - 2.5) continue;
						out.y = y; out.type = 'sidewalk'; out.bridge = b;
						return out;
					}
				}
			}
		}
		const blk = city.blockAtPoint(x, z);
		if (blk) {
			out.block = blk;
			out.y = WORLD.curb;
			const I = blk.inner;
			if (x > I.minX && x < I.maxX && z > I.minZ && z < I.maxZ) out.type = blk.kind === 'park' ? 'park' : 'lot';
			else out.type = 'sidewalk';
			return out;
		}
		const wk = city.walkwayAt(x, z);
		if (wk) { out.y = WORLD.curb; out.type = 'sidewalk'; return out; }
		for (const p of city.platforms) {
			if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) {
				const y = p.heightAt(x, z);
				if (yRef >= y - 2.5) { out.y = y; out.type = 'pier'; out.platform = p; return out; }
			}
		}
		const y = city.naturalHeight(x, z);
		out.y = y;
		out.type = city.naturalSurface(x, z, y);
		return out;
	}

	/** Solid ground height (seabed under water). */
	groundHeight(x, z, yRef = 1e9) { return this.surfaceAt(x, z, yRef).y; }

	/** Water depth at (x,z) (0 on land). */
	waterDepth(x, z, yRef = 1e9) {
		const y = this.surfaceAt(x, z, yRef).y;
		return Math.max(0, WORLD.waterY - y);
	}
	isWater(x, z, yRef = 1e9) { return this.waterDepth(x, z, yRef) > 0.05; }

	// ------------------------------------------------------------------ collider queries
	_nextStamp() {
		this._stamp++;
		if (this._stamp > 0xfffffff0) { this._stamps.fill(0); this._stamp = 1; }
		return this._stamp;
	}

	/** Collect collider indices overlapping the XZ rect into `out` (deduplicated). */
	queryRect(minX, minZ, maxX, maxZ, out = []) {
		out.length = 0;
		const st = this._nextStamp();
		const x0 = Math.max(0, Math.floor((minX + HALF) / CELL)), x1 = Math.min(NC - 1, Math.floor((maxX + HALF) / CELL));
		const z0 = Math.max(0, Math.floor((minZ + HALF) / CELL)), z1 = Math.min(NC - 1, Math.floor((maxZ + HALF) / CELL));
		for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
			const list = this.grid.get(cz * NC + cx);
			if (!list) continue;
			for (let i = 0; i < list.length; i++) {
				const id = list[i];
				if (this._stamps[id] === st) continue;
				this._stamps[id] = st;
				out.push(id);
			}
		}
		return out;
	}

	/**
	 * Push a vertical capsule/circle (characters) out of static colliders.
	 * y0..y1: vertical extent of the body (use feet + 0.35 for y0 so curbs/steps are ignored).
	 * Returns shared { x, z, hit, nx, nz, collider }.
	 */
	resolveCircle(x, z, r, y0, y1) {
		const res = this._circleRes || (this._circleRes = { x: 0, z: 0, hit: false, nx: 0, nz: 0, collider: null });
		res.hit = false; res.nx = 0; res.nz = 0; res.collider = null;
		const ids = this._ids || (this._ids = []);
		for (let iter = 0; iter < 3; iter++) {
			this.queryRect(x - r, z - r, x + r, z + r, ids);
			let moved = false;
			for (const id of ids) {
				const c = this.colliders[id];
				if (c.broken || c.y1 <= y0 || c.y0 >= y1) continue;
				if (c.type === 'box') {
					const px = Math.max(c.minX, Math.min(x, c.maxX)), pz = Math.max(c.minZ, Math.min(z, c.maxZ));
					let dx = x - px, dz = z - pz;
					const d2 = dx * dx + dz * dz;
					if (d2 >= r * r) continue;
					let nx, nz, pen;
					if (d2 > 1e-10) {
						const d = Math.sqrt(d2);
						nx = dx / d; nz = dz / d; pen = r - d;
					} else {
						// centre inside: push out along the shallowest side
						const l = x - c.minX, rr = c.maxX - x, t = z - c.minZ, b = c.maxZ - z;
						const m = Math.min(l, rr, t, b);
						if (m === l) { nx = -1; nz = 0; pen = l + r; } else if (m === rr) { nx = 1; nz = 0; pen = rr + r; } else if (m === t) { nx = 0; nz = -1; pen = t + r; } else { nx = 0; nz = 1; pen = b + r; }
					}
					x += nx * pen; z += nz * pen;
					res.hit = true; res.nx = nx; res.nz = nz; res.collider = c; moved = true;
				} else {
					const dx = x - c.x, dz = z - c.z;
					const rr = r + c.r;
					const d2 = dx * dx + dz * dz;
					if (d2 >= rr * rr) continue;
					const d = Math.sqrt(d2) || 1e-6;
					const nx = d2 > 1e-12 ? dx / d : 1, nz = d2 > 1e-12 ? dz / d : 0;
					const pen = rr - d;
					x += nx * pen; z += nz * pen;
					res.hit = true; res.nx = nx; res.nz = nz; res.collider = c; moved = true;
				}
			}
			if (!moved) break;
		}
		res.x = x; res.z = z;
		return res;
	}

	/**
	 * Oriented box (vehicles) vs static colliders. yaw: heading (forward = (sin yaw, cos yaw)).
	 * hw: half width (along right), hl: half length (along forward). y0..y1 vertical extent.
	 * Pushes contacts { nx, nz, depth, px, pz, collider } into `contacts` (cleared first). Normal points
	 * from the obstacle toward the vehicle (direction the vehicle must move to separate).
	 */
	collideOBB(cx, cz, yaw, hw, hl, y0, y1, contacts) {
		contacts.length = 0;
		const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
		const ex = Math.abs(fx) * hl + Math.abs(rx) * hw, ez = Math.abs(fz) * hl + Math.abs(rz) * hw;
		const ids = this._obbIds || (this._obbIds = []);
		this.queryRect(cx - ex, cz - ez, cx + ex, cz + ez, ids);
		const corners = this._corners || (this._corners = new Float64Array(8));
		for (let i = 0; i < 4; i++) {
			const sf = i < 2 ? 1 : -1, sr = i === 0 || i === 3 ? 1 : -1;
			corners[i * 2] = cx + fx * hl * sf + rx * hw * sr;
			corners[i * 2 + 1] = cz + fz * hl * sf + rz * hw * sr;
		}
		for (const id of ids) {
			const c = this.colliders[id];
			if (c.broken || c.y1 <= y0 || c.y0 >= y1) continue;
			if (c.type === 'box') {
				const ct = this._obbBox(cx, cz, fx, fz, rx, rz, hw, hl, c, corners);
				if (ct) { ct.collider = c; contacts.push(ct); }
			} else {
				// circle vs OBB: closest point in OBB local space
				const dx = c.x - cx, dz = c.z - cz;
				const lf = dx * fx + dz * fz, lr = dx * rx + dz * rz;
				const qf = Math.max(-hl, Math.min(hl, lf)), qr = Math.max(-hw, Math.min(hw, lr));
				const px = cx + fx * qf + rx * qr, pz = cz + fz * qf + rz * qr;
				let nx = px - c.x, nz = pz - c.z;
				let d = Math.hypot(nx, nz);
				if (d >= c.r) continue;
				let depth;
				if (d < 1e-6 || (Math.abs(lf) < hl && Math.abs(lr) < hw)) {
					// centre inside the box: push along the smallest local axis
					const pfx = hl - Math.abs(lf), prx = hw - Math.abs(lr);
					if (pfx < prx) { const s = lf > 0 ? -1 : 1; nx = fx * s; nz = fz * s; depth = pfx + c.r; } else { const s = lr > 0 ? -1 : 1; nx = rx * s; nz = rz * s; depth = prx + c.r; }
				} else { nx /= d; nz /= d; depth = c.r - d; }
				contacts.push({ nx, nz, depth, px: c.x + nx * Math.min(c.r, d), pz: c.z + nz * Math.min(c.r, d), collider: c });
			}
		}
		return contacts;
	}

	_obbBox(cx, cz, fx, fz, rx, rz, hw, hl, b, corners) {
		const bcx = (b.minX + b.maxX) / 2, bcz = (b.minZ + b.maxZ) / 2;
		const bhx = (b.maxX - b.minX) / 2, bhz = (b.maxZ - b.minZ) / 2;
		const dx = cx - bcx, dz = cz - bcz;
		let best = 1e9, nx = 0, nz = 0, axisOwner = 0;
		// axis X
		{
			const rA = Math.abs(fx) * hl + Math.abs(rx) * hw;
			const o = rA + bhx - Math.abs(dx);
			if (o <= 0) return null;
			if (o < best) { best = o; nx = dx >= 0 ? 1 : -1; nz = 0; axisOwner = 0; }
		}
		{
			const rA = Math.abs(fz) * hl + Math.abs(rz) * hw;
			const o = rA + bhz - Math.abs(dz);
			if (o <= 0) return null;
			if (o < best) { best = o; nx = 0; nz = dz >= 0 ? 1 : -1; axisOwner = 0; }
		}
		{
			const rB = Math.abs(fx) * bhx + Math.abs(fz) * bhz;
			const dp = dx * fx + dz * fz;
			const o = hl + rB - Math.abs(dp);
			if (o <= 0) return null;
			if (o < best) { best = o; const s = dp >= 0 ? 1 : -1; nx = fx * s; nz = fz * s; axisOwner = 1; }
		}
		{
			const rB = Math.abs(rx) * bhx + Math.abs(rz) * bhz;
			const dp = dx * rx + dz * rz;
			const o = hw + rB - Math.abs(dp);
			if (o <= 0) return null;
			if (o < best) { best = o; const s = dp >= 0 ? 1 : -1; nx = rx * s; nz = rz * s; axisOwner = 1; }
		}
		// contact point
		let px = 0, pz = 0, cnt = 0;
		if (axisOwner === 0) {
			// deepest OBB corners along -n
			let minP = 1e9;
			for (let i = 0; i < 4; i++) { const p = corners[i * 2] * nx + corners[i * 2 + 1] * nz; if (p < minP) minP = p; }
			for (let i = 0; i < 4; i++) {
				const p = corners[i * 2] * nx + corners[i * 2 + 1] * nz;
				if (p < minP + 0.15) { px += corners[i * 2]; pz += corners[i * 2 + 1]; cnt++; }
			}
		} else {
			// deepest box corners along +n (into the OBB)
			const bc = [b.minX, b.minZ, b.maxX, b.minZ, b.maxX, b.maxZ, b.minX, b.maxZ];
			let maxP = -1e9;
			for (let i = 0; i < 4; i++) { const p = bc[i * 2] * nx + bc[i * 2 + 1] * nz; if (p > maxP) maxP = p; }
			for (let i = 0; i < 4; i++) {
				const p = bc[i * 2] * nx + bc[i * 2 + 1] * nz;
				if (p > maxP - 0.15) { px += bc[i * 2]; pz += bc[i * 2 + 1]; cnt++; }
			}
		}
		return { nx, nz, depth: best, px: px / cnt, pz: pz / cnt, collider: null };
	}

	/** Mark a breakable collider as broken (it stops colliding). Emits nothing; callers emit 'propBroken'. */
	breakCollider(c) { c.broken = true; }

	// ------------------------------------------------------------------ raycast
	/**
	 * 3D ray vs static colliders (+ ground unless opts.ground === false, + water surface if opts.water).
	 * dir must be normalised. Returns shared hit object or null:
	 * { dist, x, y, z, nx, ny, nz, collider (or null), type: 'box'|'cyl'|'ground'|'water', surface }
	 */
	raycast(ox, oy, oz, dx, dy, dz, maxDist, opts = {}) {
		const hit = this._hit || (this._hit = { dist: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, collider: null, type: '', surface: '' });
		let best = maxDist, found = false;
		const ignoreKinds = opts.ignoreKinds;
		// --- DDA over the static grid
		let cx = Math.floor((ox + HALF) / CELL), cz = Math.floor((oz + HALF) / CELL);
		const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
		const tDeltaX = Math.abs(dx) > 1e-9 ? CELL / Math.abs(dx) : 1e30;
		const tDeltaZ = Math.abs(dz) > 1e-9 ? CELL / Math.abs(dz) : 1e30;
		const nextX = (cx + (stepX > 0 ? 1 : 0)) * CELL - HALF, nextZ = (cz + (stepZ > 0 ? 1 : 0)) * CELL - HALF;
		let tMaxX = Math.abs(dx) > 1e-9 ? (nextX - ox) / dx : 1e30;
		let tMaxZ = Math.abs(dz) > 1e-9 ? (nextZ - oz) / dz : 1e30;
		const st = this._nextStamp();
		let tEnter = 0;
		for (let guard = 0; guard < 400; guard++) {
			if (tEnter > best) break;
			if (cx >= 0 && cz >= 0 && cx < NC && cz < NC) {
				const list = this.grid.get(cz * NC + cx);
				if (list) {
					for (let i = 0; i < list.length; i++) {
						const id = list[i];
						if (this._stamps[id] === st) continue;
						this._stamps[id] = st;
						const c = this.colliders[id];
						if (c.broken || (ignoreKinds && ignoreKinds.includes(c.kind))) continue;
						if (opts.ignore && opts.ignore(c)) continue;
						if (c.type === 'box') {
							// slab test
							let t0 = 0, t1 = best, nAxis = -1, nSign = 0;
							const slab = (o, d, mn, mx, axis) => {
								if (Math.abs(d) < 1e-12) return o >= mn && o <= mx;
								let ta = (mn - o) / d, tb = (mx - o) / d, s = -1;
								if (ta > tb) { const tt = ta; ta = tb; tb = tt; s = 1; }
								if (ta > t0) { t0 = ta; nAxis = axis; nSign = s; }
								if (tb < t1) t1 = tb;
								return t0 <= t1;
							};
							if (!slab(ox, dx, c.minX, c.maxX, 0)) continue;
							if (!slab(oy, dy, c.y0, c.y1, 1)) continue;
							if (!slab(oz, dz, c.minZ, c.maxZ, 2)) continue;
							if (t0 < best && t0 >= 0 && nAxis >= 0) {
								best = t0; found = true;
								hit.nx = nAxis === 0 ? nSign : 0; hit.ny = nAxis === 1 ? nSign : 0; hit.nz = nAxis === 2 ? nSign : 0;
								hit.collider = c; hit.type = 'box';
							}
						} else {
							// vertical cylinder
							const px = ox - c.x, pz = oz - c.z;
							const a = dx * dx + dz * dz;
							if (a < 1e-12) continue;
							const b = 2 * (px * dx + pz * dz), cc = px * px + pz * pz - c.r * c.r;
							const disc = b * b - 4 * a * cc;
							if (disc < 0) continue;
							const t = (-b - Math.sqrt(disc)) / (2 * a);
							if (t < 0 || t >= best) continue;
							const y = oy + dy * t;
							if (y < c.y0 || y > c.y1) continue;
							best = t; found = true;
							const hx = px + dx * t, hz = pz + dz * t, l = Math.hypot(hx, hz) || 1;
							hit.nx = hx / l; hit.ny = 0; hit.nz = hz / l; hit.collider = c; hit.type = 'cyl';
						}
					}
				}
			}
			if (tMaxX < tMaxZ) { tEnter = tMaxX; tMaxX += tDeltaX; cx += stepX; } else { tEnter = tMaxZ; tMaxZ += tDeltaZ; cz += stepZ; }
			if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) break;
		}
		// --- ground / water
		if (opts.ground !== false) {
			const maxGround = 10;
			if (!(oy > maxGround && dy >= 0)) {
				const step = opts.groundStep || 1.0;
				let prevT = 0;
				let prevAbove = true;
				const tEnd = best;
				for (let t = 0; t <= tEnd + 1e-6; t += step) {
					const tt = Math.min(t, tEnd);
					const x = ox + dx * tt, y = oy + dy * tt, z = oz + dz * tt;
					if (y > maxGround && dy >= 0) break;
					const gy = this.groundHeight(x, z, y + 0.5);
					const wy = opts.water ? Math.max(gy, WORLD.waterY) : gy;
					const above = y >= wy;
					if (!above && prevAbove && t > 0) {
						// bisection refine
						let a = prevT, b2 = tt;
						for (let k = 0; k < 8; k++) {
							const m = (a + b2) / 2;
							const mx = ox + dx * m, my = oy + dy * m, mz = oz + dz * m;
							const g = this.groundHeight(mx, mz, my + 0.5);
							const w = opts.water ? Math.max(g, WORLD.waterY) : g;
							if (my >= w) a = m; else b2 = m;
						}
						if (b2 < best || !found) {
							best = b2; found = true;
							const hx = ox + dx * b2, hz = oz + dz * b2;
							const s = this.surfaceAt(hx, hz, oy + dy * b2 + 0.5);
							const isWater = opts.water && s.y < WORLD.waterY;
							hit.nx = 0; hit.ny = 1; hit.nz = 0; hit.collider = null; hit.type = isWater ? 'water' : 'ground'; hit.surface = isWater ? 'water' : s.type;
						}
						break;
					}
					if (t === 0 && !above) break; // started underground
					prevAbove = above; prevT = tt;
					if (tt >= tEnd) break;
				}
			}
		}
		if (!found) return null;
		hit.dist = best;
		hit.x = ox + dx * best; hit.y = oy + dy * best; hit.z = oz + dz * best;
		if (hit.type === 'box' || hit.type === 'cyl') hit.surface = hit.collider.kind;
		return hit;
	}

	/** True if nothing static blocks the segment a->b. */
	lineOfSight(ax, ay, az, bx, by, bz) {
		const dx = bx - ax, dy = by - ay, dz = bz - az;
		const d = Math.hypot(dx, dy, dz);
		if (d < 1e-6) return true;
		return !this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.05, { ground: true, ignoreKinds: ['prop'] });
	}

	/** True if a circle of radius r at (x,z) overlaps any solid static collider (spawn checks). */
	isBlocked(x, z, r, y0 = 0.3, y1 = 2) {
		const ids = this._blkIds || (this._blkIds = []);
		this.queryRect(x - r, z - r, x + r, z + r, ids);
		for (const id of ids) {
			const c = this.colliders[id];
			if (c.broken || c.y1 <= y0 || c.y0 >= y1) continue;
			if (c.type === 'box') {
				const px = Math.max(c.minX, Math.min(x, c.maxX)), pz = Math.max(c.minZ, Math.min(z, c.maxZ));
				if ((x - px) ** 2 + (z - pz) ** 2 < r * r) return true;
			} else if ((x - c.x) ** 2 + (z - c.z) ** 2 < (r + c.r) ** 2) return true;
		}
		return false;
	}
}

/**
 * Uniform grid for dynamic entities (vehicles, peds, player). Rebuilt every frame by main.js.
 * Entities need { position: {x,z}, radius }.
 */
export class DynamicGrid {
	constructor(cell = 12) {
		this.cell = cell;
		this.map = new Map();
		this.all = [];
	}
	clear() { this.map.clear(); this.all.length = 0; }
	insert(ent) {
		this.all.push(ent);
		const p = ent.position;
		const k = Math.floor((p.x + HALF) / this.cell) * 100003 + Math.floor((p.z + HALF) / this.cell);
		let l = this.map.get(k);
		if (!l) { l = []; this.map.set(k, l); }
		l.push(ent);
	}
	/** Entities whose centre lies within r (+ their radius) of (x,z). filter(ent) optional. */
	query(x, z, r, out = [], filter = null) {
		out.length = 0;
		const c = this.cell;
		const x0 = Math.floor((x - r - 4 + HALF) / c), x1 = Math.floor((x + r + 4 + HALF) / c);
		const z0 = Math.floor((z - r - 4 + HALF) / c), z1 = Math.floor((z + r + 4 + HALF) / c);
		for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
			const l = this.map.get(cx * 100003 + cz);
			if (!l) continue;
			for (const e of l) {
				const dx = e.position.x - x, dz = e.position.z - z;
				const rr = r + (e.radius || 0);
				if (dx * dx + dz * dz <= rr * rr && (!filter || filter(e))) out.push(e);
			}
		}
		return out;
	}
}
