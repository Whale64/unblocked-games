// STUB (owned by the characters agent). Procedural humanoid. See CONTRACT.md §Characters.
import * as THREE from 'three';

/**
 * Build a character. Local frame: +Z forward, +Y up; origin at the feet.
 * opts: { seed, sex: 'm'|'f', role: 'civilian'|'cop'|'player', skin, hair, top, bottom, shoes, height }
 */
export function buildCharacter(opts = {}) {
	const root = new THREE.Group();
	const top = new THREE.MeshStandardMaterial({ color: opts.top || (opts.role === 'cop' ? '#1d2f4f' : '#d0573a'), roughness: 0.8 });
	const skin = new THREE.MeshStandardMaterial({ color: opts.skin || '#c68b62', roughness: 0.7 });
	const bottom = new THREE.MeshStandardMaterial({ color: opts.bottom || '#2c3442', roughness: 0.85 });
	const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.6, 4, 8), top);
	body.position.y = 1.15;
	const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.6, 4, 8), bottom);
	legs.position.y = 0.5;
	const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skin);
	head.position.y = 1.65;
	for (const m of [body, legs, head]) { m.castShadow = true; root.add(m); }
	const bones = { hips: legs, spine: body, chest: body, head };
	return { root, bones, height: 1.75, materials: { top, skin, bottom }, dispose() { root.traverse((o) => o.geometry && o.geometry.dispose()); } };
}
