// STUB (owned by the nature/water agent). Ocean & bay surface.
import * as THREE from 'three';
import { WORLD } from './citygen.js';

export class Water {
	constructor(game) { this.game = game; }
	async init() {
		const geo = new THREE.PlaneGeometry(8000, 8000);
		geo.rotateX(-Math.PI / 2);
		this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x1b6f8a, roughness: 0.15, metalness: 0.0, transparent: true, opacity: 0.88 }));
		this.mesh.position.y = WORLD.waterY;
		this.mesh.renderOrder = 1;
		this.game.scene.add(this.mesh);
	}
	update() {
		const c = this.game.camera.position;
		this.mesh.position.x = Math.round(c.x / 50) * 50;
		this.mesh.position.z = Math.round(c.z / 50) * 50;
	}
}
