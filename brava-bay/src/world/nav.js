// Navigation: lane geometry, intersection connectors, traffic signals, road A* (GPS), pedestrian walk graph.
// Pure data/maths on top of city (citygen.js). See CONTRACT.md.
import { WORLD } from './citygen.js';
import { angleDiff, pointSegment } from '../core/math.js';

// Signal timing (seconds). NS gets green first, then EW.
export const SIGNAL = { cycle: 36, green: 14, yellow: 3, allRed: 1 };

const ARMS = ['n', 's', 'e', 'w'];
const ARM_AXIS = { n: 'ns', s: 'ns', e: 'ew', w: 'ew' };

export class Nav {
	constructor(city) {
		this.city = city;
		this.nodes = city.nodes;
		this.edges = city.edges;
		this._buildWalk();
	}

	// ------------------------------------------------------------------ lanes
	/** Travel yaw on edge e in direction dir (+1: a->b i.e. increasing s; -1: b->a). */
	travelYaw(e, dir) {
		if (e.axis === 'ns') return dir > 0 ? 0 : Math.PI;
		return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
	}
	/** Lateral offset of lane k (0 = innermost, lanes-1 = curb lane) to the RIGHT of the travel direction. */
	laneOffset(e, k) { return e.median / 2 + (k + 0.5) * WORLD.laneW; }
	/** Distance from a node centre to the stop line on edge e. */
	trim(e, node) {
		const cross = e.axis === 'ns' ? node.wEW : node.wNS;
		return cross / 2 + WORLD.crosswalkW + WORLD.stopGap;
	}
	/** Node at the END of travel (where you arrive) and START. */
	toNode(e, dir) { return this.nodes[dir > 0 ? e.b : e.a]; }
	fromNode(e, dir) { return this.nodes[dir > 0 ? e.a : e.b]; }

	/**
	 * Lane centre line for (edge, dir, lane): from just after the start intersection to the stop line.
	 * Returns { x0, z0, x1, z1, yaw, length }.
	 */
	laneLine(e, dir, k, out = {}) {
		const na = this.nodes[e.a], nb = this.nodes[e.b];
		const off = this.laneOffset(e, k);
		const yaw = this.travelYaw(e, dir);
		const rx = -Math.cos(yaw), rz = Math.sin(yaw);
		const sA = e.s0 + this.trim(e, na), sB = e.s1 - this.trim(e, nb);
		const sStart = dir > 0 ? sA : sB, sEnd = dir > 0 ? sB : sA;
		if (e.axis === 'ns') { out.x0 = e.c + rx * off; out.x1 = out.x0; out.z0 = sStart; out.z1 = sEnd; } else { out.z0 = e.c + rz * off; out.z1 = out.z0; out.x0 = sStart; out.x1 = sEnd; }
		out.yaw = yaw;
		out.length = Math.abs(sEnd - sStart);
		return out;
	}
	/** Point at param t (0..1) along a lane line, with road surface height. */
	lanePoint(e, dir, k, t, out = {}) {
		const L = this.laneLine(e, dir, k, this._ll || (this._ll = {}));
		out.x = L.x0 + (L.x1 - L.x0) * t;
		out.z = L.z0 + (L.z1 - L.z0) * t;
		out.y = e.heightAt ? e.heightAt(out.x) : 0;
		out.yaw = L.yaw;
		return out;
	}
	/** Road surface height at (x) on edge e (bridges arch; else 0). */
	edgeHeight(e, x) { return e.heightAt ? e.heightAt(x) : 0; }

	/** Edges leaving node n other than (e,dir) arriving. Returns [{ edge, dir, turn }] turn: 'left'|'right'|'straight'|'uturn'. */
	exits(nodeId, inEdge, inDir) {
		const n = this.nodes[nodeId];
		const yawIn = inEdge ? this.travelYaw(inEdge, inDir) : 0;
		const out = [];
		for (const arm of ARMS) {
			const eid = n.edges[arm];
			if (eid < 0) continue;
			const e = this.edges[eid];
			const dir = e.a === n.id ? 1 : -1;
			const yawOut = this.travelYaw(e, dir);
			let turn = 'straight';
			if (inEdge) {
				const d = angleDiff(yawIn, yawOut);
				if (Math.abs(d) < 0.3) turn = 'straight';
				else if (Math.abs(Math.abs(d) - Math.PI) < 0.3) turn = 'uturn';
				else turn = d > 0 ? 'left' : 'right';
			}
			if (inEdge && e.id === inEdge.id) turn = 'uturn';
			out.push({ edge: e, dir, turn });
		}
		return out;
	}

	/**
	 * Connector through an intersection from the stop line of (eIn,dirIn,kIn) to the start of (eOut,dirOut,kOut).
	 * Quadratic Bezier { p0, c, p2, length, turn } (straight connectors have c at the midpoint).
	 */
	connector(eIn, dirIn, kIn, eOut, dirOut, kOut) {
		const a = this.laneLine(eIn, dirIn, kIn, {}), b = this.laneLine(eOut, dirOut, kOut, {});
		const p0 = { x: a.x1, z: a.z1 }, p2 = { x: b.x0, z: b.z0 };
		let c;
		const d = angleDiff(a.yaw, b.yaw);
		let turn = 'straight';
		if (Math.abs(d) < 0.3) c = { x: (p0.x + p2.x) / 2, z: (p0.z + p2.z) / 2 };
		else {
			turn = Math.abs(Math.abs(d) - Math.PI) < 0.3 ? 'uturn' : d > 0 ? 'left' : 'right';
			// intersection of the two lane lines (axis aligned): take x from the ns lane, z from the ew lane
			if (eIn.axis === 'ns' && eOut.axis === 'ew') c = { x: p0.x, z: p2.z };
			else if (eIn.axis === 'ew' && eOut.axis === 'ns') c = { x: p2.x, z: p0.z };
			else {
				// U-turn: bulge forward
				const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
				c = { x: (p0.x + p2.x) / 2 + fx * 8, z: (p0.z + p2.z) / 2 + fz * 8 };
			}
		}
		// approximate arc length
		let len = 0, px = p0.x, pz = p0.z;
		for (let i = 1; i <= 8; i++) {
			const t = i / 8, u = 1 - t;
			const x = u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, z = u * u * p0.z + 2 * u * t * c.z + t * t * p2.z;
			len += Math.hypot(x - px, z - pz); px = x; pz = z;
		}
		return { p0, c, p2, length: len, turn };
	}
	/** Evaluate a connector at t: writes {x, z, yaw}. */
	connectorPoint(con, t, out = {}) {
		const u = 1 - t;
		out.x = u * u * con.p0.x + 2 * u * t * con.c.x + t * t * con.p2.x;
		out.z = u * u * con.p0.z + 2 * u * t * con.c.z + t * t * con.p2.z;
		const dx = 2 * u * (con.c.x - con.p0.x) + 2 * t * (con.p2.x - con.c.x);
		const dz = 2 * u * (con.c.z - con.p0.z) + 2 * t * (con.p2.z - con.c.z);
		out.yaw = Math.atan2(dx, dz);
		return out;
	}

	// ------------------------------------------------------------------ signals
	/**
	 * Signal aspect for traffic travelling along `axis` ('ns'|'ew') through node at time t (seconds, game.clock.time).
	 * Unsignalised nodes return 'none'.
	 */
	signalState(node, axis, t) {
		if (!node.signal) return 'none';
		const { cycle, green, yellow, allRed } = SIGNAL;
		const ph = ((t + node.signal.offset) % cycle + cycle) % cycle;
		const half = green + yellow + allRed; // 18
		const local = axis === 'ns' ? ph : (ph - half + cycle) % cycle;
		if (local < green) return 'green';
		if (local < green + yellow) return 'yellow';
		return 'red';
	}
	/** Seconds until the aspect for `axis` changes. */
	signalRemaining(node, axis, t) {
		if (!node.signal) return Infinity;
		const { cycle, green, yellow, allRed } = SIGNAL;
		const ph = ((t + node.signal.offset) % cycle + cycle) % cycle;
		const half = green + yellow + allRed;
		const local = axis === 'ns' ? ph : (ph - half + cycle) % cycle;
		if (local < green) return green - local;
		if (local < green + yellow) return green + yellow - local;
		return cycle - local;
	}
	/** Pedestrian signal for a crosswalk that crosses a road of `crossesAxis`: 'walk' | 'flash' | 'dontwalk' | 'none'. */
	walkSignal(node, crossesAxis, t) {
		if (!node.signal) return 'none';
		const parallel = crossesAxis === 'ns' ? 'ew' : 'ns';
		const st = this.signalState(node, parallel, t);
		if (st !== 'green') return 'dontwalk';
		const rem = this.signalRemaining(node, parallel, t);
		return rem > 5 ? 'walk' : 'flash';
	}

	// ------------------------------------------------------------------ routing (GPS / pursuit)
	/** Nearest point on any road centre line. Returns { edge, s, x, z, dist }. */
	nearestEdge(x, z, filter = null) {
		let best = null, bd = 1e18;
		const tmp = {};
		for (const e of this.edges) {
			if (filter && !filter(e)) continue;
			const ax = e.axis === 'ns' ? e.c : e.s0, az = e.axis === 'ns' ? e.s0 : e.c;
			const bx = e.axis === 'ns' ? e.c : e.s1, bz = e.axis === 'ns' ? e.s1 : e.c;
			pointSegment(x, z, ax, az, bx, bz, tmp);
			if (tmp.d < bd) { bd = tmp.d; best = { edge: e, s: e.axis === 'ns' ? tmp.z : tmp.x, x: tmp.x, z: tmp.z, dist: tmp.d }; }
		}
		return best;
	}
	/**
	 * Shortest road path between two world points. Returns { points: [{x,z}], length, nodes: [nodeIds] } or null.
	 * Points follow road centre lines (first/last points are the projections of the endpoints).
	 */
	findPath(ax, az, bx, bz) {
		const A = this.nearestEdge(ax, az), B = this.nearestEdge(bx, bz);
		if (!A || !B) return null;
		const pt = (e, s) => (e.axis === 'ns' ? { x: e.c, z: s } : { x: s, z: e.c });
		if (A.edge === B.edge) {
			return { points: [{ x: A.x, z: A.z }, { x: B.x, z: B.z }], length: Math.abs(A.s - B.s), nodes: [] };
		}
		const N = this.nodes.length;
		const g = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
		const open = new Set();
		const h = (n) => Math.hypot(this.nodes[n].x - B.x, this.nodes[n].z - B.z);
		const startA = A.edge.a, startB = A.edge.b;
		g[startA] = Math.abs(A.s - A.edge.s0); g[startB] = Math.abs(A.edge.s1 - A.s);
		open.add(startA); open.add(startB);
		const goalCost = (n) => (n === B.edge.a ? Math.abs(B.s - B.edge.s0) : n === B.edge.b ? Math.abs(B.edge.s1 - B.s) : Infinity);
		let bestGoal = -1, bestTotal = Infinity;
		const f = new Float64Array(N).fill(Infinity);
		f[startA] = g[startA] + h(startA); f[startB] = g[startB] + h(startB);
		while (open.size) {
			let cur = -1, cf = Infinity;
			for (const n of open) if (f[n] < cf) { cf = f[n]; cur = n; }
			open.delete(cur);
			if (cf >= bestTotal) break;
			const gc = goalCost(cur);
			if (g[cur] + gc < bestTotal) { bestTotal = g[cur] + gc; bestGoal = cur; }
			const node = this.nodes[cur];
			for (const arm of ARMS) {
				const eid = node.edges[arm];
				if (eid < 0) continue;
				const e = this.edges[eid];
				const nb = e.a === cur ? e.b : e.a;
				// prefer faster roads a little
				const cost = e.length * (e.lanes >= 2 ? 0.85 : 1);
				const ng = g[cur] + cost;
				if (ng < g[nb]) { g[nb] = ng; prev[nb] = cur; f[nb] = ng + h(nb); open.add(nb); }
			}
		}
		if (bestGoal < 0) return null;
		const nodes = [];
		for (let n = bestGoal; n >= 0; n = prev[n]) nodes.unshift(n);
		const points = [{ x: A.x, z: A.z }];
		for (const n of nodes) points.push({ x: this.nodes[n].x, z: this.nodes[n].z });
		const end = pt(B.edge, B.s);
		points.push(end);
		let length = 0;
		for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
		return { points, length, nodes };
	}

	// ------------------------------------------------------------------ pedestrian walk graph
	_buildWalk() {
		const city = this.city;
		const cw = WORLD.crosswalkW;
		const nodes = [], edges = [], adj = [];
		const addNode = (x, z, owner) => { const id = nodes.length; nodes.push({ id, x, z, owner }); adj.push([]); return id; };
		const addEdge = (a, b, extra = {}) => {
			const id = edges.length;
			const e = { id, a, b, length: Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z), crosswalk: false, ...extra };
			edges.push(e);
			adj[a].push({ to: b, edge: id });
			adj[b].push({ to: a, edge: id });
			return e;
		};
		// owner key: 'b<id>' for blocks, 'w<id>' for walkways
		const ownerAt = (x, z) => {
			const b = city.blockAtPoint(x, z);
			if (b) {
				const I = b.inner;
				if (x > I.minX && x < I.maxX && z > I.minZ && z < I.maxZ) return null; // inside the lot, not sidewalk
				return `b${b.id}`;
			}
			const w = city.walkwayAt(x, z);
			return w ? `w${w.id}` : null;
		};
		const ringPts = new Map(); // owner -> [nodeIds]
		const pushRing = (owner, id) => { let l = ringPts.get(owner); if (!l) { l = []; ringPts.set(owner, l); } l.push(id); };
		const crosswalks = [];
		for (const n of this.nodes) {
			for (const arm of ARMS) {
				const eid = n.edges[arm];
				if (eid < 0) continue;
				const e = this.edges[eid];
				if (e.bridge !== null) continue;
				let p1, p2;
				if (arm === 'n' || arm === 's') {
					const zc = n.z + (arm === 'n' ? -1 : 1) * (n.wEW / 2 + cw / 2 + 0.2);
					p1 = { x: n.x - n.wNS / 2 - 1.5, z: zc }; p2 = { x: n.x + n.wNS / 2 + 1.5, z: zc };
				} else {
					const xc = n.x + (arm === 'w' ? -1 : 1) * (n.wNS / 2 + cw / 2 + 0.2);
					p1 = { x: xc, z: n.z - n.wEW / 2 - 1.5 }; p2 = { x: xc, z: n.z + n.wEW / 2 + 1.5 };
				}
				const o1 = ownerAt(p1.x, p1.z), o2 = ownerAt(p2.x, p2.z);
				if (!o1 || !o2) continue;
				const a = addNode(p1.x, p1.z, o1), b = addNode(p2.x, p2.z, o2);
				pushRing(o1, a); pushRing(o2, b);
				crosswalks.push(addEdge(a, b, { crosswalk: true, node: n.id, crossesAxis: ARM_AXIS[arm], arm, signal: !!n.signal }));
			}
		}
		// block rings
		for (const blk of city.blocks) {
			const owner = `b${blk.id}`;
			const h = blk.sidewalk / 2;
			const c = [
				addNode(blk.minX + h, blk.minZ + h, owner), addNode(blk.maxX - h, blk.minZ + h, owner),
				addNode(blk.maxX - h, blk.maxZ - h, owner), addNode(blk.minX + h, blk.maxZ - h, owner),
			];
			for (const id of c) pushRing(owner, id);
			const W = blk.maxX - blk.minX - 2 * h, D = blk.maxZ - blk.minZ - 2 * h;
			const per = (id) => {
				// perimeter parameter clockwise from NW corner
				const p = nodes[id];
				const x = Math.max(blk.minX + h, Math.min(blk.maxX - h, p.x)), z = Math.max(blk.minZ + h, Math.min(blk.maxZ - h, p.z));
				const dN = Math.abs(z - (blk.minZ + h)), dE = Math.abs(x - (blk.maxX - h)), dS = Math.abs(z - (blk.maxZ - h)), dW = Math.abs(x - (blk.minX + h));
				const m = Math.min(dN, dE, dS, dW);
				if (m === dN) return x - (blk.minX + h);
				if (m === dE) return W + (z - (blk.minZ + h));
				if (m === dS) return W + D + ((blk.maxX - h) - x);
				return 2 * W + D + ((blk.maxZ - h) - z);
			};
			const ring = ringPts.get(owner).slice().sort((a, b) => per(a) - per(b));
			for (let i = 0; i < ring.length; i++) addEdge(ring[i], ring[(i + 1) % ring.length]);
		}
		// walkway strips
		for (const w of city.walkways) {
			const owner = `w${w.id}`;
			const alongX = (w.maxX - w.minX) > (w.maxZ - w.minZ);
			const cx = (w.minX + w.maxX) / 2, cz = (w.minZ + w.maxZ) / 2;
			const a = alongX ? addNode(w.minX + 1, cz, owner) : addNode(cx, w.minZ + 1, owner);
			const b = alongX ? addNode(w.maxX - 1, cz, owner) : addNode(cx, w.maxZ - 1, owner);
			pushRing(owner, a); pushRing(owner, b);
			const list = ringPts.get(owner).slice().sort((p, q) => (alongX ? nodes[p].x - nodes[q].x : nodes[p].z - nodes[q].z));
			for (let i = 0; i < list.length - 1; i++) addEdge(list[i], list[i + 1]);
		}
		this.walk = { nodes, edges, adj, crosswalks };
	}

	/** Nearest walk-graph node to (x,z). */
	nearestWalkNode(x, z) {
		let best = -1, bd = 1e18;
		for (const n of this.walk.nodes) {
			const d = (n.x - x) ** 2 + (n.z - z) ** 2;
			if (d < bd) { bd = d; best = n.id; }
		}
		return best;
	}
}

/** GPS route to a target, recomputed as the player moves. Used by HUD (minimap line) and missions. */
export class GPS {
	constructor(game) {
		this.game = game;
		this.target = null;   // { x, z, label, color }
		this.route = [];      // [{x,z}] from player to target
		this.distance = 0;    // metres along route
		this._t = 0;
	}
	setTarget(x, z, opts = {}) {
		this.target = { x, z, label: opts.label || '', color: opts.color || '#ffd34d', source: opts.source || 'mission' };
		this._t = 0; // recompute next update
		this.game.events.emit('gpsChanged', { target: this.target });
	}
	clear(source = null) {
		if (source && this.target && this.target.source !== source) return;
		this.target = null; this.route = []; this.distance = 0;
		this.game.events.emit('gpsChanged', { target: null });
	}
	update(dt) {
		if (!this.target) return;
		this._t -= dt;
		if (this._t > 0) return;
		this._t = 0.75;
		const p = this.game.player && this.game.player.position;
		if (!p) return;
		const path = this.game.nav.findPath(p.x, p.z, this.target.x, this.target.z);
		if (path) {
			this.route = [{ x: p.x, z: p.z }, ...path.points, { x: this.target.x, z: this.target.z }];
			this.distance = path.length + Math.hypot(this.target.x - path.points[path.points.length - 1].x, this.target.z - path.points[path.points.length - 1].z);
		} else {
			this.route = [{ x: p.x, z: p.z }, { x: this.target.x, z: this.target.z }];
			this.distance = Math.hypot(this.target.x - p.x, this.target.z - p.z);
		}
	}
}
