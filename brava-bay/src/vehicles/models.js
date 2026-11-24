// STUB (owned by the vehicles agent). Procedural vehicle meshes. See CONTRACT.md §Vehicles.
import * as THREE from 'three';
import { VEHICLE_SPECS } from './specs.js';

/**
 * Build a vehicle model. Local frame: +Z forward, +Y up, -X right; origin at ground level under the
 * centre of the wheelbase (so wheels touch y=0 at rest when suspension is at rest).
 */
export function buildVehicleModel(type, opts = {}) {
	const spec = VEHICLE_SPECS[type] || VEHICLE_SPECS.sedan;
	const d = spec.dims;
	const root = new THREE.Group();
	const body = new THREE.Group();
	root.add(body);
	const color = opts.color || spec.colors[0];
	const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.35 });
	const lower = new THREE.Mesh(new THREE.BoxGeometry(d.width, d.height * 0.5, d.length), paint);
	lower.position.y = d.wheelRadius + d.height * 0.2;
	const cab = new THREE.Mesh(new THREE.BoxGeometry(d.width * 0.86, d.height * 0.42, d.length * 0.5), new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.2, roughness: 0.1 }));
	cab.position.y = d.wheelRadius + d.height * 0.62;
	cab.position.z = -d.length * 0.05;
	lower.castShadow = cab.castShadow = true;
	body.add(lower, cab);
	const wheels = [];
	const wgeo = new THREE.CylinderGeometry(d.wheelRadius, d.wheelRadius, 0.24, 14); wgeo.rotateZ(Math.PI / 2);
	const wmat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 });
	const tw = d.width / 2 - 0.15;
	for (const [x, z] of [[tw, d.wheelBase / 2], [-tw, d.wheelBase / 2], [tw, -d.wheelBase / 2], [-tw, -d.wheelBase / 2]]) {
		const pivot = new THREE.Group();
		pivot.position.set(x, d.wheelRadius, z);
		const w = new THREE.Mesh(wgeo, wmat);
		w.castShadow = true;
		pivot.add(w);
		root.add(pivot);
		wheels.push({ pivot, mesh: w });
	}
	const mk = (c) => new THREE.MeshBasicMaterial({ color: c });
	const head = [], tail = [];
	for (const s of [-1, 1]) {
		const h = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.05), mk(0xfff4d6)); h.position.set(s * d.width * 0.32, d.wheelRadius + d.height * 0.3, d.length / 2 + 0.01); body.add(h); head.push(h);
		const t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05), mk(0x550000)); t.position.set(s * d.width * 0.34, d.wheelRadius + d.height * 0.32, -d.length / 2 - 0.01); body.add(t); tail.push(t);
	}
	return {
		root, body, wheels, // wheels order: FL, FR, RL, RR (FL = +X side = driver's left)
		lights: { head, tail, brake: tail, reverse: [], indicatorL: [], indicatorR: [], siren: [] },
		paintMaterials: [paint],
		dims: { ...d, track: tw * 2 },
		seats: [new THREE.Vector3(0.38, d.wheelRadius + 0.35, -0.2), new THREE.Vector3(-0.38, d.wheelRadius + 0.35, -0.2)],
		doors: { left: new THREE.Vector3(d.width / 2 + 0.6, 0, 0.1), right: new THREE.Vector3(-d.width / 2 - 0.6, 0, 0.1) },
		steeringWheel: null,
		setColor(c) { paint.color.set(c); },
		update() {},
		dispose() { root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); },
	};
}
