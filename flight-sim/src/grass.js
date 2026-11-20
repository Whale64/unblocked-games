// 3D grass around the camera. Two rings of GPU-instanced blade clumps (dense near, coarser further out)
// on a world-anchored grid. Each frame the vertex shader places every clump on the terrain using a small
// top-down "grass map" rendered from the actual terrain tiles: R = ground height, G = grass density
// (0 on runways, roads, water, rock, snow, plough and towns), B = packed ground albedo, so blades sit
// exactly on the rendered surface and take its colour.
import * as THREE from 'three';
import { patchWorldLighting } from './worldlight.js';

const MAP_RES = 256;

function clumpGeometry(blades, seed) {
	let s = seed;
	const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
	const pos = [], blade = [], idx = [];
	const rows = [0, 0.3, 0.62];
	for (let b = 0; b < blades; b++) {
		const r = Math.sqrt(rnd()) * 0.5, a = rnd() * Math.PI * 2;
		const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
		const face = rnd() * Math.PI * 2, hm = 0.65 + rnd() * 0.7, bend = rnd();
		const v0 = pos.length / 3;
		for (const t of rows) {
			pos.push(-0.5, t, b, 0.5, t, b);
			blade.push(ox, oz, face, hm, ox, oz, face, hm);
		}
		pos.push(0, 1, b);
		blade.push(ox, oz, face, hm);
		for (let k = 0; k < rows.length - 1; k++) {
			const i = v0 + k * 2;
			idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
		}
		const last = v0 + (rows.length - 1) * 2;
		idx.push(last, last + 1, last + 2);
		void bend;
	}
	const g = new THREE.InstancedBufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('aBlade', new THREE.Float32BufferAttribute(blade, 4));
	g.setIndex(idx);
	return g;
}

const GRASS_VERT_PARS = /* glsl */`
attribute vec4 aBlade;
attribute vec2 aCell;
uniform highp sampler2D tGrassMap;
uniform vec2 uMapCenter;
uniform float uMapSize;
uniform vec2 uGrid;
uniform float uSpacing;
uniform vec3 uCam;
uniform float uTime;
uniform vec3 uGrassWind;
uniform vec4 uFade; // inner fade in (a..b), outer fade out (c..d)
uniform vec3 uBlade; // height, width, clump radius
varying vec3 vGrassCol;
varying float vGrassT;
float gh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec4 gmFetch(ivec2 i) { return texelFetch(tGrassMap, clamp(i, ivec2(0), ivec2(${MAP_RES - 1})), 0); }
`;

const GRASS_VERT_MAIN = /* glsl */`
	vec2 cellI = uGrid + aCell;
	float r1 = gh(cellI), r2 = gh(cellI + 17.31), r3 = gh(cellI + 41.13), r4 = gh(cellI + 73.7);
	vec2 wc = (cellI + 0.5 + (vec2(r1, r2) - 0.5) * 0.95) * uSpacing;
	// sample the grass map (bilinear height / density, nearest colour)
	vec2 tc = vec2((wc.x - uMapCenter.x) / uMapSize + 0.5, 0.5 - (wc.y - uMapCenter.y) / uMapSize) * ${MAP_RES.toFixed(1)} - 0.5;
	ivec2 i0 = ivec2(floor(tc)); vec2 fr = fract(tc);
	vec4 m00 = gmFetch(i0), m10 = gmFetch(i0 + ivec2(1, 0)), m01 = gmFetch(i0 + ivec2(0, 1)), m11 = gmFetch(i0 + ivec2(1, 1));
	vec2 hd = mix(mix(m00.rg, m10.rg, fr.x), mix(m01.rg, m11.rg, fr.x), fr.y);
	float pk = gmFetch(ivec2(floor(tc + 0.5))).b;
	vec3 alb = vec3(floor(pk / 65536.0), mod(floor(pk / 256.0), 256.0), mod(pk, 256.0)) / 255.0;
	alb *= alb;
	float inside = step(0.0, tc.x) * step(tc.x, ${(MAP_RES - 1).toFixed(1)}) * step(0.0, tc.y) * step(tc.y, ${(MAP_RES - 1).toFixed(1)});
	float dist = length(wc - uCam.xz);
	float fade = smoothstep(uFade.x, uFade.y, dist) * (1.0 - smoothstep(uFade.z, uFade.w, dist));
	float dens = hd.y;
	float sc = inside * fade * step(r3, dens * 1.15) * (0.55 + 0.6 * r4) * clamp(0.35 + dens, 0.0, 1.0);
	float rot = r1 * 6.2831853;
	mat2 R = mat2(cos(rot), sin(rot), -sin(rot), cos(rot));
	vec2 root = wc + R * aBlade.xy * uBlade.z;
	float face = aBlade.z + rot;
	vec2 fdir = vec2(cos(face), sin(face));
	vec2 perp = vec2(-fdir.y, fdir.x);
	float t = position.y;
	float H = uBlade.x * aBlade.w * sc;
	float W = uBlade.y * step(0.001, sc) * (1.0 + dist / 30.0);
	// natural lean plus wind sway (gusts travel across the field)
	float bend = 0.06 + 0.3 * fract(r2 * 7.3 + aBlade.z);
	float sway = (sin(uTime * 1.6 + dot(root, vec2(0.13, 0.11)) * uGrassWind.z * 0.4) * 0.6 + sin(uTime * 3.7 + root.x * 1.3 + root.y * 0.7) * 0.25) * uGrassWind.z;
	vec2 lean = fdir * bend + uGrassWind.xy * (uGrassWind.z * 0.6 + sway);
	float tt = t * t;
	vec3 gPos = vec3(root.x, hd.x - 0.04, root.y);
	gPos.xz += perp * position.x * W * (1.0 - t * 0.92) + lean * H * tt;
	gPos.y += H * t * (1.0 - 0.35 * length(lean) * tt);
	vec3 bn = normalize(vec3(fdir.x, 0.0, fdir.y) * 0.45 + vec3(0.0, 1.0, 0.0));
	// colour: the ground's own colour, darker in the clump, brighter / yellower at the tips
	vec3 tip = alb * vec3(1.3, 1.55, 1.05);
	tip = mix(tip, vec3(0.2, 0.19, 0.08), step(0.88, fract(r3 * 13.7 + aBlade.z)) * 0.6); // a few dry blades
	vGrassCol = mix(alb * 0.75, tip, t) * (0.88 + 0.24 * r2);
	vGrassT = t;
`;

export class Grass {
	constructor(renderer, scene, terrain, quality) {
		this.renderer = renderer;
		this.scene = scene;
		this.terrain = terrain;
		this.ok = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
		this.group = new THREE.Group();
		scene.add(this.group);
		if (!this.ok) return;
		this.map = new THREE.WebGLRenderTarget(MAP_RES, MAP_RES, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, generateMipmaps: false });
		this.mapSize = 170;
		this.mapCam = new THREE.OrthographicCamera(-this.mapSize / 2, this.mapSize / 2, this.mapSize / 2, -this.mapSize / 2, 1, 12000);
		this.mapCam.up.set(0, 0, -1);
		this.mapCenter = new THREE.Vector2(1e9, 1e9);
		this.mapAge = 99;
		this.mapMat = terrain.createGrassMapMaterial();
		this.uniforms = {
			tGrassMap: { value: this.map.texture },
			uMapCenter: { value: new THREE.Vector2() },
			uMapSize: { value: this.mapSize },
			uCam: { value: new THREE.Vector3() },
			uTime: { value: 0 },
			uGrassWind: { value: new THREE.Vector3(1, 0, 0.3) },
		};
		this.rings = [];
		this.setQuality(quality);
	}

	setQuality(q) {
		if (!this.ok) return;
		for (const r of this.rings) { this.group.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); }
		this.rings = [];
		const g = q.grass || 0;
		if (!g) return;
		// [grid size, spacing m, blades per clump, blade height m, width m, fade in a,b, fade out c,d]
		const defs = g >= 2
			? [[150, 0.42, 6, 0.5, 0.045, -1, 0, 25, 31], [116, 1.25, 7, 0.58, 0.08, 25, 31, 58, 72]]
			: [[118, 0.5, 5, 0.5, 0.05, -1, 0, 20, 26], [80, 1.45, 6, 0.58, 0.09, 20, 26, 46, 58]];
		for (const [G, sp, nb, bh, bw, a, b, c, d] of defs) {
			const geo = clumpGeometry(nb, G * 31 + 7);
			const cells = new Float32Array(G * G * 2);
			for (let j = 0, k = 0; j < G; j++) for (let i = 0; i < G; i++) { cells[k++] = i; cells[k++] = j; }
			geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
			geo.instanceCount = G * G;
			const ringU = {
				uGrid: { value: new THREE.Vector2() },
				uSpacing: { value: sp },
				uFade: { value: new THREE.Vector4(a, b, c, d) },
				uBlade: { value: new THREE.Vector3(bh, bw, sp * 0.9) },
			};
			const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.82, metalness: 0 });
			mat.onBeforeCompile = (shader) => {
				Object.assign(shader.uniforms, this.uniforms, ringU);
				shader.vertexShader = shader.vertexShader
					.replace('#include <common>', '#include <common>\n' + GRASS_VERT_PARS)
					.replace('#include <beginnormal_vertex>', GRASS_VERT_MAIN + '\nvec3 objectNormal = bn;')
					.replace('#include <begin_vertex>', 'vec3 transformed = gPos;');
				shader.fragmentShader = shader.fragmentShader
					.replace('#include <common>', '#include <common>\nvarying vec3 vGrassCol;\nvarying float vGrassT;')
					.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vGrassCol;')
					.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
					.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= mix(0.45, 1.0, vGrassT);\nreflectedLight.directDiffuse *= mix(0.6, 1.0, vGrassT);');
			};
			mat.customProgramCacheKey = () => 'grass-' + G;
			patchWorldLighting(mat, { key: 'grass' });
			const mesh = new THREE.Mesh(geo, mat);
			mesh.frustumCulled = false;
			mesh.receiveShadow = true;
			mesh.castShadow = false;
			mesh.renderOrder = -1;
			this.group.add(mesh);
			this.rings.push({ mesh, G, sp, u: ringU });
		}
	}

	// Re-render the terrain under the camera into the grass map.
	renderMap(cx, cz, eye) {
		const r = this.renderer, cam = this.mapCam;
		const texel = this.mapSize / MAP_RES;
		cx = Math.round(cx / texel) * texel; cz = Math.round(cz / texel) * texel;
		cam.position.set(cx, eye.y + 3000, cz);
		cam.lookAt(cx, eye.y - 1, cz);
		cam.updateMatrixWorld();
		this.mapMat.userData.uniforms.uGrassEye.value.copy(eye);
		const tiles = this.terrain.group.children;
		const saved = [];
		for (const m of tiles) if (m.visible) { saved.push(m); m.material = this.mapMat; }
		const prevRT = r.getRenderTarget();
		const prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
		const prevShadow = r.shadowMap.autoUpdate;
		r.shadowMap.autoUpdate = false;
		r.setRenderTarget(this.map);
		r.setClearColor(0x000000, 0);
		r.clear(true, true, false);
		r.render(this.terrain.group, cam);
		r.setRenderTarget(prevRT);
		r.setClearColor(prevClear, prevAlpha);
		r.shadowMap.autoUpdate = prevShadow;
		for (const m of saved) m.material = this.terrain.material;
		this.mapCenter.set(cx, cz);
		this.uniforms.uMapCenter.value.set(cx, cz);
	}

	update(dt, camPos, camAgl, time, wind) {
		if (!this.ok || !this.rings.length) return;
		const show = camAgl < 260;
		this.group.visible = show;
		if (!show) { this.mapAge = 99; return; }
		this.mapAge += dt;
		const moved = Math.hypot(camPos.x - this.mapCenter.x, camPos.z - this.mapCenter.y);
		if (moved > 10 || this.mapAge > 0.8) { this.renderMap(camPos.x, camPos.z, camPos); this.mapAge = 0; }
		this.uniforms.uCam.value.copy(camPos);
		this.uniforms.uTime.value = time;
		if (wind) {
			const sp = Math.hypot(wind.x, wind.z);
			const k = sp > 0.1 ? 1 / sp : 0;
			this.uniforms.uGrassWind.value.set(wind.x * k, wind.z * k, Math.min(0.15 + sp * 0.05, 0.9));
		}
		for (const r of this.rings) {
			r.u.uGrid.value.set(Math.floor(camPos.x / r.sp) - r.G / 2, Math.floor(camPos.z / r.sp) - r.G / 2);
		}
	}
}
