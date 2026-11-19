// Game modes: a scored landing challenge and a timed ring course. Each challenge sets up the flight,
// watches it, and produces a result card with a breakdown and a locally stored personal best.
import * as THREE from 'three';
import { airports, getHeight, fromRunwayLocal } from './world.js';
import { runwayGeom } from './autopilot.js';
import { spawnAircraft, spawnAirborne } from './spawn.js';

const D2R = Math.PI / 180, FT = 0.3048, KT = 1.94384;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrap180 = (a) => ((a % 360) + 540) % 360 - 180;
// 1 when |x| <= full, falling linearly to 0 at |x| = zero
const ramp = (x, full, zero) => clamp((zero - Math.abs(x)) / (zero - full), 0, 1);

function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6D2B79F5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const hashStr = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

// ---------------------------------------------------------------- personal bests
const BEST_KEY = 'skyward-best';
export function loadBests() { try { return JSON.parse(localStorage.getItem(BEST_KEY) || '{}'); } catch { return {}; } }
function saveBest(key, rec, better) {
	const all = loadBests();
	const prev = all[key];
	const isNew = !prev || better(rec, prev);
	if (isNew) { all[key] = { ...rec, date: Date.now() }; try { localStorage.setItem(BEST_KEY, JSON.stringify(all)); } catch { /* storage unavailable */ } }
	return { isNew, prev };
}

export const LANDING_LEVELS = {
	calm: { label: 'Calm', wind: [0, 4], angle: [0, 40], turb: 0.1 },
	crosswind: { label: 'Crosswind', wind: [10, 16], angle: [45, 90], turb: 0.35 },
	storm: { label: 'Gusty storm', wind: [18, 26], angle: [35, 80], turb: 0.85 },
};

export function fmtTime(t) {
	const m = Math.floor(t / 60), s = t - m * 60;
	return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
export function gradeOf(score) { return score >= 900 ? 'S' : score >= 800 ? 'A' : score >= 650 ? 'B' : score >= 500 ? 'C' : 'D'; }

// ================================================================ landing challenge
export class LandingChallenge {
	constructor(cfg, apIndex, level) {
		this.kind = 'landing';
		this.cfg = cfg;
		this.ap = airports[Math.min(apIndex, airports.length - 1)];
		this.levelId = LANDING_LEVELS[level] ? level : 'crosswind';
		this.level = LANDING_LEVELS[this.levelId];
		this.key = `landing:${cfg.id}:${this.ap.id}:${this.levelId}`;
		this.td = null; this.bounces = 0; this.done = false; this.assisted = false; this.offRunway = false;
		this.timeSinceTD = 0;
	}

	// Spawns the aircraft on a slightly-off final approach and returns { throttle, wind, turb }.
	start(fm) {
		const r = rng((Date.now() ^ hashStr(this.key)) >>> 0);
		const cfg = this.cfg, ap = this.ap;
		const res = spawnAircraft(fm, cfg, 'approach', airports.indexOf(ap)) || {};
		// start off the centre line and off the glide path, so the pilot has to fly a correction
		const lat = (r() < 0.5 ? -1 : 1) * (40 + r() * (cfg.category === 'airliner' ? 220 : 140));
		const vert = (r() - 0.4) * 50;
		fm.pos.x += ap.right.x * lat; fm.pos.z += ap.right.z * lat; fm.pos.y += vert;
		const L = this.level;
		const spd = L.wind[0] + r() * (L.wind[1] - L.wind[0]);
		const off = (L.angle[0] + r() * (L.angle[1] - L.angle[0])) * (r() < 0.5 ? -1 : 1);
		this.windFrom = (ap.heading + off + 360) % 360;
		this.windKt = spd;
		this.crossKt = Math.abs(Math.sin(off * D2R) * spd);
		const wd = this.windFrom * D2R;
		return { throttle: res.throttle, wind: new THREE.Vector3(-Math.sin(wd), 0, Math.cos(wd)).multiplyScalar(spd / KT), turb: L.turb * 2.2 };
	}

	intro() {
		return [`Landing challenge · ${this.ap.id} ${String(this.ap.numA).padStart(2, '0')} · wind ${String(Math.round(this.windFrom)).padStart(3, '0')}° / ${Math.round(this.windKt)} kt`,
			'Touch down softly on the centre line at the aiming point (300 m markers)'];
	}

	onEvent(e, game) {
		if (e.type !== 'touchdown' || this.done) return;
		const fm = game.fm, t = fm.tel;
		if (this.td) { this.bounces++; game.hud.toast('Bounce! −100', '#ff9a6a', 1.6); return; }
		const g = runwayGeom(this.ap, -1, fm.pos);
		this.td = {
			fpm: Math.round(-e.vs * 196.85),
			dist: -g.before, // metres past the threshold
			xte: g.xte,
			crab: wrap180(t.heading - g.course),
			bank: t.bank,
			ias: t.ias,
			onRunway: Math.abs(g.xte) < this.ap.width / 2 && -g.before > -5 && -g.before < this.ap.length,
		};
		if (game.autopilot.engaged) this.assisted = true;
	}

	update(dt, game) {
		if (this.done) return null;
		const fm = game.fm, t = fm.tel;
		if (game.autopilot.engaged && t.agl < 500) this.assisted = true;
		if (!this.td) return null;
		this.timeSinceTD += dt;
		const g = runwayGeom(this.ap, -1, fm.pos);
		if (t.onGround && (Math.abs(g.xte) > this.ap.width / 2 + 3 || -g.before > this.ap.length + 5)) this.offRunway = true;
		if ((t.onGround && t.gs < 30) || this.timeSinceTD > 40) return this.finish();
		return null;
	}

	status(game) {
		const t = game.fm.tel;
		const lines = [['LANDING CHALLENGE', '#ffd27a'], [`${this.level.label} · ${String(Math.round(this.windFrom)).padStart(3, '0')}°/${Math.round(this.windKt)} kt (X-wind ${Math.round(this.crossKt)})`, '#e6f0ff']];
		if (this.td) lines.push([`Touchdown ${this.td.fpm} fpm · ${Math.round(this.td.dist)} m · ${this.td.xte.toFixed(1)} m`, '#9fe0ff']);
		else lines.push([`Aim: 300 m past threshold · ${t.agl < 2500 ? Math.round(t.agl) + ' ft' : ''}`, '#9fe0ff']);
		if (this.assisted) lines.push(['Autoland: not scored', '#ffb347']);
		return { lines };
	}

	finish() {
		this.done = true;
		const td = this.td, cfg = this.cfg;
		const aim = 300;
		const rows = [];
		let total = 0;
		const add = (label, value, pts, max) => { pts = Math.round(pts); total += pts; rows.push({ label, value, pts, max }); };
		add('Sink rate', `${td.fpm} fpm`, 300 * ramp(td.fpm, 60, 600), 300);
		add('Touchdown point', td.dist < 0 ? `${Math.round(-td.dist)} m short` : `${Math.round(td.dist)} m (aim ${aim})`, td.onRunway ? 250 * ramp(td.dist - aim, 60, 550) : 0, 250);
		add('Centre line', `${Math.abs(td.xte).toFixed(1)} m ${td.xte > 0 ? 'right' : 'left'}`, 200 * ramp(td.xte, 1, this.ap.width / 2), 200);
		add('Alignment (crab)', `${Math.abs(td.crab).toFixed(1)}°`, 100 * ramp(td.crab, 1, 8), 100);
		add('Speed', `${Math.round(td.ias)} kt (Vref ${cfg.vapp - 5})`, 100 * ramp(td.ias - (cfg.vapp - 5), 5, 20), 100);
		add('Wings level', `${Math.abs(td.bank).toFixed(1)}°`, 50 * ramp(td.bank, 1, 6), 50);
		if (this.bounces) add('Bounces', `${this.bounces}`, -100 * this.bounces, 0);
		if (this.offRunway) add('Runway excursion', 'yes', -200, 0);
		if (!td.onRunway) rows.push({ label: 'Missed the runway', value: '', pts: 0, max: 0 });
		total = Math.max(0, total);
		if (this.assisted) {
			return { title: 'LANDING CHALLENGE', big: '—', sub: 'Autoland is not scored. Hand-fly the final 500 ft to score.', rows, best: null };
		}
		const grade = gradeOf(total);
		const best = saveBest(this.key, { score: total, grade }, (a, b) => a.score > b.score);
		const level = `${cfg.name} · ${this.ap.id} · ${this.level.label}`;
		return {
			title: 'LANDING CHALLENGE', big: grade, score: `${total} / 1000`, sub: level, rows,
			best: best.isNew ? (best.prev ? `New personal best! (was ${best.prev.score})` : 'First score recorded') : `Personal best: ${best.prev.score} (${best.prev.grade})`,
			newBest: best.isNew,
		};
	}

	dispose() {}
}

// ================================================================ ring course
function courseParams(cfg) {
	// gate spacing and turn per gate are sized for roughly a 35-45 deg bank turn at the course speed
	if (cfg.category === 'airliner') return { v: 115, R: 60, spacing: 1700, clear: 180, turn: 18, climb: 0.06, corridor: 900 };
	if (cfg.engine === 'jet') return { v: 140, R: 40, spacing: 1600, clear: 120, turn: 20, climb: 0.1, corridor: 700 };
	return { v: 55, R: 22, spacing: 520, clear: 75, turn: 30, climb: 0.06, corridor: 260 };
}

const ringGeo = {};
export class RingCourse {
	constructor(cfg, apIndex, scene) {
		this.kind = 'rings';
		this.cfg = cfg;
		this.ap = airports[Math.min(apIndex, airports.length - 1)];
		this.scene = scene;
		this.key = `rings:${cfg.id}:${this.ap.id}`;
		this.P = courseParams(cfg);
		this.count = 14;
		this.time = 0; this.next = 0; this.missed = 0; this.done = false; this.started = false;
		this.lastSide = null;
		this.bestRec = loadBests()[this.key];
		this.build();
	}

	// highest ground in a corridor around the leg (the pilot won't fly the straight line exactly)
	groundMax(x0, z0, x1, z1) {
		const L = Math.hypot(x1 - x0, z1 - z0) || 1;
		const nx = -(z1 - z0) / L, nz = (x1 - x0) / L, w = this.P.corridor;
		let h = 0;
		for (let i = 0; i <= 10; i++) {
			const f = i / 10;
			for (const o of [-1, -0.5, 0, 0.5, 1]) h = Math.max(h, getHeight(x0 + (x1 - x0) * f + nx * o * w, z0 + (z1 - z0) * f + nz * o * w));
		}
		return h;
	}

	build() {
		// a seeded course, so each aircraft + airport always gets the same track and times are comparable
		const r = rng(hashStr(this.key));
		const P = this.P, ap = this.ap;
		const s = fromRunwayLocal(ap, -ap.length / 2 - 2600, 0);
		let hd = ap.heading;
		let x = s.x, z = s.z;
		let y = this.groundMax(x, z, x + ap.dir.x * 2000, z + ap.dir.z * 2000) + P.clear + 60;
		this.startPos = new THREE.Vector3(x, y, z);
		this.startHeading = hd;
		this.rings = [];
		let turnDir = r() < 0.5 ? -1 : 1;
		const pts = [{ x, z, floor: y }];
		for (let i = 0; i < this.count; i++) {
			const d = i === 0 ? P.spacing * 1.3 : P.spacing * (0.85 + r() * 0.3);
			// candidate turns: the random S-turn first, then gentler / opposite ones; take the first whose
			// terrain doesn't demand a steep climb, otherwise whichever needs the least
			let cands = [0];
			if (i > 0) {
				if (r() < 0.3) turnDir = -turnDir; // S-turns
				const a = P.turn * (0.35 + r() * 0.65);
				cands = [turnDir * a, turnDir * a * 0.4, -turnDir * a * 0.5, turnDir * P.turn, -turnDir * P.turn];
			}
			let pick = null;
			for (const c of cands) {
				const h2 = (hd + c + 360) % 360;
				const nx = x + Math.sin(h2 * D2R) * d, nz = z - Math.cos(h2 * D2R) * d;
				const floor = Math.max(this.groundMax(x, z, nx, nz) + P.clear, P.clear);
				const cand = { h2, nx, nz, floor };
				if (floor <= y + d * P.climb * 0.8) { pick = cand; break; }
				if (!pick || floor < pick.floor) pick = cand;
			}
			hd = pick.h2;
			let ny = Math.max(y + (r() - 0.45) * d * P.climb * 1.6, pick.floor);
			pts.push({ x: pick.nx, z: pick.nz, y: ny, floor: pick.floor, d });
			x = pick.nx; z = pick.nz; y = ny;
		}
		// enforce a flyable gradient between gates: raise earlier gates (and the start) ahead of high ground,
		// and keep descents to the same gradient
		pts[0].y = this.startPos.y;
		for (let pass = 0; pass < 2; pass++) {
			for (let k = pts.length - 2; k >= 0; k--) pts[k].y = Math.max(pts[k].y, pts[k + 1].y - pts[k + 1].d * P.climb);
			for (let k = 1; k < pts.length; k++) pts[k].y = Math.max(pts[k].y, pts[k - 1].y - pts[k].d * P.climb);
		}
		this.startPos.y = pts[0].y;
		for (let k = 1; k < pts.length; k++) {
			const a = pts[k - 1], b = pts[k];
			const pos = new THREE.Vector3(b.x, b.y, b.z);
			const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
			this.rings.push({ pos, dir, R: P.R, state: 0 });
		}
		// meshes
		const key = P.R;
		if (!ringGeo[key]) ringGeo[key] = new THREE.TorusGeometry(P.R, P.R * 0.075, 10, 56);
		this.group = new THREE.Group();
		for (const ring of this.rings) {
			const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
			const m = new THREE.Mesh(ringGeo[key], mat);
			m.position.copy(ring.pos);
			m.lookAt(ring.pos.clone().add(ring.dir));
			m.frustumCulled = true;
			ring.mesh = m;
			this.group.add(m);
		}
		this.scene.add(this.group);
		this.paint(0);
	}

	start(fm) {
		const res = spawnAirborne(fm, this.cfg, this.startPos, this.startHeading, this.P.v);
		return { throttle: res.throttle, wind: null, turb: null };
	}

	intro() {
		return [`Ring course · ${this.ap.name} · ${this.count} gates`, 'Fly through every ring in order. A missed ring costs +5 s'];
	}

	paint(t) {
		for (let i = 0; i < this.rings.length; i++) {
			const ring = this.rings[i], c = ring.mesh.material.color;
			ring.mesh.visible = i >= this.next || (ring.flash || 0) > 0;
			if (i === this.next) {
				const pulse = 1 + 0.35 * Math.sin(t * 6);
				c.setRGB(1.0, 0.62, 0.12).multiplyScalar(14 * pulse);
				ring.mesh.scale.setScalar(1);
			} else if (i === this.next + 1) c.setRGB(0.2, 0.75, 1.0).multiplyScalar(6);
			else if (i > this.next) c.setRGB(0.25, 0.6, 1.0).multiplyScalar(2.5);
			else if (ring.flash > 0) {
				// just passed (green) or missed (red): expand and fade
				const f = ring.flash;
				(ring.hit ? c.setRGB(0.2, 1.0, 0.4) : c.setRGB(1.0, 0.15, 0.1)).multiplyScalar(14 * f);
				ring.mesh.scale.setScalar(1 + (1 - f) * 0.6);
			}
		}
	}

	onEvent() {}

	update(dt, game) {
		const fm = game.fm;
		for (const r of this.rings) if (r.flash > 0) r.flash = Math.max(0, r.flash - dt * 1.6);
		if (this.done) { this.paint(game.time); return null; }
		if (!this.started) { this.started = true; this.prevPos = fm.pos.clone(); }
		this.time += dt;
		const ring = this.rings[this.next];
		// crossing the ring's plane between this frame and the last
		const rel0 = this.prevPos.clone().sub(ring.pos), rel1 = fm.pos.clone().sub(ring.pos);
		const s0 = rel0.dot(ring.dir), s1 = rel1.dot(ring.dir);
		let result = null;
		if (s0 < 0 && s1 >= 0) {
			const f = s0 / (s0 - s1);
			const hit = rel0.lerp(rel1, f);
			const miss = hit.length();
			ring.missBy = hit.clone();
			if (miss <= ring.R) result = true;
			else if (miss < ring.R * 6) result = false;
		} else if (s1 > ring.R * 4 && rel1.length() > this.P.spacing * 0.6) { ring.missBy = null; result = false; } // flew past it well off to the side
		this.prevPos.copy(fm.pos);
		if (result !== null) {
			ring.hit = result; ring.flash = 1;
			if (result) { game.audio.oneShot('ding'); }
			else {
				this.missed++; game.audio.oneShot('miss');
				game.hud.toast(ring.missBy ? `Missed by ${Math.round(ring.missBy.length() - ring.R)} m · +5 s` : 'Missed ring · +5 s', '#ff8a6a', 1.6);
			}
			this.next++;
			if (this.next >= this.rings.length) {
				game.audio.oneShot('fanfare');
				this.paint(game.time);
				return this.finish();
			}
		}
		this.paint(game.time);
		return null;
	}

	nextRing() { return this.done ? null : this.rings[this.next]; }

	status(game) {
		const total = this.time + this.missed * 5;
		const nr = this.nextRing();
		const lines = [['RING COURSE', '#ffd27a'], [`Gate ${Math.min(this.next + 1, this.count)} / ${this.count} · ${fmtTime(total)}${this.missed ? ` (+${this.missed * 5} s)` : ''}`, '#e6f0ff']];
		if (nr) lines.push([`Next ${Math.round(nr.pos.distanceTo(game.fm.pos))} m · ${Math.round(nr.pos.y / FT)} ft`, '#9fe0ff']);
		const best = this.bestRec;
		if (best) lines.push([`Best ${fmtTime(best.time)}`, 'rgba(255,255,255,0.6)']);
		return { lines, target: nr ? nr.pos : null, marks: this.rings.slice(this.next).map((r, i) => ({ x: r.pos.x, z: r.pos.z, color: i === 0 ? '#ffb02e' : '#4fb8ff' })) };
	}

	finish() {
		this.done = true;
		const total = this.time + this.missed * 5;
		const hits = this.count - this.missed;
		const rows = [
			{ label: 'Flight time', value: fmtTime(this.time) },
			{ label: 'Rings', value: `${hits} / ${this.count}` },
			{ label: 'Penalties', value: this.missed ? `+${this.missed * 5} s` : 'none' },
		];
		const clean = this.missed <= 2;
		const best = clean ? saveBest(this.key, { time: total, missed: this.missed }, (a, b) => a.time < b.time) : { isNew: false, prev: loadBests()[this.key] };
		let bestText;
		if (!clean) bestText = 'Miss no more than 2 rings to set a record';
		else if (best.isNew) bestText = best.prev ? `New personal best! (was ${fmtTime(best.prev.time)})` : 'First time recorded';
		else bestText = `Personal best: ${fmtTime(best.prev.time)}`;
		return { title: 'RING COURSE', big: fmtTime(total), sub: `${this.cfg.name} · ${this.ap.name}`, rows, best: bestText, newBest: best.isNew };
	}

	dispose() {
		if (this.group) { this.scene.remove(this.group); for (const r of this.rings) r.mesh.material.dispose(); }
	}
}
