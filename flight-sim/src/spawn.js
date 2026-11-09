// Initial-condition helpers: places the aircraft on a runway, on final approach or in cruise,
// with a trimmed angle of attack for the requested speed.
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
	return { alpha, de };
}

export function spawnAircraft(fm, cfg, kind, airportIndex = 0) {
	const ap = airports[Math.min(airportIndex, airports.length - 1)];
	const hl = ap.length / 2;
	const hdg = ap.heading;
	if (kind === 'runway') {
		const p = fromRunwayLocal(ap, -hl + 45, 0);
		fm.reset({ pos: new THREE.Vector3(p.x, ap.elev, p.z), heading: hdg, speed: 0, onGround: true, gearDown: true, flaps: cfg.engine === 'prop' ? 0.33 : 0.5, throttle: 0 });
		fm.parkBrake = false;
		const t = trimState(cfg, cfg.vr / 1.94384 * 1.15, ap.elev, fm.flap);
		fm.trim = Math.max(-0.4, Math.min(0.4, t.de));
		return;
	}
	if (kind === 'approach') {
		const dist = cfg.engine === 'jet' ? 11000 : 7000;
		const gamma = -3 * D;
		const p = fromRunwayLocal(ap, -hl + 300 - dist, 0);
		const y = ap.elev + 15 + dist * Math.tan(3 * D);
		const v = cfg.vapp / 1.94384;
		const flap = 1;
		const t = trimState(cfg, v, y, flap, gamma);
		fm.reset({ pos: new THREE.Vector3(p.x, y, p.z), heading: hdg, speed: v, onGround: false, gearDown: true, flaps: flap, throttle: 0, pitch: (t.alpha + gamma) / D });
		const dir = new THREE.Vector3(ap.dir.x * Math.cos(gamma), Math.sin(gamma), ap.dir.z * Math.cos(gamma));
		fm.vel.copy(dir).multiplyScalar(v);
		fm.trim = Math.max(-1, Math.min(1, t.de));
		fm.lawI = t.de;
		fm.de = t.de;
		return { throttle: cfg.engine === 'jet' ? 0.45 : 0.4 };
	}
	// cruise
	const dist = 14000;
	const p = fromRunwayLocal(ap, -hl - dist, 0);
	const y = ap.elev + (cfg.engine === 'jet' ? 1800 : 900);
	const v = cfg.engine === 'jet' ? 190 : 58;
	const t = trimState(cfg, v, y, 0);
	fm.reset({ pos: new THREE.Vector3(p.x, y, p.z), heading: hdg, speed: v, onGround: false, gearDown: false, flaps: 0, throttle: 0, pitch: t.alpha / D });
	fm.trim = Math.max(-1, Math.min(1, t.de));
	fm.lawI = t.de;
	fm.de = t.de;
	return { throttle: cfg.engine === 'jet' ? 0.7 : 0.75 };
}
