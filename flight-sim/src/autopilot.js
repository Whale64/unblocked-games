// Autopilot + autothrottle: HDG / LOC lateral, ALT / V/S / G/S vertical, SPEED autothrottle,
// APP mode flying an ILS to an autoland (FLARE, RETARD, ROLLOUT with autobrake).
// Works by producing stick/throttle inputs for the flight model's control law.
import { airports, toRunwayLocal } from './world.js';

const D2R = Math.PI / 180, FT = 0.3048, KT = 0.514444;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrap180 = (a) => ((a % 360) + 540) % 360 - 180;

// Geometry of the aircraft relative to one runway end (landing toward +u for end -1).
export function runwayGeom(ap, end, pos) {
	const l = toRunwayLocal(ap, pos.x, pos.z);
	return {
		ap, end,
		course: end < 0 ? ap.heading : (ap.heading + 180) % 360,
		before: end < 0 ? -(l.u + ap.length / 2) : (l.u - ap.length / 2),
		xte: end < 0 ? l.v : -l.v,
		name: `${ap.id} ${String(end < 0 ? ap.numA : ap.numB).padStart(2, '0')}`,
	};
}

// Best runway end ahead of the aircraft for an approach.
export function findApproachEnd(pos, heading) {
	let best = null;
	for (const ap of airports) {
		for (const end of [-1, 1]) {
			const l = toRunwayLocal(ap, pos.x, pos.z);
			const before = end < 0 ? -(l.u + ap.length / 2) : (l.u - ap.length / 2); // metres before the threshold
			if (before < -200 || before > 40000) continue;
			const course = end < 0 ? ap.heading : (ap.heading + 180) % 360;
			if (Math.abs(wrap180(heading - course)) > 100) continue;
			const xte = end < 0 ? l.v : -l.v; // + = right of the extended centre line
			if (Math.abs(xte) > Math.max(3000, before * 0.4)) continue;
			const score = Math.abs(before) + Math.abs(xte) * 3;
			if (!best || score < best.score) best = { ap, end, course, before, xte, score, name: `${ap.id} ${String(end < 0 ? ap.numA : ap.numB).padStart(2, '0')}` };
		}
	}
	return best;
}

export class Autopilot {
	constructor() { this.reset(); }

	reset() {
		this.engaged = false; this.athr = false; this.fd = false;
		this.lat = 'HDG'; this.vert = 'ALT'; this.spdMode = 'SPEED';
		this.appArmed = false; this.locCap = false; this.gsCap = false;
		this.hdgTarget = null; this.altTarget = 0; this.spdTarget = 0; this.vsTarget = 0;
		this.thrI = 0; this.thrCmd = 0; this.flare = false; this.rollout = false; this.tdTime = 0;
		this.fdPitch = 0; this.fdRoll = 0; this.msg = null;
		this.touched = { spd: false, hdg: false, alt: false };
		this.vsSel = 0;
	}

	// While disengaged, unselected targets follow the aircraft so the panel shows sensible values
	// and knob turns start from where the aircraft is.
	preview(fm, cfg) {
		const t = fm.tel;
		if (!this.vsSel) this.vsSel = cfg.category === 'airliner' ? 1500 : cfg.engine === 'jet' ? 3000 : 700;
		if (!this.engaged) {
			if (!this.touched.hdg) this.hdgTarget = (Math.round(t.heading) + 360) % 360;
			if (!this.touched.alt) this.altTarget = Math.max(Math.round(t.alt / 100) * 100, 0);
		}
		if (!this.athr && !this.touched.spd) this.spdTarget = Math.round(Math.max(t.ias, cfg.vs * 1.3));
	}

	adjust(field, d, cfg) {
		this.touched[field] = true;
		if (field === 'spd') this.spdTarget = clamp(Math.round(this.spdTarget + d), Math.round(cfg.vs * 1.1), Math.round(cfg.vne || 600));
		else if (field === 'hdg') { this.hdgTarget = ((Math.round(this.hdgTarget + d) % 360) + 360) % 360; if (this.engaged && this.locCap) { this.appArmed = false; this.locCap = this.gsCap = false; this.rwy = null; } }
		else if (field === 'alt') this.setAltitude(this.altTarget + d);
		else if (field === 'vs') { this.vsSel = clamp(this.vsSel + d, 100, 6000); if (this.vert === 'V/S') this.vsDefault = this.vsSel * FT / 60; }
	}

	get spd() { return this.athr; }
	get alt() { return this.engaged && (this.vert === 'ALT' || this.vert === 'V/S'); }

	engage(fm, cfg, throttle) {
		const t = fm.tel;
		this.engaged = true; this.fd = true;
		if (!this.touched.hdg) this.hdgTarget = (Math.round(t.heading) + 360) % 360;
		if (!this.touched.alt) this.altTarget = Math.max(Math.round(t.alt / 100) * 100, 0);
		this.touched.hdg = this.touched.alt = false;
		this.lat = 'HDG';
		this.vsTarget = 0;
		// a preselected altitude away from the current one starts a climb / descent toward it
		if (Math.abs(this.altTarget - t.alt) > 150) { this.vert = 'V/S'; this.vsDefault = (this.vsSel || 1000) * FT / 60; } else this.vert = 'ALT';
		if (!this.athr) this.engageAthr(fm, cfg, throttle);
		this.flare = this.rollout = false; this.rwy = null; this.locCap = this.gsCap = false; this.appArmed = false;
		this.cfg = cfg;
	}

	engageAthr(fm, cfg, throttle) {
		this.athr = true;
		if (!this.touched.spd) this.spdTarget = Math.round(Math.max(fm.tel.ias, cfg.vs * 1.3) / 5) * 5;
		this.touched.spd = false;
		this.thrI = throttle; this.thrCmd = throttle;
	}

	disengage(reason) {
		if (this.engaged) this.msg = reason || 'Autopilot disconnected';
		this.engaged = false; this.appArmed = false; this.locCap = this.gsCap = false; this.flare = this.rollout = false; this.rwy = null;
		this.fd = false;
	}

	disengageAthr() { this.athr = false; }

	setAltitude(ft, vsDefault) {
		this.altTarget = clamp(Math.round(ft / 100) * 100, 0, 45000);
		if (this.engaged && !this.gsCap) { this.vert = 'V/S'; this.vsTarget = 0; this.vsDefault = vsDefault || (this.vsSel || 1000) * FT / 60; }
	}

	armApproach() {
		if (!this.engaged) return false;
		this.appArmed = true; this.locCap = false; this.gsCap = false; this.rwy = null;
		return true;
	}

	fma() {
		if (!this.fd) return ['', '', '', ''];
		const spd = this.flare && this.vert === 'FLARE' && this.athr ? 'RETARD' : this.athr ? this.spdMode : '';
		const lat = this.rollout ? 'ROLLOUT' : this.locCap ? 'LOC' : this.lat + (this.appArmed ? ' LOC*' : '');
		const vert = this.rollout ? 'ROLLOUT' : this.flare ? 'FLARE' : this.gsCap ? 'G/S' : this.vert + (this.appArmed && !this.gsCap ? ' G/S*' : '');
		return [spd, lat, vert, this.engaged ? (this.athr ? 'AP1 A/THR' : 'AP1') : 'FD'];
	}

	// Called once per frame before the physics step; overrides the stick/throttle inputs in ctl.
	apply(ctl, fm, cfg, dt) {
		if (!this.engaged && !this.athr) return;
		const t = fm.tel;
		const V = Math.max(fm.vel.length(), 20);
		const gamma = Math.atan2(fm.vel.y, Math.hypot(fm.vel.x, fm.vel.z));
		const bank = t.bank * D2R;
		let wheelH = (t.agl * FT) + cfg.gear[1].p[1];
		const big = cfg.category === 'airliner';
		let thrOverride = null;

		if (this.engaged) {
			ctl.ap = true; ctl.assist = true;
			// ------------------------------------------------ approach capture logic
			// once the localizer is captured, stay locked to that runway end through touchdown and rollout
			const app = this.rwy ? runwayGeom(this.rwy.ap, this.rwy.end, fm.pos) : (this.appArmed ? findApproachEnd(fm.pos, t.heading) : null);
			if (this.appArmed && app) {
				if (!this.locCap && Math.abs(app.xte) < 2500 && Math.abs(wrap180(t.track - app.course)) < 45 && app.before > 2500) { this.locCap = true; this.rwy = { ap: app.ap, end: app.end }; this.msg = `LOC ${app.name} captured`; }
				const distTD = app.before + 300;
				const pathH = app.ap.elev + 15 + distTD * Math.tan(3 * D2R);
				const above = fm.pos.y - pathH;
				// capture from below, or from slightly above (within ~0.7 deg of the glide path)
				if (this.locCap && !this.gsCap && distTD > 1800 && distTD < 30000 && above < Math.max(25, distTD * Math.tan(0.7 * D2R))) {
					this.gsCap = true; this.msg = 'Glideslope captured';
					if (this.athr) this.spdTarget = cfg.vapp;
				}
			}
			// on an approach, flare/heights are relative to the runway, not the terrain below
			if (app && this.gsCap) wheelH = fm.pos.y - app.ap.elev + cfg.gear[1].p[1];
			// ------------------------------------------------ lateral
			let bankCmd = 0;
			const bankMax = (big ? 25 : 30) * D2R;
			if (this.rollout) bankCmd = 0;
			else if (this.locCap && app) {
				// intercept / track the localizer with a track (not heading) loop: wind is corrected for
				const xteRate = this._lastXte === undefined ? 0 : (app.xte - this._lastXte) / Math.max(dt, 1e-3);
				this._lastXte = app.xte;
				const desiredTrack = app.course - clamp(app.xte * 0.05 + xteRate * 0.38, -30, 30);
				bankCmd = clamp(wrap180(desiredTrack - t.track) * 1.6 * D2R, -bankMax, bankMax);
				this.hdgTarget = Math.round((desiredTrack + 360) % 360);
			} else {
				bankCmd = clamp(wrap180(this.hdgTarget - t.heading) * 1.4 * D2R, -bankMax, bankMax);
			}
			if (wheelH < 30) bankCmd = clamp(bankCmd, -8 * D2R, 8 * D2R);
			ctl.roll = clamp((bankCmd - bank) * 2.2 - (-fm.omega.z) * 0.9, -1, 1);
			// ------------------------------------------------ vertical: compute a commanded flight-path angle
			let gammaCmd = gamma;
			const altM = t.alt * FT, altT = this.altTarget * FT;
			const vsMax = (big ? 1800 : cfg.engine === 'jet' ? 4000 : 800) * FT / 60;
			if (this.gsCap && app) {
				const distTD = app.before + 300;
				const pathH = app.ap.elev + 15 + distTD * Math.tan(3 * D2R);
				const above = fm.pos.y - pathH;
				const flareH = big ? 15 : cfg.engine === 'jet' ? 9 : 5;
				if (wheelH < flareH && !t.onGround) this.flare = true;
				if (this.flare || t.onGround) {
					this.vert = 'FLARE';
					// exponential flare toward ~ -0.5 m/s at touchdown
					const vsC = -Math.max(0.45, wheelH * 0.2);
					// de-crab: align the nose with the runway just before touchdown
					if (wheelH < (big ? 10 : 5)) ctl.yaw = clamp(wrap180(app.course - t.heading) * 0.15, -1, 1);
					gammaCmd = Math.asin(clamp(vsC / V, -0.3, 0.1));
					if (wheelH < (big ? 6 : 3) && this.athr) thrOverride = 0;
				} else {
					this.vert = 'G/S';
					gammaCmd = (-3 * D2R) - clamp(above / Math.max(distTD, 400), -0.05, 0.05) * 1.2;
				}
			} else {
				const err = altT - altM;
				let vsC;
				if (this.vert === 'V/S' && Math.abs(err) > 60) vsC = Math.sign(err) * (this.vsDefault || vsMax);
				else { this.vert = 'ALT'; vsC = clamp(err * 0.09, -vsMax, vsMax); }
				gammaCmd = Math.asin(clamp(vsC / V, -0.35, 0.35));
			}
			// keep the energy honest: never let the AP stall the aircraft
			const minSpd = cfg.vs * 1.15 * KT;
			if (t.ias * KT < minSpd && gammaCmd > gamma) gammaCmd = gamma - 0.01;
			const gRate = this._lastGamma === undefined ? 0 : (gamma - this._lastGamma) / Math.max(dt, 1e-3);
			this._lastGamma = gamma;
			const dNz = (V / 9.81) * ((gammaCmd - gamma) * (big ? 0.35 : 0.6) - gRate * (big ? 0.6 : 0.3));
			const cphi = Math.cos(bank);
			const nzBase = Math.cos(gamma) * cphi / Math.max(cphi * cphi, 0.0625);
			const span = dNz > 0 ? (cfg.gLimit[0] - nzBase) : (nzBase - cfg.gLimit[1]);
			ctl.pitch = clamp(dNz / Math.max(span, 0.5), -0.6, 0.6);
			this.fdPitch = (gammaCmd - gamma) / D2R * 3;
			this.fdRoll = (bankCmd - bank) / D2R;
			// ------------------------------------------------ rollout: centreline + autobrake
			if (t.onGround && (this.flare || this.rollout)) {
				if (!this.rollout) { this.rollout = true; this.tdTime = 0; }
				this.tdTime += dt;
				// wheels down: let the gear hold the wings, just ease the nose onto the runway
				ctl.pitch = this.tdTime > 1.5 ? -0.03 : Math.max(0, ctl.pitch) * 0.3;
				ctl.roll = Math.max(-0.25, Math.min(0.25, -bank * 0.8));
				if (app) ctl.yaw = clamp(-app.xte * 0.06 - wrap180(t.track - app.course) * 0.08, -1, 1);
				if (this.tdTime > 2) ctl.brake = Math.max(ctl.brake || 0, 0.45);
				thrOverride = 0;
				if (t.gs < 25) { this.disengage('Autoland complete: autopilot off'); this.athr = false; }
			}
		}
		// ------------------------------------------------ autothrottle
		if (this.athr) {
			if (thrOverride !== null) { this.thrCmd = Math.max(0, this.thrCmd - dt * 0.5); }
			else {
				const err = this.spdTarget - t.ias;
				this.thrI = clamp(this.thrI + err * 0.0025 * dt * 10, 0, cfg.afterburner === false ? 1 : 0.9);
				this.thrCmd = clamp(this.thrI + err * 0.02, 0, cfg.afterburner === false ? 1 : 0.9);
			}
			ctl.throttle = this.thrCmd;
		}
	}
}
