// Initial-condition helpers: places the aircraft on a runway, on final approach or in cruise,
// with a trimmed angle of attack and the throttle needed for the requested speed.
import * as THREE from 'three';
import { airports, fromRunwayLocal } from './world.js';
import { isa } from './physics.js';

const D = Math.PI / 180;

export function trimState(cfg, speed, alt, flap, gamma = 0) {
	const rho = isa(alt).rho;
	const q = 0.5 * rho * speed * speed;
	const CL = cfg.mass * 9.80665 * Math.cos(gamma) / (q * cfg.S);
	const alpha = (CL - cfg.CL0 - cfg.flapCL * flap) / cfg.CLa;
	const de = -(cfg.Cm0 + cfg.Cma * alpha + cfg.flapCm * flap) / (cfg.Cmde * cfg.deMax);
	return { alpha, de, CL, q };
}

// Throttle setting that balances drag on the given flight path (jets); props use fixed settings.
function trimThrottle(cfg, speed, alt, flap, gear, gamma) {
	if (cfg.engine === 'prop') return gamma < 0 ? 0.4 : 0.75;
	const atm = isa(alt);
	const t = trimState(cfg, speed, alt, flap, gamma);
	const CD = cfg.CD0 + cfg.K * t.CL * t.CL + cfg.flapCD * flap + cfg.gearCD * gear + 1.25 * 0.25 * Math.pow(Math.sin(t.alpha), 2);
	const drag = t.q * cfg.S * CD;
	const need = drag + cfg.mass * 9.80665 * Math.sin(gamma);
	const mach = speed / atm.a;
	const lapse = Math.pow(atm.rho / 1.225, 0.75) * (1 + (cfg.ramFactor ?? 0.35) * mach + ((cfg.ramFactor ?? 0) < 0 ? 0.12 * mach * mach : 0));
	const frac = need / (cfg.thrustDry * lapse);
	const e = Math.sqrt(Math.max(0, (frac - 0.05) / 0.95));
	return Math.min(1, cfg.afterburner === false ? e : e * 0.92);
}

export function spawnAircraft(fm, cfg, kind, airportIndex = 0) {
	const ap = airports[Math.min(airportIndex, airports.length - 1)];
	const hl = ap.length / 2;
	const hdg = ap.heading;
	const big = cfg.category === 'airliner';
	if (kind === 'runway') {
		const p = fromRunwayLocal(ap, -hl + (big ? 70 : 45), 0);
		fm.reset({ pos: new THREE.Vector3(p.x, ap.elev, p.z), heading: hdg, speed: 0, onGround: true, gearDown: true, flaps: cfg.takeoffFlap ?? 0.33, throttle: 0 });
		fm.parkBrake = false;
		const t = trimState(cfg, cfg.vr / 1.94384 * 1.15, ap.elev, fm.flap);
		fm.trim = Math.max(-0.4, Math.min(0.4, t.de));
		return;
	}
	if (kind === 'approach') {
		const dist = big ? 14000 : cfg.engine === 'jet' ? 11000 : 7000;
		const gamma = -3 * D;
		const p = fromRunwayLocal(ap, -hl + 300 - dist, 0);
		const y = ap.elev + 15 + dist * Math.tan(3 * D);
		const v = cfg.vapp / 1.94384;
		const flap = cfg.approachFlap ?? 1;
		const t = trimState(cfg, v, y, flap, gamma);
		fm.reset({ pos: new THREE.Vector3(p.x, y, p.z), heading: hdg, speed: v, onGround: false, gearDown: true, flaps: flap, throttle: 0, pitch: (t.alpha + gamma) / D });
		const dir = new THREE.Vector3(ap.dir.x * Math.cos(gamma), Math.sin(gamma), ap.dir.z * Math.cos(gamma));
		fm.vel.copy(dir).multiplyScalar(v);
		fm.trim = Math.max(-1, Math.min(1, t.de));
		fm.lawI = t.de;
		fm.de = t.de;
		const throttle = trimThrottle(cfg, v, y, flap, 1, gamma);
		fm.engine = cfg.afterburner === false ? throttle : throttle / 0.92;
		return { throttle };
	}
	// cruise, inbound to the airport
	const dist = big ? 20000 : 14000;
	const p = fromRunwayLocal(ap, -hl - dist, 0);
	const y = ap.elev + (big ? 2400 : cfg.engine === 'jet' ? 1800 : 900);
	const v = big ? 118 : cfg.engine === 'jet' ? 190 : 58;
	return spawnAirborne(fm, cfg, new THREE.Vector3(p.x, y, p.z), hdg, v);
}

// Level, trimmed flight at a given position, heading (deg) and true airspeed (m/s), clean configuration.
export function spawnAirborne(fm, cfg, pos, headingDeg, v) {
	const hd = headingDeg * D;
	const t = trimState(cfg, v, pos.y, 0);
	fm.reset({ pos: pos.clone(), heading: headingDeg, speed: v, onGround: false, gearDown: !cfg.retractable, flaps: 0, throttle: 0, pitch: t.alpha / D });
	fm.vel.set(Math.sin(hd), 0, -Math.cos(hd)).multiplyScalar(v); // level flight path, nose at the trim angle of attack
	fm.trim = Math.max(-1, Math.min(1, t.de));
	fm.lawI = t.de;
	fm.de = t.de;
	const throttle = trimThrottle(cfg, v, pos.y, 0, cfg.retractable ? 0 : 1, 0);
	fm.engine = cfg.afterburner === false ? throttle : Math.min(1, throttle / 0.92);
	return { throttle };
}
