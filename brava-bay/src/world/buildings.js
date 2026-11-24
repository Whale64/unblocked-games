// STUB (owned by the buildings agent). Building geometry, facades, rooftops, landmarks, lot dressing.
import * as THREE from 'three';
import { WORLD } from './citygen.js';

export class Buildings {
	constructor(game) { this.game = game; }
	async init() {
		const g = this.game, city = g.city;
		const boxes = [];
		for (const b of city.buildings) {
			boxes.push({ x: b.x, z: b.z, w: b.w, d: b.d, y0: WORLD.curb, h: b.h, color: b.color });
			if (b.tower) boxes.push({ x: b.tower.x, z: b.tower.z, w: b.tower.w, d: b.tower.d, y0: WORLD.curb + b.h, h: b.tower.h - b.h, color: b.color });
		}
		for (const c of city.containers) boxes.push({ x: c.x, z: c.z, w: c.w, d: c.d, y0: WORLD.curb, h: c.h, color: c.colors[0] });
		const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
		const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.7 }), boxes.length);
		const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
		boxes.forEach((b, i) => {
			m.compose(p.set(b.x, b.y0, b.z), q, s.set(b.w, b.h, b.d));
			mesh.setMatrixAt(i, m);
			mesh.setColorAt(i, col.set(b.color));
		});
		mesh.castShadow = mesh.receiveShadow = true;
		g.scene.add(mesh);
	}
	update() {}
}
