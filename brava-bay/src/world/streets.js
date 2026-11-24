// STUB (owned by the streets agent). Road surfaces, markings, sidewalks/curbs, street furniture, signals.
import * as THREE from 'three';
import { WORLD } from './citygen.js';

export class Streets {
	constructor(game) { this.game = game; }
	async init() {
		const g = this.game, city = g.city;
		const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
		// road rects (excluding bridges' elevated part: drawn as flat; nature draws bridge decks)
		const plane = new THREE.PlaneGeometry(1, 1); plane.rotateX(-Math.PI / 2);
		const roads = new THREE.InstancedMesh(plane, new THREE.MeshStandardMaterial({ color: 0x2c2d30, roughness: 0.92 }), city.edges.length);
		city.edges.forEach((e, i) => {
			const r = e.rect;
			const isBridge = e.bridge !== null;
			m.compose(p.set((r.minX + r.maxX) / 2, isBridge ? 0.005 : 0.005, (r.minZ + r.maxZ) / 2), q, s.set(r.maxX - r.minX, 1, r.maxZ - r.minZ));
			roads.setMatrixAt(i, m);
		});
		roads.receiveShadow = true;
		g.scene.add(roads);
		// blocks (sidewalk + lot slab) and walkways
		const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, -0.5, 0);
		const rects = [...city.blocks, ...city.walkways];
		const slabs = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xb9b4aa, roughness: 0.9 }), rects.length);
		rects.forEach((b, i) => {
			m.compose(p.set((b.minX + b.maxX) / 2, WORLD.curb, (b.minZ + b.maxZ) / 2), q, s.set(b.maxX - b.minX, 1, b.maxZ - b.minZ));
			slabs.setMatrixAt(i, m);
		});
		slabs.receiveShadow = true;
		g.scene.add(slabs);
		// streetlights as thin poles
		const L = city.props.streetlights;
		const pole = new THREE.CylinderGeometry(0.08, 0.12, 1, 5); pole.translate(0, 0.5, 0);
		const poles = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ color: 0x555a60, metalness: 0.6, roughness: 0.4 }), L.length);
		L.forEach((l, i) => { m.compose(p.set(l.x, l.y !== undefined ? l.y : WORLD.curb, l.z), q, s.set(1, l.h, 1)); poles.setMatrixAt(i, m); });
		g.scene.add(poles);
		this.poles = poles;
	}
	update() {}
}
