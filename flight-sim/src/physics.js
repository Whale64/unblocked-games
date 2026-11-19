// 6-DOF rigid-body flight dynamics: ISA atmosphere, full-envelope aerodynamics (incl. post-stall,
// ground effect, compressibility), engine dynamics, landing gear with tyre friction, wind & turbulence.
import * as THREE from 'three';
import { getHeight, getNormal } from './world.js';

const G = 9.80665;
const RHO0 = 1.225;

export function isa(h) {
	const hh = Math.min(Math.max(h, -500), 20000);
	let T, p;
	if (hh < 11000) {
		T = 288.15 - 0.0065 * hh;
		p = 101325 * Math.pow(T / 288.15, 5.25588);
	} else {
		T = 216.65;
		p = 22632.1 * Math.exp(-(hh - 11000) * G / (287.05 * T));
	}
	const rho = p / (287.05 * T);
	return { T, p, rho, a: Math.sqrt(1.4 * 287.05 * T) };
}

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// Vertical impact speed (m/s, into the surface) each kind of airframe contact point survives.
// Below these a contact is a scrape (sparks, friction, maybe damage) instead of a crash.
const HULL_LIMIT = { tip: 6.5, tail: 5.5, belly: 5.0, nacelle: 4.5, nose: 4.0, prop: 7, top: 3.0 };
const HULL_REASON = {
	tip: 'Wing struck the ground', tail: 'Tail struck the ground hard', belly: 'Belly impact',
	nacelle: 'Engine pod struck the ground', nose: 'Nose-first impact', prop: 'Nose-first impact', top: 'Inverted impact',
};

const _m = new THREE.Matrix4();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class FlightModel {
	constructor(cfg) {
		this.cfg = cfg;
		this.pos = new THREE.Vector3();
		this.vel = new THREE.Vector3();
		this.quat = new THREE.Quaternion();
		this.omega = new THREE.Vector3(); // body rates (x right, y up, z back)
		this.accel = new THREE.Vector3();
		this.gust = new THREE.Vector3();
		this.gustRoll = 0;
		this.windBase = new THREE.Vector3();
		this.turb = 0;
		this.time = 0;
		// actuators
		this.de = 0; this.da = 0; this.dr = 0;
		this.flap = 0; this.flapTarget = 0;
		this.gearPos = 1; this.gearDown = true;
		this.airbrake = 0;
		this.engine = 0; this.ab = 0; this.rpm = 0;
		this.trim = 0;
		this.brake = 0;
		this.parkBrake = false;
		this.brakeL = 0; this.brakeR = 0;
		this.gearState = cfg.gear.map(() => ({ comp: 0, contact: false, wheelRot: 0, load: 0 }));
		this.crashed = false;
		this.crashReason = '';
		this.onGround = false;
		this.airborneTime = 0;
		this.events = [];
		this.nz = 1;
		this.maxG = 1;
		this.lawI = 0;
		this.bankRef = null;
		this.gammaRef = null;
		this.nzPath = 1;
		this.nzS = 1;
		this.engineFailed = false;
		this.tel = {};
		this.stallWarn = 0;
		this.buffet = 0;
		this.setupGear();
	}

	setupGear() {
		const c = this.cfg, gs = c.gear;
		// static load distribution from moment balance (nose vs mains along z)
		const nose = gs[0], mainZ = gs[1].p[2];
		const noseFrac = mainZ / (mainZ - nose.p[2]);
		const W = c.mass * G;
		this.gearK = []; this.gearC = [];
		gs.forEach((g, i) => {
			const load = i === 0 ? W * noseFrac : W * (1 - noseFrac) / (gs.length - 1);
			const k = load / (0.42 * g.maxC) * g.k;
			const m = load / G;
			this.gearK.push(k);
			this.gearC.push(2 * 0.55 * Math.sqrt(k * m) * g.c);
		});
	}

	reset({ pos, heading = 0, speed = 0, onGround = false, gearDown = true, flaps = 0, throttle = 0, pitch = 0 }) {
		this.pos.copy(pos);
		const h = heading * Math.PI / 180;
		const e = new THREE.Euler(pitch * Math.PI / 180, -h, 0, 'YXZ');
		this.quat.setFromEuler(e);
		const fwd = _v1.set(0, 0, -1).applyQuaternion(this.quat);
		this.vel.copy(fwd).multiplyScalar(speed);
		this.omega.set(0, 0, 0);
		this.gearDown = gearDown || !this.cfg.retractable;
		this.gearPos = this.gearDown ? 1 : 0;
		this.flap = this.flapTarget = flaps;
		this.engine = throttle; this.ab = 0;
		this.rpm = this.cfg.engine === 'prop' ? 700 + throttle * 1900 : 0;
		this.crashed = false; this.crashReason = '';
		this.engineFailed = false; this.nzS = 1; this._lastScrape = {};
		this.gearState.forEach((g) => { g.broken = false; g.comp = 0; });
		this.onGround = onGround;
		this.airborneTime = onGround ? 0 : 10;
		this.trim = 0;
		this.maxG = 1;
		this.de = this.da = this.dr = 0;
		this.gust.set(0, 0, 0);
		this.events.length = 0;
		this.parkBrake = false;
		if (onGround) {
			// settle on the gear
			const gy = this.cfg.gear[1].p[1];
			this.pos.y = Math.max(getHeight(pos.x, pos.z), 0) - gy - 0.42 * this.cfg.gear[1].maxC + 0.02;
		}
	}

	windAt(y, agl) {
		// logarithmic boundary-layer wind profile
		const z0 = 0.15;
		const f = clamp(Math.log(Math.max(agl, 0.5) / z0) / Math.log(10 / z0), 0.3, 1.45);
		return _v4.copy(this.windBase).multiplyScalar(f);
	}

	step(dt, ctl) {
		if (this.crashed) return;
		const c = this.cfg;
		this.time += dt;
		const R = _m.makeRotationFromQuaternion(this.quat);
		const e = R.elements;
		// body axes in world
		const right = _v1.set(e[0], e[1], e[2]);
		const up = _v2.set(e[4], e[5], e[6]);
		const back = _v3.set(e[8], e[9], e[10]);

		const ground = getHeight(this.pos.x, this.pos.z);
		const agl = this.pos.y - Math.max(ground, 0);
		const atm = isa(this.pos.y);

		// ---- turbulence (Ornstein-Uhlenbeck gusts, stronger near the ground)
		const tau = 1.6;
		const sig = this.turb * (1.2 + 1.5 * Math.exp(-Math.max(agl, 0) / 600)) * (agl < 1 ? 0.2 : 1);
		const k1 = Math.sqrt(2 * dt / tau) * sig;
		this.gust.x += -this.gust.x / tau * dt + gauss() * k1;
		this.gust.y += -this.gust.y / tau * dt + gauss() * k1 * 0.7;
		this.gust.z += -this.gust.z / tau * dt + gauss() * k1;
		this.gustRoll += -this.gustRoll / 0.8 * dt + gauss() * Math.sqrt(2 * dt / 0.8) * this.turb * 0.02;

		const wind = this.windAt(this.pos.y, agl);
		const air = (this._air || (this._air = new THREE.Vector3())).copy(this.vel).sub(wind).sub(this.gust);
		// body-frame air velocity (my axes)
		const vbx = air.dot(right), vby = air.dot(up), vbz = air.dot(back);
		const u = -vbz, v = vbx, w = -vby; // aero axes
		const V = Math.sqrt(u * u + v * v + w * w);
		const Vs = Math.max(V, 1);
		const alpha = V > 0.5 ? Math.atan2(w, u) : 0;
		const beta = V > 0.5 ? Math.asin(clamp(v / Vs, -1, 1)) : 0;
		const qbar = 0.5 * atm.rho * V * V;
		const mach = V / atm.a;
		const p = -this.omega.z, q = this.omega.x, r = -this.omega.y;

		// ---- engine
		let thrust = 0;
		const sigma = atm.rho / RHO0;
		const thr = clamp(ctl.throttle, 0, 1);
		if (c.engine === 'prop') {
			this.engine += ((this.engineFailed ? 0 : thr) - this.engine) * Math.min(1, dt / c.spoolTime);
			const rpmT = this.engineFailed ? 0 : 650 + this.engine * 1950 + Math.min(V, 90) * 3.2;
			this.rpm += (Math.min(rpmT, 2800) - this.rpm) * Math.min(1, dt / 0.5);
			const pw = Math.pow(sigma, 1.1);
			thrust = this.engineFailed ? 0 : c.thrustStatic * (0.03 + 0.97 * this.engine) * pw * Math.max(0, 1 - V / c.vZero);
			if (this.engine < 0.02 && V > 20) thrust -= 0.002 * qbar * c.S; // windmilling drag
		} else {
			const hasAB = c.afterburner !== false;
			const target = hasAB ? (thr > 0.92 ? 1 : thr / 0.92) : thr;
			const rate = (target > this.engine ? 1 : 1.6) / c.spoolTime;
			this.engine += clamp(target - this.engine, -rate * dt, rate * dt);
			const abT = hasAB && thr > 0.92 && this.engine > 0.9 ? 1 : 0;
			this.ab += (abT - this.ab) * Math.min(1, dt / 0.35);
			// low-bypass turbojets gain thrust with ram pressure; high-bypass turbofans lose it with Mach
			const lapse = Math.pow(sigma, 0.75) * (1 + (c.ramFactor ?? 0.35) * mach + (c.ramFactor < 0 ? 0.12 * mach * mach : 0));
			thrust = (c.thrustDry * (0.05 + 0.95 * this.engine * this.engine) + ((c.thrustAB || c.thrustDry) - c.thrustDry) * this.ab) * lapse;
			// thrust reversers: only with weight on wheels
			this.reversing = !!(c.reverser && ctl.reverse && this.onGround);
			if (this.reversing) thrust = -0.45 * thrust;
			this.rpm = 60 + 40 * this.engine;
		}
		this.thrust = thrust;

		// ---- actuators
		const rateLim = (cur, tgt, rate) => cur + clamp(tgt - cur, -rate * dt, rate * dt);
		let eCmd = clamp(ctl.pitch + this.trim, -1, 1);
		let aCmd = clamp(ctl.roll, -1, 1);
		let rCmd = clamp(ctl.yaw, -1, 1);
		const law = (c.fbw || ctl.assist) && !this.onGround && V > 0.6 * c.vs / 1.94384;
		if (law) {
			// C*-style load-factor command: neutral stick holds the flight path (bank compensated)
			const fpa = Math.atan2(this.vel.y, Math.hypot(this.vel.x, this.vel.z));
			this.omegaPitchEarth = this._fpaPrev === undefined ? 0 : (fpa - this._fpaPrev) / dt;
			this._fpaPrev = fpa;
			const bank = Math.atan2(-right.y, up.y);
			const cphi = Math.cos(bank);
			const nzBase = Math.cos(fpa) * cphi / Math.max(cphi * cphi, 0.0625);
			const nzAvail = qbar * c.S * (c.CLmax + c.flapCLmax * this.flap) / (c.mass * G);
			const gmax = Math.max(1.05, Math.min(c.gLimit[0], 0.92 * nzAvail)), gmin = Math.min(-0.5, Math.max(c.gLimit[1], -0.6 * nzAvail));
			const inp = clamp(ctl.pitch, -1, 1);
			let nzCmd = nzBase + (inp > 0 ? inp * (gmax - nzBase) : inp * (nzBase - gmin));
			// outer flight-path-angle hold loop with neutral stick
			if (Math.abs(inp) < 0.02 && Math.abs(bank) < 1.2 && !ctl.ap) {
				if (this.gammaRef === null) this.gammaRef = fpa;
				nzCmd += clamp((this.gammaRef - fpa) * (c.lawGamma ?? 3.0) - (c.lawGammaD || 0) * this.omegaPitchEarth, -0.6, 0.6);
			} else this.gammaRef = null;
			if (c.pitchProtect) {
				const theta = Math.asin(clamp(-back.y, -1, 1));
				const hi = c.pitchProtect[0] * Math.PI / 180, lo = c.pitchProtect[1] * Math.PI / 180;
				if (theta > hi - 0.05) nzCmd = Math.min(nzCmd, Math.cos(fpa) - (theta - hi + 0.05) * 6);
				if (theta < lo + 0.05) nzCmd = Math.max(nzCmd, Math.cos(fpa) + (lo + 0.05 - theta) * 6);
			}
			nzCmd = clamp(nzCmd, gmin, gmax);
			const qRef = 0.5 * RHO0 * Math.pow(c.lawV, 2);
			const sched = clamp(qRef / Math.max(qbar, 1), 0.12, 3);
			const err = nzCmd - this.nzPath;
			this.lawI = clamp(this.lawI + err * c.lawKi * sched * dt, -1, 1);
			eCmd = this.lawI + err * c.lawKn * sched - q * c.lawKq * Math.sqrt(sched);
			// model-based angle-of-attack limiter (elevator that trims at the limit AoA)
			const aLim = c.alphaStall - (c.fbw ? 2.5 : 1.5) * Math.PI / 180;
			const eAt = (a) => -(c.Cm0 + c.Cma * a + c.flapCm * this.flap) / (c.Cmde * c.deMax * (1 + (c.propWash ? c.propWash * thrust / 2.8 / Math.max(qbar, 50) : 0)));
			const eMax = eAt(aLim) + (aLim - alpha) * 2.5 - q * 0.2;
			const eMin = eAt(-aLim * 0.6) + (-aLim * 0.6 - alpha) * 2.5 - q * 0.2;
			if (eCmd > eMax) { eCmd = eMax; this.lawI = Math.min(this.lawI, eMax); }
			if (eCmd < eMin) { eCmd = eMin; this.lawI = Math.max(this.lawI, eMin); }
			// roll-rate command / bank-angle hold with neutral stick
			if (Math.abs(ctl.roll) < 0.02 && !ctl.ap && Math.abs(bank) < (c.bankProtect ? 70 : 80) * Math.PI / 180) {
				if (this.bankRef === null) this.bankRef = bank;
				// bank protection: with the stick released the aircraft returns to at most the hold limit
				if (c.bankProtect) this.bankRef = clamp(this.bankRef, -c.bankProtect[0] * Math.PI / 180, c.bankProtect[0] * Math.PI / 180);
				const ss = Math.sqrt(sched);
				aCmd = clamp(((this.bankRef - bank) * 1.1 - p * 0.35) * ss, -1, 1);
			} else {
				this.bankRef = null;
				if (c.fbw) aCmd -= p * 0.08;
				if (c.bankProtect && Math.abs(bank) > c.bankProtect[1] * Math.PI / 180 && Math.sign(aCmd) === Math.sign(bank)) aCmd = -Math.sign(bank) * 0.3;
			}
			rCmd += -r * (c.fbw ? 1.6 : 0.6) + beta * (c.fbw ? 3.0 : 2.2) + (c.fbw ? 0 : aCmd * 0.12);
		} else {
			this.lawI = this.de; // bumpless transfer
			this.bankRef = null;
			this.gammaRef = null;
			if (ctl.assist && this.onGround && Math.abs(ctl.yaw) < 0.02 && Math.abs((ctl.brakeL || 0) - (ctl.brakeR || 0)) < 0.1) rCmd -= r * 3.0;
		}
		this.de = rateLim(this.de, clamp(eCmd, -1, 1), 4);
		this.da = rateLim(this.da, clamp(aCmd, -1, 1), 5);
		this.dr = rateLim(this.dr, clamp(rCmd, -1, 1), 4);
		this.flap = rateLim(this.flap, this.flapTarget, c.flapRate);
		if (c.retractable) this.gearPos = rateLim(this.gearPos, this.gearDown ? 1 : 0, 1 / c.gearTime);
		// ground spoilers deploy automatically on the ground with the throttle at idle (landing / rejected take-off)
		this.groundSpoilers = !!(c.spoilerCL && this.onGround && thr < 0.12 && V > 12);
		this.airbrake = rateLim(this.airbrake, Math.max(clamp(Number(ctl.airbrake) || 0, 0, 1), this.groundSpoilers ? 1 : 0), c.spoilerCL ? 2.5 : 1.2);
		// differential toe brakes: left/right main wheels can be braked independently
		const park = this.parkBrake ? 1 : 0;
		this.brakeL = Math.max(ctl.brake || 0, ctl.brakeL || 0, park);
		this.brakeR = Math.max(ctl.brake || 0, ctl.brakeR || 0, park);
		this.brake = Math.max(this.brakeL, this.brakeR);

		// ---- aerodynamic coefficients
		const sf = sstep(c.alphaStall, c.alphaStall + 5 * Math.PI / 180, Math.abs(alpha));
		const fl = this.flap;
		const CLmax = c.CLmax + c.flapCLmax * fl;
		let CLlin = c.CL0 + c.CLa * alpha + c.flapCL * fl;
		// soft clip toward CLmax
		const knee = 0.78 * CLmax;
		if (Math.abs(CLlin) > knee) {
			const s = Math.sign(CLlin);
			CLlin = s * (knee + (CLmax - knee) * Math.tanh((Math.abs(CLlin) - knee) / (CLmax - knee)));
		}
		const CLfp = 1.15 * Math.sin(2 * alpha);
		let CL = CLlin * (1 - sf) + CLfp * sf;
		// ground effect (Wieselsberger)
		const hb = Math.max(agl, 0.3) / c.b;
		const ge = (16 * hb) * (16 * hb) / (1 + (16 * hb) * (16 * hb));
		CL *= 1 + 0.08 * (1 - ge);
		if (c.spoilerCL) CL -= c.spoilerCL * this.airbrake * (this.onGround ? 1 : 0.4);
		const CDi = c.K * ge * CLlin * CLlin;
		let wave = 0;
		if (mach > c.Mcrit) {
			const m1 = sstep(c.Mcrit, 1.05, mach);
			wave = c.waveCD * m1 * (mach > 1.05 ? Math.max(0.55, 1 - 0.35 * (mach - 1.05)) : 1);
		}
		const CD = c.CD0 + CDi + c.flapCD * fl + c.gearCD * this.gearPos + c.airbrakeCD * this.airbrake + wave
			+ 1.25 * Math.pow(Math.sin(alpha), 2) * (0.25 + 0.75 * sf) + 0.5 * Math.abs(Math.sin(beta));
		const CY = c.CYb * beta + c.CYdr * this.dr * c.drMax;

		const ph = p * c.b / (2 * Vs), qh = q * c.c / (2 * Vs), rh = r * c.b / (2 * Vs);
		const ctrlEff = 1 - 0.55 * sf;
		const wash = c.propWash ? c.propWash * thrust / 2.8 : 0;
		const qTail = qbar + wash;
		const tailRatio = qbar > 1 ? qTail / qbar : 1;

		let Cl = c.Clb * beta + c.Clp * (1 - 1.3 * sf) * ph + c.Clr * rh + c.Clda * this.da * c.daMax * ctrlEff + c.Cldr * this.dr * c.drMax;
		// stall wing-drop asymmetry
		Cl += sf * (0.03 * Math.sin(this.time * 1.7 + 1.3) + 0.15 * beta) + this.gustRoll * c.Clda * c.daMax * 4 * (this.onGround ? 0.08 : Math.min(1, 0.25 + agl / 30));
		let Cm = c.Cm0 + c.Cma * alpha + c.Cmq * qh + c.flapCm * fl - 0.18 * sf * Math.sign(alpha) - 0.02 * this.airbrake;
		let CmCtl = c.Cmde * this.de * c.deMax * (1 - 0.3 * sf);
		let Cn = c.Cnb * beta + c.Cnp * ph + c.Cnr * (1 - 0.5 * sf) * rh + c.Cnda * this.da * c.daMax;
		let CnCtl = c.Cndr * this.dr * c.drMax;

		// aero forces in aero body axes
		const ca = Math.cos(alpha), sa = Math.sin(alpha);
		const L = qbar * c.S * CL, Dg = qbar * c.S * CD, Y = qbar * c.S * CY;
		const Fxa = -Dg * ca + L * sa;
		const Fza = -Dg * sa - L * ca;
		const Fya = Y;
		const La = qbar * c.S * c.b * Cl;
		const Ma = qbar * c.S * c.c * Cm + qTail * c.S * c.c * CmCtl;
		let Na = qbar * c.S * c.b * Cn + qTail * c.S * c.b * CnCtl;
		let Lx = La;
		if (c.engine === 'prop') {
			Na -= c.pFactor * thrust / (1 + V / 22);
			Lx -= c.torque * thrust * 0.35;
		}

		// convert to my body axes: x right, y up, z back
		const Fb = (this._Fb || (this._Fb = new THREE.Vector3())).set(Fya, -Fza, -Fxa - thrust);
		const Mb = (this._Mb || (this._Mb = new THREE.Vector3())).set(Ma, -Na, -Lx);

		// world force
		const F = (this._F || (this._F = new THREE.Vector3())).set(0, 0, 0)
			.addScaledVector(right, Fb.x).addScaledVector(up, Fb.y).addScaledVector(back, Fb.z);
		F.y -= c.mass * G;

		// ---- ground contact: gear struts + airframe points, forgiving damage model
		const contactF = (this._cF || (this._cF = new THREE.Vector3())).set(0, 0, 0);
		let anyContact = false, inWater = false;
		const reach = Math.max(c.b * 0.5, 6) + 6;
		const nearGround = agl < reach || this.pos.y < reach + 5;
		const gearUsable = this.gearPos > 0.95 && nearGround;
		const Rinv = _q.copy(this.quat).invert();
		const T = this._t || (this._t = { rel: new THREE.Vector3(), pw: new THREE.Vector3(), nv: new THREE.Vector3(), vpt: new THREE.Vector3(), w: new THREE.Vector3(), fwd: new THREE.Vector3(), side: new THREE.Vector3(), Fc: new THREE.Vector3(), tq: new THREE.Vector3(), vt: new THREE.Vector3() });
		const omegaW = T.w.copy(this.omega).applyQuaternion(this.quat);
		const pointKinematics = (pb) => {
			T.rel.set(pb[0], pb[1], pb[2]).applyQuaternion(this.quat);
			T.pw.copy(T.rel).add(this.pos);
			T.vpt.crossVectors(omegaW, T.rel).add(this.vel);
		};
		const applyContact = (F) => {
			contactF.add(F);
			Mb.add(T.tq.crossVectors(T.rel, F).applyQuaternion(Rinv));
		};
		// water: soft, very draggy contact. A light touch at speed only throws spray.
		const waterContact = (pen, kind) => {
			const vInto = -T.vpt.y;
			const speed = this.vel.length();
			if (vInto > 3.2 || ((kind === 'nose' || kind === 'prop' || kind === 'top') && speed > 18)) { this.crash('Ditched in the water'); return false; }
			const kW = c.mass * G / 0.5;
			const N = Math.max(0, kW * pen + 2 * Math.sqrt(kW * c.mass * 0.2) * vInto);
			T.Fc.set(-T.vpt.x * c.mass * 0.25, N, -T.vpt.z * c.mass * 0.25);
			applyContact(T.Fc);
			inWater = true;
			if (this.time - (this._lastSpray || -9) > 0.15) { this._lastSpray = this.time; this.events.push({ type: 'spray', p: T.pw.clone(), speed }); }
			return true;
		};
		let tdLogged = false;
		for (let i = 0; i < c.gear.length; i++) {
			const g = c.gear[i];
			const st = this.gearState[i];
			st.contact = false; st.load = 0;
			if (!gearUsable || st.broken) { st.comp = 0; continue; }
			pointKinematics(g.p);
			const hg = getHeight(T.pw.x, T.pw.z);
			const pen0 = Math.max(hg, 0) - T.pw.y;
			if (pen0 <= 0) { st.comp = Math.max(0, st.comp - dt * 2); continue; }
			if (hg < 0) { if (!waterContact(pen0, 'gear')) return; continue; }
			const n = getNormal(T.pw.x, T.pw.z);
			const nv = T.nv.set(n.x, n.y, n.z);
			const pen = pen0 * nv.y;
			const vn = T.vpt.dot(nv);
			let Fn = this.gearK[i] * pen - this.gearC[i] * vn;
			if (pen > g.maxC) {
				Fn += this.gearK[i] * 25 * (pen - g.maxC);
				const lim = c.gearCrashVs || 4.5;
				if (-vn > lim * 1.7) { this.crash('Landing gear collapsed (very hard landing)'); return; }
				if (-vn > lim) { st.broken = true; st.comp = 0; this.events.push({ type: 'gearcollapse', index: i, p: T.pw.clone() }); continue; }
			}
			Fn = Math.max(0, Fn);
			// tyre forces
			const steer = g.steer ? clamp(ctl.yaw, -1, 1) * (c.steerMax || 0.55) * clamp(1 - V / 45, 0.15, 1) : 0;
			const fwdB = T.fwd.set(Math.sin(steer), 0, -Math.cos(steer)).applyQuaternion(this.quat);
			fwdB.addScaledVector(nv, -fwdB.dot(nv)).normalize();
			const side = T.side.crossVectors(fwdB, nv).normalize();
			const vf = T.vpt.dot(fwdB), vs = T.vpt.dot(side);
			const wb = g.p[0] < -0.01 ? this.brakeL : g.p[0] > 0.01 ? this.brakeR : this.brake;
			const mu = 0.018 + (g.brake ? wb * 0.75 : 0);
			const Ff = -Math.sign(vf) * mu * Fn * Math.min(1, Math.abs(vf) / 0.35);
			// tyre cornering force builds with slip angle and saturates around 7 deg (not instantly)
			const slip = Math.atan2(vs, Math.max(Math.abs(vf), 2));
			const Fs = -0.85 * Fn * clamp(slip / 0.12, -1, 1);
			applyContact(T.Fc.copy(nv).multiplyScalar(Fn).addScaledVector(fwdB, Ff).addScaledVector(side, Fs));
			st.contact = true; st.comp = Math.min(pen, g.maxC * 1.2); st.load = Fn;
			st.wheelRot += vf * dt / g.r;
			anyContact = true;
			if (!this.onGround && this.airborneTime > 1.0 && !tdLogged) {
				tdLogged = true;
				this.events.push({ type: 'touchdown', vs: vn, speed: V });
			}
		}
		// airframe points: wingtips, tail, belly, nose, nacelles, prop...
		if (nearGround) {
			const kH = c.mass * G / 0.06, cH = 2 * 0.9 * Math.sqrt(kH * c.mass * 0.25);
			for (const hp of c.hull) {
				const kind = typeof hp[3] === 'string' ? hp[3] : hp[3] === 1 ? 'tail' : 'belly';
				pointKinematics(hp);
				const hg = getHeight(T.pw.x, T.pw.z);
				const pen = Math.max(hg, 0) - T.pw.y;
				if (pen <= 0) continue;
				anyContact = true;
				if (hg < 0) { if (!waterContact(pen, kind)) return; continue; }
				const n = getNormal(T.pw.x, T.pw.z);
				const nv = T.nv.set(n.x, n.y, n.z);
				const vInto = -T.vpt.dot(nv);
				if (vInto > HULL_LIMIT[kind] * (c.hullToughness || 1) || pen > 1.5) {
					this.crash(this.gearPos < 0.95 && kind === 'belly' ? 'Gear-up landing (hit too hard)' : HULL_REASON[kind]);
					return;
				}
				const N = Math.max(0, kH * pen + cH * vInto);
				const vt = T.vt.copy(T.vpt).addScaledVector(nv, -T.vpt.dot(nv));
				const sp = vt.length();
				const fr = sp > 1e-3 ? -Math.min(0.45 * N, sp * c.mass * 3) / sp : 0;
				applyContact(T.Fc.copy(nv).multiplyScalar(N).addScaledVector(vt, fr));
				if (kind === 'prop' && !this.engineFailed && c.engine === 'prop') { this.engineFailed = true; this.events.push({ type: 'propstrike', p: T.pw.clone() }); }
				this._lastScrape = this._lastScrape || {};
				if (sp > 2 && this.time - (this._lastScrape[kind] || -9) > 0.12) {
					this._lastScrape[kind] = this.time;
					this.events.push({ type: 'scrape', kind, p: T.pw.clone(), speed: sp });
				}
			}
		}
		if (inWater && this.vel.length() < 14) { this.crash('Ditched in the water'); return; }
		F.add(contactF);
		this.onGround = anyContact;
		if (anyContact) this.airborneTime = 0; else this.airborneTime += dt;

		// ---- integrate translation
		this.accel.copy(F).divideScalar(c.mass);
		this.vel.addScaledVector(this.accel, dt);
		this.pos.addScaledVector(this.vel, dt);

		// load factor along body up (excluding gravity)
		const specific = _v4.copy(this.accel); specific.y += G;
		const nzRaw = specific.dot(up) / G;
		this.nz += (nzRaw - this.nz) * Math.min(1, dt / 0.05);
		if (!this.onGround) this.maxG = Math.max(this.maxG, this.nz);
		const sp = this.vel.length();
		if (sp > 1) {
			const vh = _v1.copy(this.vel).divideScalar(sp);
			const upN = (this._upN || (this._upN = new THREE.Vector3())).copy(up).addScaledVector(vh, -vh.dot(up));
			if (upN.lengthSq() > 1e-6) {
				upN.normalize();
				const nzp = specific.dot(upN) / G;
				this.nzPath += (nzp - this.nzPath) * Math.min(1, dt / 0.05);
			}
		}

		// ---- integrate rotation (Euler's equations, diagonal inertia)
		const I = (this._I || (this._I = new THREE.Vector3())).set(c.inertia.pitch, c.inertia.yaw, c.inertia.roll);
		const w0 = this.omega;
		const Iw = (this._Iw || (this._Iw = new THREE.Vector3())).set(w0.x * I.x, w0.y * I.y, w0.z * I.z);
		const gyro = (this._gy || (this._gy = new THREE.Vector3())).crossVectors(w0, Iw);
		const dw = Mb.sub(gyro);
		this.omega.x += dw.x / I.x * dt;
		this.omega.y += dw.y / I.y * dt;
		this.omega.z += dw.z / I.z * dt;
		// slight structural damping for stability on the ground
		if (anyContact) this.omega.multiplyScalar(1 - 0.5 * dt);
		const wq = (this._wq || (this._wq = new THREE.Quaternion())).set(this.omega.x * dt * 0.5, this.omega.y * dt * 0.5, this.omega.z * dt * 0.5, 0);
		const dq = (this._dq || (this._dq = new THREE.Quaternion())).copy(this.quat).multiply(wq);
		this.quat.x += dq.x; this.quat.y += dq.y; this.quat.z += dq.z; this.quat.w += dq.w;
		this.quat.normalize();

		// structural limits: aerodynamic load factor only, lightly filtered
		const nzAero = -Fza / (c.mass * G);
		this.nzS += (nzAero - this.nzS) * Math.min(1, dt / 0.25);
		if (this.airborneTime > 0.5 && (this.nzS > c.gLimit[0] * 1.5 + 0.5 || this.nzS < c.gLimit[1] * 1.5 - 0.5)) {
			this.crash('Structural failure (over-G)');
			return;
		}
		if (V > c.vne / 1.94384 * 1.18 && mach < 1.0 && c.engine === 'prop') {
			this.crash('Structural failure (overspeed)');
			return;
		}

		// ---- telemetry
		this.stallWarn = Math.max(sstep(c.alphaStall - 4 * Math.PI / 180, c.alphaStall, Math.abs(alpha)), 0);
		this.buffet = sf * Math.min(1, qbar / 1500) + this.stallWarn * 0.2 * Math.min(1, qbar / 800);
		this._alpha = alpha; this._beta = beta; this._V = V; this._qbar = qbar; this._mach = mach;
		this._agl = agl; this._rho = atm.rho; this._CL = CL; this._sf = sf;
	}

	crash(reason) {
		if (this.crashed) return;
		this.crashed = true;
		this.crashReason = reason;
		this.events.push({ type: 'crash', reason });
	}

	telemetry() {
		const t = this.tel;
		const fwd = _v1.set(0, 0, -1).applyQuaternion(this.quat);
		const rightV = _v2.set(1, 0, 0).applyQuaternion(this.quat);
		const upV = _v3.set(0, 1, 0).applyQuaternion(this.quat);
		t.heading = (Math.atan2(fwd.x, -fwd.z) * 180 / Math.PI + 360) % 360;
		t.pitch = Math.asin(clamp(fwd.y, -1, 1)) * 180 / Math.PI;
		t.bank = Math.atan2(-rightV.y, upV.y) * 180 / Math.PI;
		const q = this._qbar || 0;
		t.ias = Math.sqrt(2 * q / RHO0) * 1.94384;
		t.tas = (this._V || 0) * 1.94384;
		t.gs = Math.hypot(this.vel.x, this.vel.z) * 1.94384;
		t.mach = this._mach || 0;
		t.alt = this.pos.y * 3.28084;
		t.agl = (this._agl || 0) * 3.28084;
		t.vs = this.vel.y * 196.85;
		t.alpha = (this._alpha || 0) * 180 / Math.PI;
		t.beta = (this._beta || 0) * 180 / Math.PI;
		t.nz = this.nz;
		t.maxG = this.maxG;
		t.track = (Math.atan2(this.vel.x, -this.vel.z) * 180 / Math.PI + 360) % 360;
		t.fpa = Math.atan2(this.vel.y, Math.hypot(this.vel.x, this.vel.z)) * 180 / Math.PI;
		t.engine = this.engine; t.ab = this.ab; t.rpm = this.rpm; t.thrust = this.thrust;
		t.flap = this.flap; t.gearPos = this.gearPos; t.gearDown = this.gearDown;
		t.brake = this.brake; t.parkBrake = this.parkBrake; t.airbrake = this.airbrake; t.trim = this.trim;
		t.onGround = this.onGround; t.stall = this.stallWarn; t.buffet = this.buffet;
		t.reversing = !!this.reversing; t.engineFailed = !!this.engineFailed; t.groundSpoilers = !!this.groundSpoilers;
		return t;
	}
}
