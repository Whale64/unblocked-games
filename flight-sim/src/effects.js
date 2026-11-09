// Visual effects: CPU particle systems (smoke, fire, spray, vapour) and camera-facing ribbon trails.
import * as THREE from 'three';

const PVERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSize;
attribute vec4 aColor;
attribute float aSeed;
uniform float uScale;
varying vec4 vColor;
varying float vSeed;
void main() {
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	float d = max(-mv.z, 0.5);
	gl_PointSize = clamp(aSize * uScale / d, 1.0, 512.0);
	vColor = aColor;
	vSeed = aSeed;
	gl_Position = projectionMatrix * mv;
	if (aColor.a <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
	#include <logdepthbuf_vertex>
}`;
const PFRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uLight;
uniform float uAdditive;
varying vec4 vColor;
varying float vSeed;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
	#include <logdepthbuf_fragment>
	vec2 p = gl_PointCoord - 0.5;
	float r = length(p) * 2.0;
	if (r > 1.0) discard;
	float n = vn(p * 5.0 + vSeed * 13.0) * 0.6 + vn(p * 11.0 - vSeed * 7.0) * 0.4;
	float a = smoothstep(1.0, 0.25, r) * (0.55 + 0.75 * n);
	a = clamp(a, 0.0, 1.0) * vColor.a;
	if (uAdditive > 0.5) {
		gl_FragColor = vec4(vColor.rgb * a, 1.0);
	} else {
		// fake lighting: brighter on the top-left (sun side)
		float lit = 0.75 + 0.35 * (0.5 - p.y) + 0.2 * n;
		gl_FragColor = vec4(vColor.rgb * uLight * lit, a);
	}
}`;

export class Particles {
	constructor(scene, max, additive) {
		this.max = max;
		this.n = 0;
		this.p = new Float32Array(max * 3);
		this.v = new Float32Array(max * 3);
		this.life = new Float32Array(max);
		this.age = new Float32Array(max);
		this.s0 = new Float32Array(max);
		this.s1 = new Float32Array(max);
		this.c = new Float32Array(max * 3);
		this.a0 = new Float32Array(max);
		this.drag = new Float32Array(max);
		this.buoy = new Float32Array(max);
		this.geo = new THREE.BufferGeometry();
		this.posAttr = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
		this.sizeAttr = new THREE.BufferAttribute(new Float32Array(max), 1);
		this.colAttr = new THREE.BufferAttribute(new Float32Array(max * 4), 4);
		const seeds = new Float32Array(max); for (let i = 0; i < max; i++) seeds[i] = Math.random();
		this.geo.setAttribute('position', this.posAttr);
		this.geo.setAttribute('aSize', this.sizeAttr);
		this.geo.setAttribute('aColor', this.colAttr);
		this.geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
		this.mat = new THREE.ShaderMaterial({
			vertexShader: PVERT, fragmentShader: PFRAG,
			uniforms: { uScale: { value: 500 }, uLight: { value: new THREE.Color(1, 1, 1) }, uAdditive: { value: additive ? 1 : 0 } },
			transparent: true, depthWrite: false,
			blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
		});
		this.points = new THREE.Points(this.geo, this.mat);
		this.points.frustumCulled = false;
		this.points.renderOrder = additive ? 7 : 6;
		scene.add(this.points);
		this.cursor = 0;
	}

	spawn(pos, vel, life, s0, s1, color, alpha, drag = 0.5, buoy = 0) {
		const i = this.cursor;
		this.cursor = (this.cursor + 1) % this.max;
		this.n = Math.max(this.n, i + 1);
		this.p[i * 3] = pos.x; this.p[i * 3 + 1] = pos.y; this.p[i * 3 + 2] = pos.z;
		this.v[i * 3] = vel.x; this.v[i * 3 + 1] = vel.y; this.v[i * 3 + 2] = vel.z;
		this.life[i] = life; this.age[i] = 0;
		this.s0[i] = s0; this.s1[i] = s1;
		this.c[i * 3] = color[0]; this.c[i * 3 + 1] = color[1]; this.c[i * 3 + 2] = color[2];
		this.a0[i] = alpha; this.drag[i] = drag; this.buoy[i] = buoy;
	}

	update(dt, wind, camera, height) {
		this.mat.uniforms.uScale.value = height / (2 * Math.tan(camera.fov * Math.PI / 360));
		const P = this.posAttr.array, S = this.sizeAttr.array, C = this.colAttr.array;
		for (let i = 0; i < this.n; i++) {
			if (this.age[i] >= this.life[i]) { C[i * 4 + 3] = 0; continue; }
			this.age[i] += dt;
			const t = Math.min(1, this.age[i] / this.life[i]);
			const k = Math.exp(-this.drag[i] * dt);
			for (let a = 0; a < 3; a++) {
				const w = a === 0 ? wind.x : a === 2 ? wind.z : 0;
				this.v[i * 3 + a] = w + (this.v[i * 3 + a] - w) * k;
			}
			this.v[i * 3 + 1] += this.buoy[i] * dt;
			this.p[i * 3] += this.v[i * 3] * dt;
			this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
			this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
			P[i * 3] = this.p[i * 3]; P[i * 3 + 1] = this.p[i * 3 + 1]; P[i * 3 + 2] = this.p[i * 3 + 2];
			S[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
			const fadeIn = Math.min(1, this.age[i] / 0.08);
			C[i * 4] = this.c[i * 3]; C[i * 4 + 1] = this.c[i * 3 + 1]; C[i * 4 + 2] = this.c[i * 3 + 2];
			C[i * 4 + 3] = this.a0[i] * fadeIn * (1 - t) * (1 - t);
		}
		this.geo.setDrawRange(0, this.n);
		this.posAttr.needsUpdate = true; this.sizeAttr.needsUpdate = true; this.colAttr.needsUpdate = true;
	}

	clear() { this.life.fill(0); this.age.fill(1); this.n = 0; }
}

const RVERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aAlpha;
varying float vA;
varying float vV;
attribute float aSide;
void main() {
	vA = aAlpha; vV = aSide;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	#include <logdepthbuf_vertex>
}`;
const RFRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
varying float vA;
varying float vV;
void main() {
	#include <logdepthbuf_fragment>
	float edge = 1.0 - abs(vV);
	float a = vA * smoothstep(0.0, 0.8, edge);
	gl_FragColor = vec4(uColor, a);
}`;

export class Ribbon {
	constructor(scene, max = 240, color = [1, 1, 1], minDist = 4) {
		this.max = max;
		this.minDist = minDist;
		this.pts = [];
		this.geo = new THREE.BufferGeometry();
		this.pos = new Float32Array(max * 2 * 3);
		this.alpha = new Float32Array(max * 2);
		const side = new Float32Array(max * 2);
		for (let i = 0; i < max; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; }
		this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
		this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
		this.geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
		const idx = [];
		for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
		this.geo.setIndex(idx);
		this.mat = new THREE.ShaderMaterial({
			vertexShader: RVERT, fragmentShader: RFRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
			uniforms: { uColor: { value: new THREE.Color(...color) } },
		});
		this.mesh = new THREE.Mesh(this.geo, this.mat);
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 4;
		scene.add(this.mesh);
	}

	add(p, alpha, width, life) {
		const last = this.pts[this.pts.length - 1];
		if (last && last.p.distanceToSquared(p) < this.minDist * this.minDist) {
			last.a = Math.max(last.a, alpha);
			return;
		}
		this.pts.push({ p: p.clone(), a: alpha, w: width, age: 0, life });
		if (this.pts.length > this.max) this.pts.shift();
	}

	update(dt, camPos, wind) {
		for (const q of this.pts) { q.age += dt; q.w += dt * 0.6; q.p.addScaledVector(wind, dt); }
		while (this.pts.length && this.pts[0].age > this.pts[0].life) this.pts.shift();
		const n = this.pts.length;
		const tmp = new THREE.Vector3(), dir = new THREE.Vector3(), off = new THREE.Vector3();
		for (let i = 0; i < this.max; i++) {
			if (i >= n) { this.alpha[i * 2] = this.alpha[i * 2 + 1] = 0; continue; }
			const q = this.pts[i];
			const a = this.pts[Math.max(0, i - 1)].p, b = this.pts[Math.min(n - 1, i + 1)].p;
			dir.subVectors(b, a);
			if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
			tmp.subVectors(camPos, q.p);
			off.crossVectors(dir, tmp).normalize().multiplyScalar(q.w * 0.5);
			this.pos[i * 6] = q.p.x - off.x; this.pos[i * 6 + 1] = q.p.y - off.y; this.pos[i * 6 + 2] = q.p.z - off.z;
			this.pos[i * 6 + 3] = q.p.x + off.x; this.pos[i * 6 + 4] = q.p.y + off.y; this.pos[i * 6 + 5] = q.p.z + off.z;
			const fade = 1 - q.age / q.life;
			const head = i === n - 1 ? 0 : 1;
			this.alpha[i * 2] = this.alpha[i * 2 + 1] = q.a * fade * head;
		}
		this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
		this.geo.attributes.position.needsUpdate = true;
		this.geo.attributes.aAlpha.needsUpdate = true;
	}

	clear() { this.pts.length = 0; }
}

export class Effects {
	constructor(scene) {
		this.smoke = new Particles(scene, 2500, false);
		this.fire = new Particles(scene, 1200, true);
		this.vortexL = new Ribbon(scene, 160, [0.95, 0.97, 1.0], 3);
		this.vortexR = new Ribbon(scene, 160, [0.95, 0.97, 1.0], 3);
		this.contrail = new Ribbon(scene, 400, [0.95, 0.96, 1.0], 25);
		this._v = new THREE.Vector3();
		this.shake = 0;
	}

	explode(pos, vel) {
		const v = new THREE.Vector3();
		for (let i = 0; i < 260; i++) {
			v.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(5 + Math.random() * 30).addScaledVector(vel, 0.2);
			this.fire.spawn(pos, v, 0.6 + Math.random() * 1.6, 3 + Math.random() * 4, 14 + Math.random() * 14, [6, 2.6 + Math.random(), 0.6], 1, 1.8, 6);
		}
		for (let i = 0; i < 200; i++) {
			v.set(Math.random() - 0.5, Math.random() * 0.7 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(3 + Math.random() * 14).addScaledVector(vel, 0.15);
			const g = 0.06 + Math.random() * 0.06;
			this.smoke.spawn(pos, v, 6 + Math.random() * 10, 6, 30 + Math.random() * 30, [g, g, g * 1.05], 0.9, 0.5, 2.5 + Math.random() * 3);
		}
		this.shake = 1.5;
		this.burnPos = pos.clone();
		this.burnTime = 25;
	}

	splash(pos, vel) {
		const v = new THREE.Vector3();
		for (let i = 0; i < 250; i++) {
			v.set(Math.random() - 0.5, 1.5 + Math.random() * 2, Math.random() - 0.5).normalize().multiplyScalar(6 + Math.random() * 22).addScaledVector(vel, 0.25);
			this.smoke.spawn(pos, v, 2 + Math.random() * 3, 2, 12, [0.75, 0.8, 0.85], 0.8, 0.8, -9);
		}
		this.shake = 1.0;
	}

	tyreSmoke(pos, strength) {
		const v = new THREE.Vector3();
		const n = Math.ceil(strength * 6);
		for (let i = 0; i < n; i++) {
			v.set((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2);
			this.smoke.spawn(pos, v, 1.5 + Math.random() * 1.5, 0.6, 5, [0.7, 0.7, 0.72], 0.35 * Math.min(1, strength), 1.2, 0.5);
		}
	}

	update(dt, wind, camera, height, light) {
		this.smoke.mat.uniforms.uLight.value.copy(light);
		if (this.burnTime > 0) {
			this.burnTime -= dt;
			const v = this._v;
			for (let i = 0; i < 2; i++) {
				v.set((Math.random() - 0.5) * 3, 4 + Math.random() * 4, (Math.random() - 0.5) * 3);
				this.fire.spawn(this.burnPos, v, 0.5 + Math.random() * 0.6, 3, 7, [5, 2, 0.4], 0.8 * Math.min(1, this.burnTime / 5), 1.5, 4);
				const g = 0.05;
				this.smoke.spawn(this.burnPos.clone().add(new THREE.Vector3(0, 3, 0)), v, 8 + Math.random() * 6, 4, 26, [g, g, g], 0.6 * Math.min(1, this.burnTime / 8), 0.3, 3);
			}
		}
		this.smoke.update(dt, wind, camera, height);
		this.fire.update(dt, wind, camera, height);
		this.vortexL.update(dt, camera.position, wind);
		this.vortexR.update(dt, camera.position, wind);
		this.contrail.update(dt, camera.position, wind);
		this.shake = Math.max(0, this.shake - dt * 0.8);
	}

	clear() {
		this.smoke.clear(); this.fire.clear(); this.vortexL.clear(); this.vortexR.clear(); this.contrail.clear();
		this.burnTime = 0;
	}
}
