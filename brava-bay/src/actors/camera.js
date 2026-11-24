// STUB (owned by the characters agent). Camera rig: on-foot orbit, vehicle chase, aim, cinematic (menu), death.
import * as THREE from 'three';
import { damp, dampAngle, clamp } from '../core/math.js';

export class CameraRig {
	constructor(game) {
		this.game = game;
		this.mode = 'cinematic';   // foot | vehicle | aim | cinematic | death
		this.yaw = 0;              // orbit yaw (camera looks along forward(yaw))
		this.pitch = -0.15;
		this.distance = 4.5;
		this.target = new THREE.Vector3();
		this._t = 0;
	}
	async init() {}
	snapBehind() { this.yaw = this.game.player.yaw; }
	/** Shake the camera: intensity 0..1, duration seconds. */
	shake(intensity = 0.5, duration = 0.4) { void intensity; void duration; }
	/** Ray from the screen centre (for aiming). */
	aimRay(origin, dir) {
		origin.copy(this.game.camera.position);
		this.game.camera.getWorldDirection(dir);
	}
	update(dt) {
		const g = this.game, cam = g.camera, p = g.player;
		this._t += dt;
		if (g.state === 'menu' || !p.active) {
			// slow orbit around downtown
			const a = this._t * 0.03;
			cam.position.set(120 + Math.cos(a) * 420, 140, -120 + Math.sin(a) * 420);
			cam.lookAt(80, 40, -150);
			return;
		}
		const input = g.input;
		this.yaw -= input.axis('lookX') * 0.0025;
		this.pitch = clamp(this.pitch - input.axis('lookY') * 0.0025, -1.2, 0.5);
		if (p.vehicle) {
			const v = p.vehicle;
			this.yaw = dampAngle(this.yaw, v.yaw, 3, dt);
			const dist = 7 + Math.abs(v.speed) * 0.05;
			this.target.set(v.position.x, v.position.y + 1.6, v.position.z);
			cam.position.set(this.target.x - Math.sin(this.yaw) * dist, this.target.y + 1.4, this.target.z - Math.cos(this.yaw) * dist);
			cam.lookAt(this.target);
			this.mode = 'vehicle';
			return;
		}
		this.mode = 'foot';
		this.target.set(p.position.x, damp(this.target.y || p.position.y + 1.6, p.position.y + 1.6, 10, dt), p.position.z);
		const cp = Math.cos(this.pitch);
		cam.position.set(this.target.x - Math.sin(this.yaw) * this.distance * cp, this.target.y - Math.sin(this.pitch) * this.distance, this.target.z - Math.cos(this.yaw) * this.distance * cp);
		cam.lookAt(this.target);
	}
}
