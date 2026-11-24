// STUB (owned by the vehicles agent). Simple kinematic car model so the game runs before the real
// raycast-suspension rigid-body model lands. See CONTRACT.md §Vehicles.
import { clamp } from '../core/math.js';

export class VehiclePhysics {
	constructor(vehicle, game) {
		this.v = vehicle;
		this.game = game;
		this.contacts = [];
	}
	step(dt) {
		const v = this.v, c = v.controls, spec = v.spec;
		const accel = (spec.power * 1000) / (spec.mass * Math.max(4, Math.abs(v.speed))) ;
		let a = 0;
		if (c.throttle > 0) a += Math.min(accel, 8) * c.throttle;
		if (c.throttle < 0) a += v.speed > 0.5 ? -9 * -c.throttle : -4 * -c.throttle;
		if (c.brake > 0) a -= Math.sign(v.speed) * 10 * c.brake;
		if (c.handbrake) a -= Math.sign(v.speed) * 6;
		a -= v.speed * 0.02 + Math.sign(v.speed) * 0.3;
		v.speed = clamp(v.speed + a * dt, -12, spec.topSpeed);
		if (Math.abs(v.speed) < 0.05 && c.throttle === 0) v.speed = 0;
		const steer = c.steer * 0.55 / (1 + Math.abs(v.speed) * 0.04);
		v.yaw -= (v.speed / v.spec.dims.wheelBase) * Math.tan(steer) * dt;
		const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
		v.position.x += fx * v.speed * dt;
		v.position.z += fz * v.speed * dt;
		v.velocity.set(fx * v.speed, 0, fz * v.speed);
		// static collisions
		const d = v.spec.dims;
		const g = this.game;
		g.collision.collideOBB(v.position.x, v.position.z, v.yaw, d.width / 2, d.length / 2, v.position.y + 0.3, v.position.y + d.height, this.contacts);
		for (const ct of this.contacts) {
			if (ct.collider.breakable && Math.abs(v.speed) > 4) {
				g.collision.breakCollider(ct.collider);
				g.events.emit('propBroken', { collider: ct.collider, prop: ct.collider.ref, vehicle: v, impulse: Math.abs(v.speed) * 50 });
				continue;
			}
			v.position.x += ct.nx * ct.depth;
			v.position.z += ct.nz * ct.depth;
			const impact = Math.abs(v.speed);
			if (impact > 3) g.events.emit('vehicleCollision', { vehicle: v, other: 'static', impulse: impact * spec.mass, point: { x: ct.px, y: v.position.y + 0.6, z: ct.pz }, normal: { x: ct.nx, y: 0, z: ct.nz } });
			v.speed *= 0.3;
		}
		v.position.y = g.collision.groundHeight(v.position.x, v.position.z, v.position.y + 1);
		v.onGround = true;
		v.engine.rpm = 900 + Math.abs(v.speed) * 120;
		v.engine.load = Math.abs(c.throttle);
	}
}
