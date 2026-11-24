// STUB (owned by the nature/water agent). Terrain/seabed, beach, parks, palms, trees, bushes, bridges, pier.
import * as THREE from 'three';
import { WORLD } from './citygen.js';

export class Nature {
	constructor(game) { this.game = game; }
	async init() {
		const g = this.game, city = g.city;
		// terrain heightfield (coarse)
		const N = 220, S = 2800;
		const geo = new THREE.PlaneGeometry(S, S, N, N);
		geo.rotateX(-Math.PI / 2);
		const pos = geo.attributes.position;
		const col = new Float32Array(pos.count * 3);
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i), z = pos.getZ(i);
			const y = city.naturalHeight(x, z);
			pos.setY(i, Math.min(y, -0.02));
			const t = city.naturalSurface(x, z, y);
			const c = t === 'sand' ? [0.86, 0.78, 0.6] : t === 'water' ? [0.7, 0.66, 0.5] : t === 'concrete' ? [0.6, 0.6, 0.58] : [0.35, 0.5, 0.25];
			col.set(c, i * 3);
		}
		geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
		geo.computeVertexNormals();
		const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
		ground.receiveShadow = true;
		g.scene.add(ground);

		// palms as instanced trunks + crowns
		const palms = city.props.palms;
		const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1, 6); trunkGeo.translate(0, 0.5, 0);
		const crownGeo = new THREE.SphereGeometry(1.8, 8, 5); crownGeo.scale(1, 0.45, 1);
		const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x8a7556, roughness: 0.9 }), palms.length);
		const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x3f7a2e, roughness: 0.8 }), palms.length);
		const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
		palms.forEach((pl, i) => {
			const y = g.collision.groundHeight(pl.x, pl.z);
			m.compose(p.set(pl.x, y, pl.z), q.identity(), s.set(1, pl.h, 1)); trunks.setMatrixAt(i, m);
			m.compose(p.set(pl.x, y + pl.h, pl.z), q, s.set(1, 1, 1)); crowns.setMatrixAt(i, m);
		});
		trunks.castShadow = crowns.castShadow = true;
		g.scene.add(trunks, crowns);

		// bridges (deck boxes)
		for (const b of city.bridges) {
			const segs = 40;
			const geoB = new THREE.BoxGeometry(1, 1, 1);
			const deck = new THREE.InstancedMesh(geoB, new THREE.MeshStandardMaterial({ color: 0x9a9a96 }), segs);
			for (let i = 0; i < segs; i++) {
				const x0 = b.x0 - 20 + (i / segs) * (b.x1 - b.x0 + 40), x1 = b.x0 - 20 + ((i + 1) / segs) * (b.x1 - b.x0 + 40);
				const y = (b.heightAt(x0) + b.heightAt(x1)) / 2;
				m.compose(p.set((x0 + x1) / 2, y - 0.6, b.z), q.identity(), s.set(x1 - x0 + 0.2, 1.2, b.deckWidth));
				deck.setMatrixAt(i, m);
			}
			g.scene.add(deck);
		}
		void WORLD;
	}
	update() {}
}
