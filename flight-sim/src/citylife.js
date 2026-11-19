// Rendering for the human world: streaming road-map textures sampled by the terrain shader,
// instanced buildings with procedural facades (lit windows at night), street lights and traffic.
import * as THREE from 'three';
import { towns, roads, townLots, roadPoint } from './settlements.js';
import { getHeight } from './world.js';
import { patchWorldLighting } from './worldlight.js';

export const cityUniforms = { uNight: { value: 0 } };

// ---------------------------------------------------------------- road maps (R asphalt, G markings, B urban ground)
class RoadMap {
	constructor(size, extent, { markings = false, minPx = 1 } = {}) {
		this.size = size; this.extent = extent; this.markings = markings; this.minPx = minPx;
		this.canvas = document.createElement('canvas');
		this.canvas.width = this.canvas.height = size;
		this.g = this.canvas.getContext('2d');
		if (markings) { this.mk = document.createElement('canvas'); this.mk.width = this.mk.height = size; this.mg = this.mk.getContext('2d'); }
		this.tex = new THREE.CanvasTexture(this.canvas);
		this.tex.minFilter = THREE.LinearMipmapLinearFilter;
		this.tex.anisotropy = 8;
		this.center = new THREE.Vector3(1e9, 1e9, extent);
	}

	draw(cx, cz) {
		const { g, size, extent } = this;
		const s = size / extent;
		const X = (x) => (x - cx) * s + size / 2, Z = (z) => (z - cz) * s + size / 2;
		const lim = extent * 0.75;
		g.globalCompositeOperation = 'source-over';
		g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
		g.globalCompositeOperation = 'lighter';
		for (const t of towns) {
			if (Math.abs(t.x - cx) > lim + t.r || Math.abs(t.z - cz) > lim + t.r) continue;
			const gr = g.createRadialGradient(X(t.x), Z(t.z), t.r * s * 0.45, X(t.x), Z(t.z), t.r * s * 1.05);
			gr.addColorStop(0, 'rgba(0,0,255,1)'); gr.addColorStop(1, 'rgba(0,0,255,0)');
			g.fillStyle = gr;
			g.beginPath(); g.arc(X(t.x), Z(t.z), t.r * s * 1.05, 0, Math.PI * 2); g.fill();
		}
		g.lineCap = 'round'; g.lineJoin = 'round';
		const path = (ctx, r) => {
			ctx.beginPath();
			for (let k = 0; k < r.pts.length / 2; k++) { const x = X(r.pts[k * 2]), z = Z(r.pts[k * 2 + 1]); if (k) ctx.lineTo(x, z); else ctx.moveTo(x, z); }
		};
		const visible = (r) => {
			for (let k = 0; k < r.pts.length / 2; k += 4) if (Math.abs(r.pts[k * 2] - cx) < lim && Math.abs(r.pts[k * 2 + 1] - cz) < lim) return true;
			return Math.abs(r.pts[r.pts.length - 2] - cx) < lim && Math.abs(r.pts[r.pts.length - 1] - cz) < lim;
		};
		const vis = roads.filter(visible);
		for (const r of vis) {
			const px = r.width * s;
			g.strokeStyle = `rgba(255,0,0,${Math.min(1, px / this.minPx) * (px < 1 ? 0.8 : 1)})`;
			g.lineWidth = Math.max(px, this.minPx);
			path(g, r); g.stroke();
		}
		if (this.markings) {
			const m = this.mg;
			m.globalCompositeOperation = 'source-over';
			m.clearRect(0, 0, size, size);
			m.lineCap = 'butt'; m.lineJoin = 'round';
			for (const r of vis) {
				if (r.kind === 'street') continue;
				// edge lines: stroke full width, then cut out the inside
				m.globalCompositeOperation = 'source-over';
				m.setLineDash([]);
				m.strokeStyle = 'rgb(0,255,0)'; m.lineWidth = (r.width - 0.6) * s; path(m, r); m.stroke();
				m.globalCompositeOperation = 'destination-out';
				m.lineWidth = (r.width - 1.2) * s; path(m, r); m.stroke();
				m.globalCompositeOperation = 'source-over';
				m.setLineDash([6 * s, 9 * s]);
				m.lineWidth = Math.max(0.22 * s, 1); path(m, r); m.stroke();
			}
			m.setLineDash([]);
			g.drawImage(this.mk, 0, 0);
		}
		this.center.set(cx, cz, extent);
		this.tex.needsUpdate = true;
	}

	update(cx, cz, force) {
		const snap = this.extent * 0.18;
		if (force || Math.abs(cx - this.center.x) > snap || Math.abs(cz - this.center.y) > snap) {
			this.draw(Math.round(cx / (snap / 2)) * (snap / 2), Math.round(cz / (snap / 2)) * (snap / 2));
			return true;
		}
		return false;
	}
}

export const ROAD_GLSL = /* glsl */`
uniform sampler2D tRoadN, tRoadM, tRoadF;
uniform vec3 uRoadN, uRoadM, uRoadF;
float roadIn(vec2 u) { vec2 e = min(u, 1.0 - u); return smoothstep(0.0, 0.04, min(e.x, e.y)); }
vec2 roadUV(vec2 xz, vec3 m) { return vec2((xz.x - m.x) / m.z + 0.5, 0.5 - (xz.y - m.y) / m.z); }
vec4 roadAt(vec2 xz) {
	vec2 un = roadUV(xz, uRoadN), um = roadUV(xz, uRoadM), uf = roadUV(xz, uRoadF);
	vec4 n = texture2D(tRoadN, clamp(un, 0.0, 1.0)), m = texture2D(tRoadM, clamp(um, 0.0, 1.0)), f = texture2D(tRoadF, clamp(uf, 0.0, 1.0));
	vec4 r = f * roadIn(uf);
	r = mix(r, m, roadIn(um));
	r = mix(r, n, roadIn(un));
	return r;
}
`;

// ---------------------------------------------------------------- buildings
const FACADE_VERT_PARS = /* glsl */`
attribute float aPart;
varying vec3 vBL; varying vec3 vBN; varying float vPart; varying float vBid; varying float vBH;`;
const FACADE_VERT = /* glsl */`
	vec3 bsc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
	vBL = position * bsc; vBN = normal; vPart = aPart; vBid = float(gl_InstanceID); vBH = bsc.y;`;
const FACADE_FRAG_PARS = /* glsl */`
uniform float uNight;
uniform float uHouse;
varying vec3 vBL; varying vec3 vBN; varying float vPart; varying float vBid; varying float vBH;
float bh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float bRough = 0.85; vec3 bEmit = vec3(0.0);`;
const FACADE_FRAG = /* glsl */`
	{
		vec3 base = diffuseColor.rgb;
		if (vPart > 0.5 || vBN.y > 0.5) {
			// roofs: tiles on houses, gravel/plant on flat roofs
			float rv = bh(vec2(vBid, 3.1));
			vec3 roof = uHouse > 0.5 ? mix(vec3(0.20, 0.07, 0.05), vec3(0.12, 0.12, 0.13), step(0.55, rv)) : vec3(0.12, 0.12, 0.12) * (0.8 + 0.4 * rv);
			if (uHouse > 0.5) roof *= 0.85 + 0.15 * step(0.5, fract(vBL.y * 3.0));
			diffuseColor.rgb = roof; bRough = 0.9;
		} else {
			float u = abs(vBN.x) > 0.5 ? vBL.z : vBL.x;
			float v = vBL.y;
			float sp = uHouse > 0.5 ? 3.4 : 3.1, fh = uHouse > 0.5 ? 2.9 : 3.4;
			vec2 q = vec2(u / sp, v / fh);
			vec2 cell = floor(q), f = fract(q);
			vec2 w = fwidth(q);
			float aa = max(w.x, w.y);
			float win = smoothstep(0.2 - aa, 0.2 + aa, f.x) * smoothstep(0.8 + aa, 0.8 - aa, f.x) * smoothstep(0.3 - aa, 0.3 + aa, f.y) * smoothstep(0.78 + aa, 0.78 - aa, f.y);
			win *= step(0.6, v) * step(v, vBH * (uHouse > 0.5 ? 0.62 : 1.0) - 0.6);
			// far away the pattern would alias (shimmer): fade to an average facade
			float detail = 1.0 - smoothstep(0.25, 0.6, aa);
			vec3 glass = vec3(0.025, 0.035, 0.045) + vec3(0.03) * bh(cell + vBid);
			float lit = step(bh(cell * 1.7 + vBid * 13.1), uHouse > 0.5 ? 0.45 : 0.38);
			vec3 warm = mix(vec3(1.0, 0.72, 0.38), vec3(0.75, 0.85, 1.0), step(0.8, bh(cell + vBid * 3.7)));
			float avgWin = 0.27;
			diffuseColor.rgb = mix(mix(base, glass, avgWin), mix(base, glass, win), detail);
			bRough = mix(0.85, 0.15, win * detail);
			bEmit = warm * uNight * 2.2 * mix(avgWin * (uHouse > 0.5 ? 0.45 : 0.38), win * lit, detail);
			// ground-floor shop fronts in denser buildings
			if (uHouse < 0.5 && v < 3.2) { bEmit += vec3(1.0, 0.8, 0.55) * uNight * 1.2 * step(0.5, bh(vec2(floor(u / 6.0), vBid))); }
		}
	}`;

function facadeMaterial(house) {
	const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.0 });
	const u = { uHouse: { value: house ? 1 : 0 } };
	mat.onBeforeCompile = (sh) => {
		Object.assign(sh.uniforms, cityUniforms, u);
		sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + FACADE_VERT_PARS)
			.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + FACADE_VERT);
		sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FACADE_FRAG_PARS)
			.replace('#include <color_fragment>', '#include <color_fragment>\n' + FACADE_FRAG)
			.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = bRough;')
			.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += bEmit;');
	};
	mat.customProgramCacheKey = () => 'facade' + (house ? 'h' : 'b');
	return patchWorldLighting(mat, { key: 'facade' + (house ? 'h' : 'b') });
}

function boxGeometry() {
	const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
	g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count), 1));
	return g;
}

function houseGeometry() {
	// walls 0..0.62 of the height, gable roof above with a small overhang
	const walls = new THREE.BoxGeometry(1, 0.62, 1).translate(0, 0.31, 0).toNonIndexed();
	const o = 0.56;
	const P = [
		[-o, 0.6, -o], [o, 0.6, -o], [0, 1, -o], [-o, 0.6, o], [0, 1, o], [o, 0.6, o], // gable ends
		[-o, 0.6, -o], [0, 1, -o], [0, 1, o], [-o, 0.6, -o], [0, 1, o], [-o, 0.6, o], // left slope
		[o, 0.6, -o], [o, 0.6, o], [0, 1, o], [o, 0.6, -o], [0, 1, o], [0, 1, -o], // right slope
	];
	const roof = new THREE.BufferGeometry();
	roof.setAttribute('position', new THREE.Float32BufferAttribute(P.flat(), 3));
	roof.computeVertexNormals();
	const pos = [...walls.attributes.position.array, ...roof.attributes.position.array];
	const nor = [...walls.attributes.normal.array, ...roof.attributes.normal.array];
	const part = [...new Array(walls.attributes.position.count).fill(0), ...new Array(roof.attributes.position.count).fill(1)];
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
	g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
	g.computeBoundingSphere();
	return g;
}

const WALLS = [[0.55, 0.53, 0.5], [0.62, 0.58, 0.5], [0.42, 0.42, 0.44], [0.5, 0.36, 0.28], [0.7, 0.68, 0.64], [0.3, 0.38, 0.45]];
const HOUSE_WALLS = [[0.75, 0.72, 0.66], [0.68, 0.6, 0.5], [0.8, 0.78, 0.72], [0.55, 0.4, 0.32], [0.72, 0.7, 0.6], [0.6, 0.62, 0.6], [0.78, 0.7, 0.58], [0.5, 0.45, 0.4]];

// ---------------------------------------------------------------- point lights (street lamps, car lights)
const PL_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 color;
attribute float size;
uniform float uScale, uNight, uDay;
varying vec3 vColor;
void main() {
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	float d = max(-mv.z, 1.0);
	float px = size * uScale / d;
	float inten = mix(uDay, 1.0, uNight);
	vColor = color * inten * (px < 1.6 ? max(px / 1.6, 0.15) : 1.0);
	gl_PointSize = clamp(px, 1.6, 24.0);
	gl_Position = projectionMatrix * mv;
	if (inten < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
	#include <logdepthbuf_vertex>
}`;
const PL_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
void main() {
	#include <logdepthbuf_fragment>
	vec2 p = gl_PointCoord - 0.5;
	float r2 = dot(p, p) * 4.0;
	if (r2 > 1.0) discard;
	gl_FragColor = vec4(vColor * (exp(-r2 * 5.0) + 0.15 * (1.0 - r2)) * 6.0, 1.0);
}`;
function pointMaterial(dayIntensity) {
	return new THREE.ShaderMaterial({
		vertexShader: PL_VERT, fragmentShader: PL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
		uniforms: { uScale: { value: 800 }, uNight: cityUniforms.uNight, uDay: { value: dayIntensity } },
	});
}

export class CityLife {
	constructor(scene, quality) {
		this.scene = scene;
		this.group = new THREE.Group();
		scene.add(this.group);
		this.maps = {
			near: new RoadMap(2048, 2048, { markings: true, minPx: 1 }),
			mid: new RoadMap(1024, 12000, { minPx: 1 }),
			far: new RoadMap(1024, 64000, { minPx: 1.2 }),
		};
		this.uniforms = {
			tRoadN: { value: this.maps.near.tex }, tRoadM: { value: this.maps.mid.tex }, tRoadF: { value: this.maps.far.tex },
			uRoadN: { value: this.maps.near.center }, uRoadM: { value: this.maps.mid.center }, uRoadF: { value: this.maps.far.center },
		};
		this.boxGeo = boxGeometry();
		this.houseGeo = houseGeometry();
		this.boxMat = facadeMaterial(false);
		this.houseMat = facadeMaterial(true);
		this.built = new Map();
		this.lots = new Map();
		this.range = quality.cityRange || 16000;
		this.buildStreetLights();
		this.buildTraffic(quality.traffic ?? 1);
	}

	// building lots are generated lazily (a few ms per town) and cached
	lotsFor(i) {
		if (!this.lots.has(i)) this.lots.set(i, townLots(towns[i]));
		return this.lots.get(i);
	}

	buildTown(i) {
		const L = this.lotsFor(i);
		const meshes = [];
		const mk = (arr, geo, mat, palette) => {
			const n = arr.length / 8;
			if (!n) return;
			const im = new THREE.InstancedMesh(geo, mat, n);
			const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
			for (let k = 0; k < n; k++) {
				const o = k * 8;
				p.set(arr[o], arr[o + 1], arr[o + 2]);
				sc.set(arr[o + 3], arr[o + 4], arr[o + 5]);
				q.setFromAxisAngle(up, -arr[o + 6]);
				im.setMatrixAt(k, m4.compose(p, q, sc));
				const c = palette[arr[o + 7] % palette.length];
				im.setColorAt(k, col.setRGB(c[0], c[1], c[2]));
			}
			im.computeBoundingSphere();
			im.castShadow = true; im.receiveShadow = true;
			im.matrixAutoUpdate = false;
			this.group.add(im);
			meshes.push(im);
		};
		mk([...L.towers, ...L.blocks], this.boxGeo, this.boxMat, WALLS);
		mk(L.houses, this.houseGeo, this.houseMat, HOUSE_WALLS);
		this.built.set(i, meshes);
	}

	buildStreetLights() {
		const pos = [], col = [], size = [];
		const add = (x, z, c, s) => { pos.push(x, getHeight(x, z) + 7, z); col.push(...c); size.push(s); };
		const pt = {};
		for (const r of roads) {
			const urban = r.kind !== 'highway';
			const step = urban ? 42 : 70;
			for (let s = step / 2; s < r.len; s += step) {
				roadPoint(r, s, pt);
				if (!urban) {
					// highways are lit only through and near settlements
					let near = false;
					for (const t of towns) if ((pt.x - t.x) ** 2 + (pt.z - t.z) ** 2 < (t.r + 1500) ** 2) { near = true; break; }
					if (!near) continue;
				}
				const side = r.width / 2 + 1;
				add(pt.x - pt.dz * side, pt.z + pt.dx * side, urban ? [1.0, 0.55, 0.22] : [1.0, 0.62, 0.3], 1.4);
			}
		}
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
		g.setAttribute('size', new THREE.Float32BufferAttribute(size, 1));
		this.lampMat = pointMaterial(0);
		this.lamps = new THREE.Points(g, this.lampMat);
		this.lamps.frustumCulled = false;
		this.lamps.renderOrder = 5;
		this.scene.add(this.lamps);
		this.lampCount = pos.length / 3;
	}

	buildTraffic(density) {
		const rnd = (() => { let s = 1234; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
		this.cars = [];
		const PAL = [[0.7, 0.05, 0.05], [0.05, 0.1, 0.4], [0.85, 0.85, 0.85], [0.08, 0.08, 0.08], [0.45, 0.47, 0.5], [0.8, 0.6, 0.1], [0.1, 0.3, 0.15]];
		for (let ri = 0; ri < roads.length; ri++) {
			const r = roads[ri];
			const per = r.kind === 'highway' ? 700 : r.kind === 'avenue' ? 160 : 420;
			const n = Math.floor(r.len / per * density);
			for (let k = 0; k < n; k++) {
				this.cars.push({ r, s: rnd() * r.len, dir: rnd() < 0.5 ? 1 : -1, v: (r.kind === 'highway' ? 24 : 12) * (0.8 + rnd() * 0.4), c: PAL[Math.floor(rnd() * PAL.length)] });
			}
		}
		const MAX = 900;
		this.carMax = MAX;
		const body = new THREE.BoxGeometry(1.8, 0.75, 4.4).translate(0, 0.65, 0);
		const cab = new THREE.BoxGeometry(1.6, 0.6, 2.2).translate(0, 1.3, 0.2);
		const merged = new THREE.BufferGeometry();
		const a = body.toNonIndexed(), b = cab.toNonIndexed();
		merged.setAttribute('position', new THREE.Float32BufferAttribute([...a.attributes.position.array, ...b.attributes.position.array], 3));
		merged.setAttribute('normal', new THREE.Float32BufferAttribute([...a.attributes.normal.array, ...b.attributes.normal.array], 3));
		this.carMesh = new THREE.InstancedMesh(merged, patchWorldLighting(new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5 }), { key: 'car' }), MAX);
		this.carMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
		this.carMesh.frustumCulled = false;
		this.carMesh.castShadow = true;
		this.scene.add(this.carMesh);
		const lg = new THREE.BufferGeometry();
		lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 4 * 3), 3));
		lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX * 4 * 3), 3));
		lg.setAttribute('size', new THREE.BufferAttribute(new Float32Array(MAX * 4), 1));
		this.carLightMat = pointMaterial(0.0);
		this.carLights = new THREE.Points(lg, this.carLightMat);
		this.carLights.frustumCulled = false;
		this.carLights.renderOrder = 5;
		this.scene.add(this.carLights);
		this._pt = {}; this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._up = new THREE.Vector3(0, 1, 0);
	}

	updateTraffic(dt, cam) {
		const pt = this._pt, R2 = 5000 * 5000;
		let n = 0;
		const P = this.carLights.geometry.attributes.position.array, C = this.carLights.geometry.attributes.color.array, S = this.carLights.geometry.attributes.size.array;
		const ic = this.carMesh.instanceColor.array;
		for (const car of this.cars) {
			car.s += car.v * car.dir * dt;
			if (car.s < 0 || car.s > car.r.len) { car.dir = -car.dir; car.s = Math.max(0, Math.min(car.r.len, car.s)); }
			if (n >= this.carMax) continue;
			roadPoint(car.r, car.s, pt);
			const lane = car.r.width * 0.25 * car.dir;
			const x = pt.x - pt.dz * lane, z = pt.z + pt.dx * lane;
			if ((x - cam.x) ** 2 + (z - cam.z) ** 2 > R2) continue;
			const y = Math.max(getHeight(x, z), 0);
			const hx = pt.dx * car.dir, hz = pt.dz * car.dir;
			this._q.setFromAxisAngle(this._up, Math.atan2(-hx, -hz));
			this.carMesh.setMatrixAt(n, this._m.compose(this._p.set(x, y, z), this._q, this._s));
			ic[n * 3] = car.c[0]; ic[n * 3 + 1] = car.c[1]; ic[n * 3 + 2] = car.c[2];
			// head and tail lights
			for (let k = 0; k < 4; k++) {
				const front = k < 2, side = (k & 1 ? 0.65 : -0.65);
				const along = front ? 2.25 : -2.25;
				const o = (n * 4 + k) * 3;
				P[o] = x + hx * along + hz * side; P[o + 1] = y + 0.7; P[o + 2] = z + hz * along - hx * side;
				C[o] = front ? 1 : 0.9; C[o + 1] = front ? 0.95 : 0.05; C[o + 2] = front ? 0.8 : 0.03;
				S[n * 4 + k] = front ? 0.9 : 0.6;
			}
			n++;
		}
		this.carMesh.count = n;
		this.carMesh.instanceMatrix.needsUpdate = true;
		this.carMesh.instanceColor.needsUpdate = true;
		this.carLights.geometry.setDrawRange(0, n * 4);
		this.carLights.geometry.attributes.position.needsUpdate = true;
		this.carLights.geometry.attributes.color.needsUpdate = true;
		this.carLights.geometry.attributes.size.needsUpdate = true;
	}

	update(dt, cam, agl, night, camera, pxHeight, force = false) {
		cityUniforms.uNight.value = night;
		const scale = pxHeight / (2 * Math.tan(camera.fov * Math.PI / 360));
		this.lampMat.uniforms.uScale.value = scale;
		this.carLightMat.uniforms.uScale.value = scale;
		this.carLightMat.uniforms.uDay.value = 0;
		// road maps: the near map only matters close to the ground
		this.maps.far.update(cam.x, cam.z, force);
		this.maps.mid.update(cam.x, cam.z, force);
		if (agl < 1500 || force) this.maps.near.update(cam.x, cam.z, force);
		// stream town buildings (at most one new town per frame)
		let builtOne = false;
		towns.forEach((t, i) => {
			const d = Math.hypot(t.x - cam.x, t.z - cam.z) - t.r;
			if (d < this.range && !this.built.has(i) && (!builtOne || force)) { this.buildTown(i); builtOne = true; }
			else if (d > this.range * 1.3 && this.built.has(i)) {
				for (const m of this.built.get(i)) { this.group.remove(m); m.dispose(); }
				this.built.delete(i);
			}
		});
		this.updateTraffic(dt, cam);
	}
}
