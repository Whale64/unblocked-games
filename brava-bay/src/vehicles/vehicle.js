// STUB (owned by the vehicles agent). Vehicle entity + manager. See CONTRACT.md §Vehicles for the full API.
import * as THREE from 'three';
import { VEHICLE_SPECS } from './specs.js';
import { buildVehicleModel } from './models.js';
import { VehiclePhysics } from './physics.js';

let NEXT_ID = 1;

export class Vehicle {
	constructor(game, type, opts = {}) {
		this.game = game;
		this.kind = 'vehicle';
		this.id = NEXT_ID++;
		this.type = VEHICLE_SPECS[type] ? type : 'sedan';
		this.spec = VEHICLE_SPECS[this.type];
		this.color = opts.color || this.spec.colors[Math.floor(Math.random() * this.spec.colors.length)];
		this.model = buildVehicleModel(this.type, { color: this.color, seed: this.id });
		this.object3d = this.model.root;
		this.position = new THREE.Vector3();
		this.quaternion = new THREE.Quaternion();
		this.velocity = new THREE.Vector3();
		this.angularVelocity = new THREE.Vector3();
		this.yaw = 0;
		this.speed = 0;
		this.radius = Math.hypot(this.spec.dims.length, this.spec.dims.width) / 2;
		this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false };
		this.driver = null;
		this.passengers = [];
		this.ai = null;
		this.isPolice = !!this.spec.police;
		this.sirenOn = false;
		this.lightsOn = false;
		this.indicator = 0;
		this.health = 1000;
		this.maxHealth = 1000;
		this.onFire = false;
		this.destroyed = false;
		this.inWater = false;
		this.upsideDown = false;
		this.onGround = true;
		this.persistent = !!opts.persistent;
		this.engine = { rpm: 900, load: 0, gear: 1, running: true };
		this.skid = 0;
		this.wheels = [0, 1, 2, 3].map(() => ({ contact: true, slip: 0, surface: 'road', worldPos: new THREE.Vector3() }));
		this.physics = new VehiclePhysics(this, game);
		this.alive = true;
	}
	place(x, z, yaw, y) {
		this.position.set(x, y !== undefined ? y : this.game.collision.groundHeight(x, z), z);
		this.yaw = yaw;
		this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
		this.velocity.set(0, 0, 0);
		this.speed = 0;
		this.syncObject();
	}
	syncObject() {
		this.quaternion.setFromAxisAngle(_up, this.yaw);
		this.object3d.position.copy(this.position);
		this.object3d.quaternion.copy(this.quaternion);
	}
	update(dt) {
		if (!this.destroyed) this.physics.step(dt);
		this.syncObject();
	}
	damage(amount, info = {}) {
		if (this.destroyed) return;
		this.health -= amount;
		if (this.health <= 0) this.explode(info.source || null);
	}
	explode(source = null) {
		if (this.destroyed) return;
		this.destroyed = true;
		this.health = 0;
		this.alive = false;
		this.game.events.emit('explosion', { x: this.position.x, y: this.position.y + 0.8, z: this.position.z, radius: 8, source, vehicle: this });
	}
	repair() { this.health = this.maxHealth; this.onFire = false; }
	setColor(c) { this.color = c; this.model.setColor(c); }
	setLights(on) { this.lightsOn = on; }
	setSiren(on) { this.sirenOn = on && this.isPolice; }
	/** World position of seat i (0 = driver). */
	getSeatWorld(i, out = new THREE.Vector3()) { return out.copy(this.model.seats[Math.min(i, this.model.seats.length - 1)]).applyQuaternion(this.quaternion).add(this.position); }
	/** World position where a character stands to open the door ('left' = driver side). */
	getDoorWorld(side = 'left', out = new THREE.Vector3()) { return out.copy(this.model.doors[side]).applyQuaternion(this.quaternion).add(this.position); }
	dispose() {
		this.game.scene.remove(this.object3d);
		this.model.dispose();
	}
}
const _up = new THREE.Vector3(0, 1, 0);

export class VehicleManager {
	constructor(game) {
		this.game = game;
		this.list = [];
		this.types = Object.keys(VEHICLE_SPECS);
	}
	async init() {}
	/** Spawn a vehicle on the ground at (x,z) facing yaw. opts: { color, persistent, y } */
	spawn(type, x, z, yaw = 0, opts = {}) {
		const v = new Vehicle(this.game, type, opts);
		v.place(x, z, yaw, opts.y);
		this.game.scene.add(v.object3d);
		this.list.push(v);
		this.game.events.emit('vehicleSpawned', { vehicle: v });
		return v;
	}
	remove(v) {
		const i = this.list.indexOf(v);
		if (i >= 0) this.list.splice(i, 1);
		v.dispose();
		this.game.events.emit('vehicleRemoved', { vehicle: v });
	}
	nearest(x, z, maxDist = 6, filter = null) {
		let best = null, bd = maxDist * maxDist;
		for (const v of this.list) {
			if (filter && !filter(v)) continue;
			const d = (v.position.x - x) ** 2 + (v.position.z - z) ** 2;
			if (d < bd) { bd = d; best = v; }
		}
		return best;
	}
	update(dt) {
		for (const v of this.list) v.update(dt);
	}
}
