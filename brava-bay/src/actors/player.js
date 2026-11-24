// STUB (owned by the characters agent). Player controller: on foot, entering/exiting/driving vehicles,
// health/armor/money, death & arrest hooks. See CONTRACT.md §Player.
import * as THREE from 'three';
import { buildCharacter } from './charmodel.js';
import { CharacterAnimator } from './charanim.js';
import { damp } from '../core/math.js';

export class Player {
	constructor(game) {
		this.game = game;
		this.kind = 'player';
		this.position = new THREE.Vector3();
		this.velocity = new THREE.Vector3();
		this.yaw = 0;
		this.radius = 0.35;
		this.health = 100; this.maxHealth = 100;
		this.armor = 0; this.maxArmor = 100;
		this.money = 500;
		this.alive = true;
		this.active = false;       // true once spawned
		this.vehicle = null;       // Vehicle being driven
		this.state = 'foot';       // foot | entering | driving | exiting | ragdoll | dead | swimming
		this.grounded = true;
		this.aiming = false;
		this.sprinting = false;
	}
	async init() {
		this.model = buildCharacter({ role: 'player', seed: 7 });
		this.object3d = this.model.root;
		this.animator = new CharacterAnimator(this.model);
		this.object3d.visible = false;
		this.game.scene.add(this.object3d);
	}
	get inVehicle() { return !!this.vehicle; }
	spawn(x, z, yaw = 0) {
		this.position.set(x, this.game.collision.groundHeight(x, z), z);
		this.yaw = yaw;
		this.health = this.maxHealth;
		this.alive = true;
		this.active = true;
		this.state = 'foot';
		this.object3d.visible = true;
		if (this.game.cameraRig) this.game.cameraRig.snapBehind && this.game.cameraRig.snapBehind();
	}
	respawn(x, z, yaw = 0) {
		if (this.vehicle) this.exitVehicle({ instant: true });
		this.spawn(x, z, yaw);
	}
	teleport(x, z, yaw = this.yaw) {
		if (this.vehicle) { this.vehicle.place(x, z, yaw); return; }
		this.position.set(x, this.game.collision.groundHeight(x, z), z);
		this.yaw = yaw;
	}
	addMoney(delta, reason = '') {
		this.money = Math.max(0, Math.round(this.money + delta));
		this.game.events.emit('moneyChanged', { amount: this.money, delta, reason });
	}
	damage(amount, info = {}) {
		if (!this.alive) return;
		const a = Math.min(this.armor, amount * 0.7);
		this.armor -= a;
		this.health -= amount - a;
		this.game.events.emit('playerDamaged', { amount, info });
		if (this.health <= 0) this.die(info);
	}
	heal(amount) { this.health = Math.min(this.maxHealth, this.health + amount); }
	die(info = {}) {
		if (!this.alive) return;
		this.alive = false;
		this.health = 0;
		this.state = 'dead';
		this.game.events.emit('playerDied', { cause: info.type || 'unknown', info });
	}
	arrest() {
		if (!this.alive) return;
		this.game.events.emit('playerArrested', {});
	}
	onVehicleHit(vehicle, speed) {
		if (speed > 4) this.damage(speed * 3, { type: 'collision', source: vehicle });
	}
	enterVehicle(v, opts = {}) {
		if (!v || v.destroyed) return;
		const prevDriver = v.driver;
		const carjack = !!(prevDriver && prevDriver !== 'player');
		v.driver = 'player';
		v.persistent = true;
		this.vehicle = v;
		this.state = 'driving';
		this.object3d.visible = false;
		this.game.events.emit('playerEnterVehicle', { vehicle: v, carjack, previousDriver: prevDriver });
		void opts;
	}
	exitVehicle(opts = {}) {
		const v = this.vehicle;
		if (!v) return;
		v.driver = null;
		v.controls.throttle = 0; v.controls.brake = 1; v.controls.steer = 0; v.controls.handbrake = true;
		const door = v.getDoorWorld('left', new THREE.Vector3());
		this.position.set(door.x, this.game.collision.groundHeight(door.x, door.z), door.z);
		this.vehicle = null;
		this.state = 'foot';
		this.object3d.visible = true;
		this.game.events.emit('playerExitVehicle', { vehicle: v });
		void opts;
	}
	update(dt) {
		const g = this.game, input = g.input;
		if (!this.active || !this.alive) return;
		if (this.vehicle) {
			const v = this.vehicle, c = v.controls;
			c.throttle = input.axis('throttle') - input.axis('brake');
			c.brake = 0;
			c.steer = input.axis('steer');
			c.handbrake = input.down('handbrake');
			c.horn = input.down('horn');
			if (input.pressed('enter') && Math.abs(v.speed) < 8) this.exitVehicle();
			return;
		}
		// on foot: camera-relative movement
		const camYaw = g.cameraRig ? g.cameraRig.yaw : 0;
		const mx = input.axis('moveX'), my = input.axis('moveY');
		const fx = Math.sin(camYaw), fz = Math.cos(camYaw), rx = -fz, rz = fx;
		let dx = fx * my + rx * mx, dz = fz * my + rz * mx;
		const len = Math.hypot(dx, dz);
		this.sprinting = input.down('sprint');
		const speed = len > 0.01 ? (this.sprinting ? 7 : 3.6) : 0;
		if (len > 0.01) { dx /= len; dz /= len; this.yaw = Math.atan2(dx, dz); }
		this.velocity.x = damp(this.velocity.x, dx * speed, 10, dt);
		this.velocity.z = damp(this.velocity.z, dz * speed, 10, dt);
		this.position.x += this.velocity.x * dt;
		this.position.z += this.velocity.z * dt;
		const gy = g.collision.groundHeight(this.position.x, this.position.z, this.position.y + 0.6);
		this.position.y = gy;
		const r = g.collision.resolveCircle(this.position.x, this.position.z, this.radius, gy + 0.35, gy + 1.8);
		this.position.x = r.x; this.position.z = r.z;
		if (input.pressed('enter')) {
			const v = g.vehicles.nearest(this.position.x, this.position.z, 4.5, (v) => !v.destroyed);
			if (v) this.enterVehicle(v);
		}
	}
	postUpdate(dt) {
		if (this.vehicle) {
			this.position.copy(this.vehicle.position);
			this.yaw = this.vehicle.yaw;
		}
		this.object3d.position.copy(this.position);
		this.object3d.rotation.y = this.yaw;
		this.animator.update(dt, { speed: Math.hypot(this.velocity.x, this.velocity.z), dead: !this.alive });
	}
}
