// Shared world lighting: cloud shadows + terrain (mountain) shadows & ambient occlusion baked on the GPU
// from a streamed height field. Any MeshStandard/Physical material can be patched to receive them.
import * as THREE from 'three';
import { DataUtils } from 'three';
import { getHeight } from './world.js';
import { WEATHER_SCALE } from './clouds.js';

export const HF_SIZE = 512;
export const HF_EXTENT = 26000; // metres covered by the height field

export const worldUniforms = {
	tWeather: { value: null },
	uCoverage: { value: 0.4 },
	uCloudMid: { value: 2000 },
	uCloudsOn: { value: 1 },
	uWind: { value: new THREE.Vector2() },
	uLightDir: { value: new THREE.Vector3(0, 1, 0) },
	tWorldShadow: { value: null },
	uWSCenter: { value: new THREE.Vector2() },
	uWSExtent: { value: HF_EXTENT },
	uWSOn: { value: 0 },
};

export const WORLD_LIGHT_GLSL = /* glsl */`
uniform sampler2D tWeather;
uniform float uCoverage, uCloudMid, uCloudsOn;
uniform vec2 uWind;
uniform vec3 uLightDir;
uniform sampler2D tWorldShadow;
uniform vec2 uWSCenter;
uniform float uWSExtent, uWSOn;

float wlCloudShadow(vec3 wp) {
	if (uCloudsOn < 0.5) return 1.0;
	vec3 L = uLightDir;
	float tt = max(uCloudMid - wp.y, 0.0) / max(L.y, 0.08);
	vec2 p = wp.xz + L.xz * tt;
	float w = texture2D(tWeather, (p + uWind) / ${WEATHER_SCALE.toFixed(1)}).r;
	float lc = smoothstep(1.0 - uCoverage, 1.0 - uCoverage + 0.35, w);
	return 1.0 - lc * 0.85 * step(wp.y, uCloudMid + 400.0);
}
// x: sun visibility from terrain occlusion, y: terrain ambient occlusion
vec2 wlTerrain(vec3 wp) {
	vec2 uv = (wp.xz - uWSCenter) / uWSExtent + 0.5;
	float edge = smoothstep(0.0, 0.06, min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)));
	if (edge <= 0.0 || uWSOn < 0.5) return vec2(1.0);
	vec4 s = texture2D(tWorldShadow, uv);
	float soft = 12.0 + 0.004 * max(wp.y - s.x, 0.0);
	float vis = smoothstep(-soft, soft, wp.y + 6.0 - s.x);
	float ao = mix(1.0, s.y, smoothstep(60.0, 0.0, wp.y - s.z));
	return mix(vec2(1.0), vec2(vis, ao), edge);
}
`;

// Patch a lit three.js material so it receives cloud + terrain shadows (and optional terrain AO).
export function patchWorldLighting(mat, { ao = true, key = 'wl' } = {}) {
	const prev = mat.onBeforeCompile;
	mat.onBeforeCompile = (shader, r) => {
		if (prev) prev(shader, r);
		Object.assign(shader.uniforms, worldUniforms);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vWLPos;')
			.replace('#include <project_vertex>', `#include <project_vertex>
				vec4 wlp = vec4(transformed, 1.0);
				#ifdef USE_INSTANCING
				wlp = instanceMatrix * wlp;
				#endif
				vWLPos = (modelMatrix * wlp).xyz;`);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vWLPos;\n' + WORLD_LIGHT_GLSL)
			.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
				{
					vec2 wlt = wlTerrain(vWLPos);
					float wls = wlCloudShadow(vWLPos) * wlt.x;
					reflectedLight.directDiffuse *= wls;
					reflectedLight.directSpecular *= wls;
					${ao ? 'reflectedLight.indirectDiffuse *= wlt.y; reflectedLight.indirectSpecular *= mix(0.6, 1.0, wlt.y);' : ''}
				}`);
	};
	const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
	mat.customProgramCacheKey = () => prevKey() + '|' + key + (ao ? 'a' : '');
	return mat;
}

const BAKE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tHeight;
uniform vec3 uSunDir;
uniform float uExtent;
varying vec2 vUv;
float H(vec2 uv) { return texture2D(tHeight, uv).r; }
void main() {
	float texM = uExtent / ${HF_SIZE.toFixed(1)};
	float h0 = H(vUv);
	// shadow ceiling: the altitude above which this column sees the sun
	float horiz = max(length(uSunDir.xz), 1e-3);
	vec2 d2 = uSunDir.xz / horiz;
	float tanE = uSunDir.y / horiz;
	float Hs = -1e4;
	if (uSunDir.y < -0.02) Hs = 1e5;
	else {
		float dist = texM * 1.5, st = texM;
		for (int i = 0; i < 56; i++) {
			vec2 suv = vUv + d2 * dist / uExtent;
			if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) break;
			Hs = max(Hs, H(suv) - dist * tanE);
			dist += st; st *= 1.07;
		}
	}
	// horizon-based ambient occlusion
	float occ = 0.0;
	for (int k = 0; k < 6; k++) {
		float a = float(k) * 1.0471976 + 0.3;
		vec2 dir = vec2(cos(a), sin(a));
		float m = 0.0;
		for (int j = 0; j < 5; j++) {
			float r = 60.0 * pow(2.0, float(j));
			float hh = H(vUv + dir * r / uExtent);
			m = max(m, (hh - h0) / r);
		}
		occ += m / sqrt(1.0 + m * m);
	}
	float ao = clamp(1.0 - occ / 6.0 * 1.15, 0.25, 1.0);
	gl_FragColor = vec4(Hs, ao, h0, 1.0);
}`;

export class HeightField {
	constructor(renderer) {
		this.renderer = renderer;
		const N = HF_SIZE;
		this.N = N;
		this.data = [new Uint16Array(N * N), new Uint16Array(N * N)];
		this.tex = this.data.map((d) => {
			const t = new THREE.DataTexture(d, N, N, THREE.RedFormat, THREE.HalfFloatType);
			t.minFilter = t.magFilter = THREE.LinearFilter;
			t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
			return t;
		});
		this.front = 0;
		this.center = new THREE.Vector2(1e9, 1e9);
		this.job = null;
		this.rt = new THREE.WebGLRenderTarget(N, N, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
		this.mat = new THREE.ShaderMaterial({
			vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
			fragmentShader: BAKE_FRAG,
			uniforms: { tHeight: { value: null }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uExtent: { value: HF_EXTENT } },
			depthTest: false, depthWrite: false,
		});
		this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
		this.quad.frustumCulled = false;
		this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
		this.lastSun = new THREE.Vector3(0, -2, 0);
		this.ready = false;
		worldUniforms.tWorldShadow.value = this.rt.texture;
	}

	_startJob(cx, cz) {
		const back = 1 - this.front;
		this.job = { cx, cz, row: 0, back };
	}

	_work(rows) {
		const j = this.job, N = this.N, d = this.data[j.back];
		const step = HF_EXTENT / N;
		const x0 = j.cx - HF_EXTENT / 2 + step / 2, z0 = j.cz - HF_EXTENT / 2 + step / 2;
		const end = Math.min(N, j.row + rows);
		for (let r = j.row; r < end; r++) {
			const z = z0 + r * step;
			for (let i = 0; i < N; i++) d[r * N + i] = DataUtils.toHalfFloat(Math.max(getHeight(x0 + i * step, z), 0));
		}
		j.row = end;
		if (j.row >= N) {
			this.front = j.back;
			this.tex[this.front].needsUpdate = true;
			this.center.set(j.cx, j.cz);
			this.job = null;
			this.ready = true;
			this.bake();
		}
	}

	update(camPos, sunDir, force = false) {
		const snap = 2000;
		const cx = Math.round(camPos.x / snap) * snap, cz = Math.round(camPos.z / snap) * snap;
		const far = Math.max(Math.abs(cx - this.center.x), Math.abs(cz - this.center.y)) > HF_EXTENT * 0.12;
		if (!this.job && (far || !this.ready)) this._startJob(cx, cz);
		if (this.job) this._work(force ? this.N : 10);
		if (this.ready && this.lastSun.distanceTo(sunDir) > 0.004) { this.lastSun.copy(sunDir); this.bake(); }
	}

	bake() {
		if (!this.ready) return;
		this.mat.uniforms.tHeight.value = this.tex[this.front];
		this.mat.uniforms.uSunDir.value.copy(this.lastSun);
		const r = this.renderer, prev = r.getRenderTarget();
		r.setRenderTarget(this.rt);
		r.render(this.quad, this.cam);
		r.setRenderTarget(prev);
		worldUniforms.uWSCenter.value.copy(this.center);
		worldUniforms.uWSOn.value = 1;
	}

	// CPU estimate of terrain shadowing at a point (for particles/props that are not patched)
	sunVisibilityCPU(p, sunDir) {
		if (sunDir.y < -0.02) return 0;
		const horiz = Math.max(Math.hypot(sunDir.x, sunDir.z), 1e-3);
		const dx = sunDir.x / horiz, dz = sunDir.z / horiz, tanE = sunDir.y / horiz;
		let dist = 60;
		for (let i = 0; i < 28; i++) {
			const h = getHeight(p.x + dx * dist, p.z + dz * dist);
			if (h - dist * tanE > p.y + 3) return 0.15;
			dist *= 1.22;
			if (dist > 15000) break;
		}
		return 1;
	}
}
