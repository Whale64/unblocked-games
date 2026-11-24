// STUB (owned by the rendering agent). Sun/moon light with shadows, ambient, and the dynamic light pool.
import * as THREE from 'three';

export class Lighting {
	constructor(game) {
		this.game = game;
		this.points = [];
		this.spots = [];
		this._freePoints = [];
		this._freeSpots = [];
	}
	async init() {
		const g = this.game;
		this.hemi = new THREE.HemisphereLight(0xbfdcff, 0x5a5040, 0.9);
		g.scene.add(this.hemi);
		this.sun = new THREE.DirectionalLight(0xffffff, 3);
		this.sun.castShadow = g.quality.shadows > 0;
		if (this.sun.castShadow) {
			this.sun.shadow.mapSize.set(g.quality.shadows, g.quality.shadows);
			const s = g.quality.shadowDistance * 0.5;
			Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 800 });
			this.sun.shadow.bias = -0.0005;
		}
		g.scene.add(this.sun, this.sun.target);
		const nP = g.quality.key === 'low' ? 2 : 6, nS = g.quality.key === 'low' ? 0 : 2;
		for (let i = 0; i < nP; i++) { const l = new THREE.PointLight(0xffffff, 0, 20, 2); g.scene.add(l); this.points.push(l); this._freePoints.push(l); }
		for (let i = 0; i < nS; i++) { const l = new THREE.SpotLight(0xffffff, 0, 60, 0.5, 0.5, 1.5); g.scene.add(l, l.target); this.spots.push(l); this._freeSpots.push(l); }
	}
	/** Borrow a point light from the fixed pool (null if none free). Set intensity 0 / release when done. */
	acquirePoint() { return this._freePoints.pop() || null; }
	releasePoint(l) { if (!l) return; l.intensity = 0; if (!this._freePoints.includes(l)) this._freePoints.push(l); }
	acquireSpot() { return this._freeSpots.pop() || null; }
	releaseSpot(l) { if (!l) return; l.intensity = 0; if (!this._freeSpots.includes(l)) this._freeSpots.push(l); }
	update() {
		const g = this.game, sky = g.sky;
		const c = g.camera.position;
		this.sun.position.set(c.x + sky.sunDir.x * 400, c.y + sky.sunDir.y * 400, c.z + sky.sunDir.z * 400);
		this.sun.target.position.set(c.x, c.y, c.z);
		this.sun.intensity = sky.sunIntensity;
		this.hemi.intensity = 0.25 + 0.7 * (1 - sky.night);
	}
}
