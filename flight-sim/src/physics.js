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
		const air = new THREE.Vector3().copy(this.vel).sub(wind).sub(this.gust);
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
			this.engine += (thr - this.engine) * Math.min(1, dt / c.spoolTime);
			const rpmT = 650 + this.engine * 1950 + Math.min(V, 90) * 3.2;
			this.rpm += (Math.min(rpmT, 2800) - this.rpm) * Math.min(1, dt / 0.5);
			const pw = Math.pow(sigma, 1.1);
			thrust = c.thrustStatic * (0.03 + 0.97 * this.engine) * pw * Math.max(0, 1 - V / c.vZero);
			if (this.engine < 0.02 && V > 20) thrust -= 0.002 * qbar * c.S; // windmilling drag
		} else {
			const target = thr > 0.92 ? 1 : thr / 0.92;
			const rate = (target > this.engine ? 1 : 1.6) / c.spoolTime;
			this.engine += clamp(target - this.engine, -rate * dt, rate * dt);
			const abT = thr > 0.92 && this.engine > 0.9 ? 1 : 0;
			this.ab += (abT - this.ab) * Math.min(1, dt / 0.35);
			const lapse = Math.pow(sigma, 0.75) * (1 + 0.35 * mach);
			thrust = (c.thrustDry * (0.05 + 0.95 * this.engine * this.engine) + (c.thrustAB - c.thrustDry) * this.ab) * lapse;
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
			const bank = Math.atan2(-right.y, up.y);
			const cphi = Math.cos(bank);
			const nzBase = Math.cos(fpa) * cphi / Math.max(cphi * cphi, 0.0625);
			const nzAvail = qbar * c.S * (c.CLmax + c.flapCLmax * this.flap) / (c.mass * G);
			const gmax = Math.max(1.05, Math.min(c.gLimit[0], 0.92 * nzAvail)), gmin = Math.min(-0.5, Math.max(c.gLimit[1], -0.6 * nzAvail));
			const inp = clamp(ctl.pitch, -1, 1);
			let nzCmd = nzBase + (inp > 0 ? inp * (gmax - nzBase) : inp * (nzBase - gmin));
			// outer flight-path-angle hold loop with neutral stick
			if (Math.abs(inp) < 0.02 && Math.abs(bank) < 1.2) {
				if (this.gammaRef === null) this.gammaRef = fpa;
				nzCmd += clamp((this.gammaRef - fpa) * 3.0, -0.6, 0.6);
			} else this.gammaRef = null;
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
			if (Math.abs(ctl.roll) < 0.02 && Math.abs(bank) < 80 * Math.PI / 180) {
				if (this.bankRef === null) this.bankRef = bank;
				const ss = Math.sqrt(sched);
				aCmd = clamp(((this.bankRef - bank) * 1.1 - p * 0.35) * ss, -1, 1);
			} else {
				this.bankRef = null;
				if (c.fbw) aCmd -= p * 0.08;
			}
			rCmd += -r * (c.fbw ? 1.6 : 0.6) + beta * (c.fbw ? 3.0 : 2.2) + (c.fbw ? 0 : aCmd * 0.12);
		} else {
			this.lawI = this.de; // bumpless transfer
			this.bankRef = null;
			this.gammaRef = null;
			if (ctl.assist && this.onGround && Math.abs(ctl.yaw) < 0.02) rCmd -= r * 3.0;
		}
		this.de = rateLim(this.de, clamp(eCmd, -1, 1), 4);
		this.da = rateLim(this.da, clamp(aCmd, -1, 1), 5);
		this.dr = rateLim(this.dr, clamp(rCmd, -1, 1), 4);
		this.flap = rateLim(this.flap, this.flapTarget, c.flapRate);
		if (c.retractable) this.gearPos = rateLim(this.gearPos, this.gearDown ? 1 : 0, 1 / c.gearTime);
		this.airbrake = rateLim(this.airbrake, ctl.airbrake ? 1 : 0, 1.2);
		this.brake = ctl.brake || (this.parkBrake ? 1 : 0);

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
		Cl += sf * (0.03 * Math.sin(this.time * 1.7 + 1.3) + 0.15 * beta) + this.gustRoll * c.Clda * c.daMax * 4;
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
		const Fb = new THREE.Vector3(Fya, -Fza, -Fxa - thrust);
		const Mb = new THREE.Vector3(Ma, -Na, -Lx);

		// world force
		const F = new THREE.Vector3()
			.addScaledVector(right, Fb.x).addScaledVector(up, Fb.y).addScaledVector(back, Fb.z);
		F.y -= c.mass * G;

		// ---- ground contact
		const contactF = new THREE.Vector3();
		let anyContact = false;
		const gearUsable = this.gearPos > 0.95;
		const Rinv = _q.copy(this.quat).invert();
		let tdLogged = false;
		for (let i = 0; i < c.gear.length; i++) {
			const g = c.gear[i];
			const st = this.gearState[i];
			st.contact = false; st.load = 0;
			if (!gearUsable) { st.comp = 0; continue; }
			const pb = new THREE.Vector3(g.p[0], g.p[1], g.p[2]);
			const pw = pb.clone().applyQuaternion(this.quat).add(this.pos);
			const hg = getHeight(pw.x, pw.z);
			const surf = Math.max(hg, 0);
			const pen0 = surf - pw.y;
			if (pen0 <= 0) { st.comp = Math.max(0, st.comp - dt * 2); continue; }
			if (hg < 0) { this.crash('Ditched in the water'); return; }
			const n = getNormal(pw.x, pw.z);
			const nv = new THREE.Vector3(n.x, n.y, n.z);
			const pen = pen0 * nv.y;
			const rel = pb.clone().applyQuaternion(this.quat);
			const vpt = this.vel.clone().add(new THREE.Vector3().copy(this.omega).applyQuaternion(this.quat).cross(rel));
			const vn = vpt.dot(nv);
			let Fn = this.gearK[i] * pen - this.gearC[i] * vn;
			if (pen > g.maxC) {
				Fn += this.gearK[i] * 25 * (pen - g.maxC);
				if (-vn > 3.8) { this.crash('Landing gear collapsed (hard landing)'); return; }
			}
			Fn = Math.max(0, Fn);
			// tyre forces
			const steer = g.steer ? clamp(ctl.yaw, -1, 1) * 0.55 * clamp(1 - V / 45, 0.15, 1) : 0;
			const fwdB = new THREE.Vector3(Math.sin(steer), 0, -Math.cos(steer)).applyQuaternion(this.quat);
			fwdB.addScaledVector(nv, -fwdB.dot(nv)).normalize();
			const side = new THREE.Vector3().crossVectors(fwdB, nv).normalize();
			const vf = vpt.dot(fwdB), vs = vpt.dot(side);
			const mu = 0.018 + (g.brake ? this.brake * 0.75 : 0);
			const Ff = -Math.sign(vf) * mu * Fn * Math.min(1, Math.abs(vf) / 0.35);
			const Fs = -Math.sign(vs) * 0.85 * Fn * Math.min(1, Math.abs(vs) / 0.2);
			const Fc = nv.clone().multiplyScalar(Fn).addScaledVector(fwdB, Ff).addScaledVector(side, Fs);
			contactF.add(Fc);
			const torqueW = new THREE.Vector3().crossVectors(rel, Fc);
			Mb.add(torqueW.applyQuaternion(Rinv));
			st.contact = true; st.comp = Math.min(pen, g.maxC * 1.2); st.load = Fn;
			st.wheelRot += vf * dt / g.r;
			anyContact = true;
			if (!this.onGround && this.airborneTime > 1.0 && !tdLogged) {
				tdLogged = true;
				this.events.push({ type: 'touchdown', vs: vn, speed: V });
			}
		}
		// hull / airframe contact points
		for (const hp of c.hull) {
			const pb = new THREE.Vector3(hp[0], hp[1], hp[2]);
			const rel = pb.clone().applyQuaternion(this.quat);
			const pw = rel.clone().add(this.pos);
			const hg = getHeight(pw.x, pw.z);
			const surf = Math.max(hg, 0);
			const pen = surf - pw.y;
			if (pen <= 0) continue;
			const speed = this.vel.length();
			if (hg < 0 && speed > 2) { this.crash('Ditched in the water'); return; }
			const vpt = this.vel.clone().add(new THREE.Vector3().copy(this.omega).applyQuaternion(this.quat).cross(rel));
			const scrape = hp[3] === 1;
			if (scrape ? (vpt.y < -3.5 || speed > 95) : (speed > 9 || vpt.y < -2.5)) { this.crash(this.gearPos < 0.95 ? 'Gear-up landing' : (scrape ? 'Tail strike' : 'Airframe struck terrain')); return; }
			if (scrape && speed > 5) this.events.push({ type: 'scrape', p: pw });
			const Fc = new THREE.Vector3(0, Math.max(0, 200000 * pen - 20000 * vpt.y), 0);
			const fr = vpt.clone(); fr.y = 0;
			Fc.addScaledVector(fr, -Math.min(30000, Fc.y * 0.6 / Math.max(fr.length(), 0.3)));
			contactF.add(Fc);
			Mb.add(new THREE.Vector3().crossVectors(rel, Fc).applyQuaternion(Rinv));
			anyContact = true;
		}
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
			const upN = new THREE.Vector3().copy(up).addScaledVector(vh, -vh.dot(up));
			if (upN.lengthSq() > 1e-6) {
				upN.normalize();
				const nzp = specific.dot(upN) / G;
				this.nzPath += (nzp - this.nzPath) * Math.min(1, dt / 0.05);
			}
		}

		// ---- integrate rotation (Euler's equations, diagonal inertia)
		const I = new THREE.Vector3(c.inertia.pitch, c.inertia.yaw, c.inertia.roll);
		const w0 = this.omega;
		const Iw = new THREE.Vector3(w0.x * I.x, w0.y * I.y, w0.z * I.z);
		const gyro = new THREE.Vector3().crossVectors(w0, Iw);
		const dw = Mb.sub(gyro);
		this.omega.x += dw.x / I.x * dt;
		this.omega.y += dw.y / I.y * dt;
		this.omega.z += dw.z / I.z * dt;
		// slight structural damping for stability on the ground
		if (anyContact) this.omega.multiplyScalar(1 - 0.5 * dt);
		const wq = new THREE.Quaternion(this.omega.x * dt * 0.5, this.omega.y * dt * 0.5, this.omega.z * dt * 0.5, 0);
		const dq = this.quat.clone().multiply(wq);
		this.quat.x += dq.x; this.quat.y += dq.y; this.quat.z += dq.z; this.quat.w += dq.w;
		this.quat.normalize();

		// structural limits
		if (!this.onGround && (this.nz > c.gLimit[0] * 1.5 + 0.5 || this.nz < c.gLimit[1] * 1.5 - 0.5)) {
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
		return t;
	}
}
