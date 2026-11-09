// Quadtree LOD terrain with procedural PBR shading, ocean, airports and instanced forests.
import * as THREE from 'three';
import { getHeight, airports, toRunwayLocal } from './world.js';
import { fbm2Tile, WEATHER_SCALE } from './clouds.js';
import { hash2, smoothstep } from './noise.js';

export const MACRO_SIZE = 512;
export const MACRO_SCALE = 24000;

// ------------------------------------------------------------------ macro texture
export function createMacroTexture() {
	const N = MACRO_SIZE;
	const data = new Uint8Array(N * N * 4);
	const forest = new Float32Array(N * N);
	for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
		const u = i / N, v = j / N;
		const f = Math.max(0, Math.min(1, fbm2Tile(u * 10, v * 10, 10, 5, 501) * 1.6 + 0.5));
		const g = Math.max(0, Math.min(1, fbm2Tile(u * 6, v * 6, 6, 4, 602) * 1.6 + 0.5));
		const b = Math.max(0, Math.min(1, fbm2Tile(u * 16, v * 16, 16, 3, 703) * 1.6 + 0.5));
		const a = Math.max(0, Math.min(1, fbm2Tile(u * 4, v * 4, 4, 3, 804) * 1.6 + 0.5));
		const o = (j * N + i) * 4;
		data[o] = Math.round(f * 255); data[o + 1] = g * 255; data[o + 2] = b * 255; data[o + 3] = a * 255;
		forest[j * N + i] = data[o] / 255;
	}
	const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.generateMipmaps = true;
	tex.needsUpdate = true;
	return { tex, forest };
}

function sampleMacro(arr, x, z) {
	const N = MACRO_SIZE;
	let u = (x / MACRO_SCALE) * N - 0.5, v = (z / MACRO_SCALE) * N - 0.5;
	u = ((u % N) + N) % N; v = ((v % N) + N) % N;
	const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
	const i1 = (i0 + 1) % N, j1 = (j0 + 1) % N;
	const a = arr[j0 * N + i0], b = arr[j0 * N + i1], c = arr[j1 * N + i0], d = arr[j1 * N + i1];
	return (a + (b - a) * fu) + ((c + (d - c) * fu) - (a + (b - a) * fu)) * fv;
}

// ------------------------------------------------------------------ digit atlas for runway numbers
function createDigitAtlas() {
	const cw = 128, ch = 320;
	const c = document.createElement('canvas');
	c.width = cw * 10; c.height = ch;
	const g = c.getContext('2d');
	g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
	g.fillStyle = '#fff';
	g.textAlign = 'center'; g.textBaseline = 'middle';
	g.font = `bold ${ch * 0.95}px "Arial Narrow", "Roboto Condensed", Arial, sans-serif`;
	for (let i = 0; i < 10; i++) {
		g.save();
		g.translate(i * cw + cw / 2, ch / 2 + ch * 0.04);
		g.scale(0.62, 1);
		g.fillText(String(i), 0, 0);
		g.restore();
	}
	const tex = new THREE.CanvasTexture(c);
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.generateMipmaps = true;
	tex.anisotropy = 8;
	return tex;
}

// ------------------------------------------------------------------ shader code
const TERRAIN_PARS = /* glsl */`
uniform sampler2D tMacro;
uniform sampler2D tDigits;
uniform sampler2D tWeather;
uniform float uTime;
uniform vec4 uRwyA[3];
uniform vec4 uRwyB[3];
uniform int uRwyCount;
uniform vec3 uLightDir;
uniform float uCoverage, uCloudMid, uCloudsOn;
uniform vec2 uWind;
varying vec3 vWPos;
varying vec3 vWNormal;
varying float vWater;

float tRough = 0.9;
vec3 tN = vec3(0.0, 1.0, 0.0);
float tCloudShadow = 1.0;
float tWaterMask = 0.0;

float th12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(th12(i), th12(i + vec2(1, 0)), u.x), mix(th12(i + vec2(0, 1)), th12(i + vec2(1, 1)), u.x), u.y);
}
float rectAA(vec2 p, vec2 lo, vec2 hi, float w) {
	vec2 a = smoothstep(lo - w, lo + w, p) * (1.0 - smoothstep(hi - w, hi + w, p));
	return a.x * a.y;
}
float digitAt(vec2 g, float dg, float lod) {
	float inside = step(0.0, g.x) * step(g.x, 1.0) * step(0.0, g.y) * step(g.y, 1.0);
	vec2 uv = vec2((dg + clamp(g.x, 0.0, 1.0)) / 10.0, clamp(g.y, 0.0, 1.0));
	return smoothstep(0.3, 0.7, textureLod(tDigits, uv, lod).r) * inside;
}

float runwayPaint(float s, float t, float W, float L, float num, float aa, float lod) {
	float p = 0.0;
	float hw = W * 0.5;
	float sc = W / 45.0;
	float at = abs(t);
	// side stripes
	p = max(p, rectAA(vec2(s, at), vec2(0.0, hw - 1.2), vec2(L, hw - 0.3), aa));
	// threshold bars
	float nb = W >= 40.0 ? 8.0 : (W >= 28.0 ? 6.0 : 4.0);
	float period = (hw - 3.0) / nb;
	float x = at - 1.8;
	float f = fract(x / period) * period;
	float bar = smoothstep(0.0, aa, f) * (1.0 - smoothstep(period * 0.55 - aa, period * 0.55 + aa, f));
	bar *= step(0.0, x) * step(x, nb * period - 0.1);
	p = max(p, bar * rectAA(vec2(s, 0.0), vec2(6.0, -1.0), vec2(36.0, 1.0), aa));
	// designation numbers
	float tens = floor(num / 10.0 + 0.01);
	float ones = num - tens * 10.0;
	float gy = (s - 48.0) / 18.0;
	p = max(p, digitAt(vec2((t + 7.8) / 6.6, gy), tens, lod));
	p = max(p, digitAt(vec2((t - 1.2) / 6.6, gy), ones, lod));
	// centre line dashes
	float cf = fract((s - 78.0) / 60.0) * 60.0;
	float dash = smoothstep(0.0, aa, cf) * (1.0 - smoothstep(36.0 - aa, 36.0 + aa, cf));
	p = max(p, dash * step(78.0, s) * rectAA(vec2(0.0, t), vec2(-1.0, -0.45), vec2(1.0, 0.45), aa));
	// aiming point
	if (L > 1500.0) p = max(p, rectAA(vec2(s, at), vec2(300.0, 5.0 * sc), vec2(345.0, 15.0 * sc), aa));
	// touchdown zone bars
	for (int k = 0; k < 6; k++) {
		float s0 = k == 0 ? 150.0 : (k == 1 ? 450.0 : (k == 2 ? 600.0 : (k == 3 ? 750.0 : (k == 4 ? 900.0 : 1050.0))));
		float nbars = k == 0 ? 3.0 : (k < 3 ? 2.0 : 1.0);
		if (s0 > L * 0.35) continue;
		for (int b = 0; b < 3; b++) {
			if (float(b) >= nbars) break;
			float t0 = (3.0 + float(b) * 3.4) * sc;
			p = max(p, rectAA(vec2(s, at), vec2(s0, t0), vec2(s0 + 22.5, t0 + 1.8 * sc), aa));
		}
	}
	return p;
}

void airportSurface(vec3 wp, inout vec3 col, inout float rough, float aa) {
	float lod = log2(max(aa * 2.0 * 128.0 / 6.6, 1.0));
	for (int i = 0; i < 3; i++) {
		if (i >= uRwyCount) break;
		vec4 A = uRwyA[i]; vec4 B = uRwyB[i];
		vec2 dr = vec2(sin(A.z), -cos(A.z));
		vec2 rt = vec2(cos(A.z), sin(A.z));
		vec2 q = wp.xz - A.xy;
		float u = dot(q, dr), v = dot(q, rt);
		float L = A.w, W = B.x, hw = W * 0.5, hl = L * 0.5;
		if (abs(u) > hl + 900.0 || v < -250.0 || v > 600.0) continue;
		vec2 uv = vec2(u, v);
		float n = vnoise(wp.xz * 0.35) * 0.5 + vnoise(wp.xz * 2.3) * 0.25 + vnoise(wp.xz * 0.04) * 0.25;
		vec3 asphalt = vec3(0.036, 0.036, 0.038) * (0.8 + 0.45 * n);
		vec3 concrete = vec3(0.28, 0.27, 0.25) * (0.85 + 0.3 * n);
		float rw = rectAA(uv, vec2(-hl - 60.0, -hw - 7.5), vec2(hl + 60.0, hw + 7.5), aa);
		float mainR = rectAA(uv, vec2(-hl, -hw), vec2(hl, hw), aa);
		float twy = rectAA(uv, vec2(-hl - 30.0, 108.5), vec2(hl + 30.0, 131.5), aa);
		float con = max(max(rectAA(uv, vec2(-hl + 18.5, 0.0), vec2(-hl + 41.5, 125.0), aa),
		                    rectAA(uv, vec2(hl - 41.5, 0.0), vec2(hl - 18.5, 125.0), aa)),
		                rectAA(uv, vec2(-11.5, 0.0), vec2(11.5, 125.0), aa));
		float apron = rectAA(uv, vec2(-430.0, 135.0), vec2(430.0, 330.0), aa);
		float taxi = max(twy, con);
		float pav = max(max(rw, taxi), apron);

		// mown grass stripes around the field
		float field = rectAA(uv, vec2(-hl - 400.0, -160.0), vec2(hl + 400.0, 420.0), 30.0);
		col *= 1.0 + field * 0.1 * (step(0.5, fract(u / 24.0)) - 0.5);
		if (pav <= 0.0) continue;

		vec3 pc = mix(asphalt * 1.5, asphalt, mainR);
		float sEnd = hl - abs(u);
		float skid = mainR * smoothstep(9.0, 2.0, abs(abs(v) - 3.5)) * smoothstep(180.0, 320.0, sEnd) * smoothstep(1000.0, 650.0, sEnd);
		pc *= 1.0 - 0.6 * skid * (0.4 + 0.6 * vnoise(vec2(u * 0.02, v * 2.0)));
		pc = mix(pc, asphalt * 1.25, taxi * (1.0 - mainR));
		vec2 slab = abs(fract(uv / vec2(7.5, 7.5)) - 0.5) * 7.5;
		float joint = 1.0 - 0.25 * smoothstep(0.12 + aa, 0.0, 3.75 - max(slab.x, slab.y));
		pc = mix(pc, concrete * joint, apron * (1.0 - taxi) * (1.0 - rw));

		float s = u < 0.0 ? u + hl : hl - u;
		float t = u < 0.0 ? v : -v;
		float num = u < 0.0 ? B.y : B.z;
		float white = runwayPaint(s, t, W, L, num, aa, lod) * mainR;
		// blast pad chevrons
		float pad = rectAA(vec2(s, t), vec2(-60.0, -hw), vec2(0.0, hw), aa);
		float chev = abs(fract((-s + abs(t)) / 18.0) - 0.5);
		float yellow = pad * smoothstep(0.1 + aa / 18.0, 0.1, chev);
		// taxiway centre lines
		float tcl = rectAA(uv, vec2(-hl - 30.0, 119.85), vec2(hl + 30.0, 120.15), aa);
		tcl = max(tcl, rectAA(uv, vec2(-0.15, hw + 10.0), vec2(0.15, 120.0), aa));
		tcl = max(tcl, rectAA(uv, vec2(-hl + 29.85, hw + 10.0), vec2(-hl + 30.15, 120.0), aa));
		tcl = max(tcl, rectAA(uv, vec2(hl - 30.15, hw + 10.0), vec2(hl - 29.85, 120.0), aa));
		// hold short markings
		float hsy = hw + 35.0;
		float hold = 0.0;
		for (int k = 0; k < 4; k++) {
			float y0 = hsy + float(k) * 0.6;
			float dashed = k < 2 ? 1.0 : step(0.5, fract(abs(u) / 2.4));
			hold = max(hold, dashed * rectAA(vec2(abs(u), v), vec2(0.0, y0), vec2(hl + 100.0, y0 + 0.3), aa));
		}
		hold *= con;
		// apron stand lines
		float stand = rectAA(vec2(fract((u + 430.0) / 60.0) * 60.0, v), vec2(29.85, 190.0), vec2(30.15, 300.0), aa) * apron;
		float apronEdge = rectAA(uv, vec2(-430.0, 135.0), vec2(430.0, 135.4), aa);
		yellow = max(yellow, max(max(tcl, hold), max(stand, apronEdge)) * (1.0 - mainR));
		col = mix(col, pc, pav);
		col = mix(col, vec3(0.62, 0.62, 0.6), white);
		col = mix(col, vec3(0.55, 0.38, 0.04), yellow);
		rough = mix(rough, mix(0.75, 0.55, max(white, yellow)), pav);
	}
}

vec2 waveSlope(vec2 p, float dist, float t) {
	vec2 g = vec2(0.0);
	float fadeHi = 1.0 - smoothstep(150.0, 2500.0, dist);
	float fadeMid = 1.0 - smoothstep(1500.0, 14000.0, dist);
	for (int i = 0; i < 10; i++) {
		float fi = float(i);
		float ang = fi * 2.399 + 0.4;
		vec2 d = vec2(cos(ang), sin(ang));
		d = normalize(mix(d, vec2(0.8, 0.6), 0.45));
		float k = 0.018 * pow(1.55, fi);
		float w = sqrt(9.81 * k);
		float a = 0.32 / (1.0 + fi * 0.9);
		float fade = i < 4 ? fadeMid : fadeHi;
		g += d * a * cos(dot(p, d) * k + w * t + fi * 1.7) * fade * (k / (k + 0.15));
	}
	float hf = (vnoise(p * 0.9 + t * 0.6) - 0.5) * 0.12 * fadeHi;
	return g * 0.28 + vec2(hf, -hf * 0.7);
}

float cloudShadowAt(vec3 wp) {
	if (uCloudsOn < 0.5) return 1.0;
	vec3 L = uLightDir;
	float tt = max(uCloudMid - wp.y, 0.0) / max(L.y, 0.08);
	vec2 p = wp.xz + L.xz * tt;
	float w = texture2D(tWeather, (p + uWind) / ${WEATHER_SCALE.toFixed(1)}).r;
	float lc = smoothstep(1.0 - uCoverage, 1.0 - uCoverage + 0.35, w);
	return 1.0 - lc * 0.85;
}

void terrainShade(inout vec3 col) {
	vec3 wp = vWPos;
	vec3 n = normalize(vWNormal);
	float dist = length(wp - cameraPosition);
	float slope = 1.0 - n.y;
	float h = wp.y;
	vec4 m = texture2D(tMacro, wp.xz / ${MACRO_SCALE.toFixed(1)});
	float n1 = vnoise(wp.xz * 0.012);
	float n2 = vnoise(wp.xz * 0.11);
	float n3 = vnoise(wp.xz * 0.9);
	float nearF = 1.0 - smoothstep(200.0, 1500.0, dist);

	vec3 grassA = vec3(0.085, 0.135, 0.038);
	vec3 grassB = vec3(0.150, 0.175, 0.060);
	vec3 dryG = vec3(0.20, 0.17, 0.09);
	vec3 c = mix(grassA, grassB, n1);
	c = mix(c, dryG, clamp(smoothstep(0.5, 0.9, m.a) * 0.75 + smoothstep(700.0, 1700.0, h) * 0.35, 0.0, 1.0));
	c *= 0.82 + 0.36 * mix(0.5, n2, 0.8) + (n3 - 0.5) * 0.25 * nearF;

	// farmland patchwork on flat lowlands
	float fieldMask = smoothstep(0.52, 0.62, m.g) * smoothstep(420.0, 180.0, h) * smoothstep(0.1, 0.04, slope) * smoothstep(3.0, 8.0, h);
	if (fieldMask > 0.0) {
		float ang = 0.35 + floor(m.b * 3.0) * 0.5;
		mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
		vec2 qq = R * wp.xz;
		vec2 cs = vec2(240.0, 150.0);
		vec2 id = floor(qq / cs);
		vec2 fr = fract(qq / cs);
		float hs = th12(id);
		vec3 fc = hs < 0.22 ? vec3(0.30, 0.23, 0.09) : (hs < 0.5 ? vec3(0.07, 0.13, 0.03) : (hs < 0.68 ? vec3(0.11, 0.075, 0.045) : (hs < 0.85 ? vec3(0.15, 0.16, 0.06) : vec3(0.21, 0.19, 0.08))));
		fc *= 0.92 + 0.12 * sin((hs > 0.5 ? qq.x : qq.y) * 1.3) * nearF;
		vec2 e = min(fr, 1.0 - fr) * cs;
		float hedge = smoothstep(5.0, 1.5, min(e.x, e.y));
		fc = mix(fc, vec3(0.03, 0.055, 0.02), hedge * 0.85);
		c = mix(c, fc, fieldMask);
	}

	// forest canopy (matches CPU tree placement rule)
	float forest = smoothstep(0.52, 0.62, m.r) * smoothstep(3.0, 8.0, h) * smoothstep(2000.0, 1750.0, h) * smoothstep(0.45, 0.3, slope);
	vec3 canopy = mix(vec3(0.03, 0.062, 0.022), vec3(0.06, 0.09, 0.032), n2) * (0.85 + 0.3 * n3 * nearF);
	c = mix(c, canopy, forest * 0.85);

	// rock with strata
	float strata = vnoise(vec2(h * 0.12 + n1 * 3.0, wp.x * 0.0007));
	vec3 rock = mix(vec3(0.10, 0.092, 0.082), vec3(0.21, 0.19, 0.165), n2 * 0.6 + strata * 0.4);
	rock *= 0.85 + 0.3 * n3 * nearF;
	float rockW = smoothstep(0.30, 0.48, slope + (n1 - 0.5) * 0.18) + smoothstep(2200.0, 2900.0, h + n1 * 350.0) * 0.65;
	c = mix(c, rock, clamp(rockW, 0.0, 1.0));

	// snow
	float snowLine = 2550.0 + (n1 - 0.5) * 600.0;
	float snow = smoothstep(snowLine, snowLine + 220.0, h) * smoothstep(0.62, 0.4, slope + (n2 - 0.5) * 0.15);
	c = mix(c, vec3(0.78, 0.81, 0.86) * (0.92 + 0.08 * n3), snow);

	// beaches / riverbanks
	float beach = smoothstep(4.5, 1.2, h + (n2 - 0.5) * 3.0) * (1.0 - snow);
	c = mix(c, vec3(0.40, 0.35, 0.25) * (0.9 + 0.2 * n3), beach);

	tRough = mix(0.95, 0.75, snow);
	float aa = max(fwidth(wp.x), fwidth(wp.z)) + 0.02;
	airportSurface(wp, c, tRough, aa);

	// detail normal perturbation
	vec2 dn = vec2(vnoise(wp.xz * 0.35) - 0.5, vnoise(wp.xz * 0.35 + 17.0) - 0.5) * 0.25 * nearF * (1.0 - snow * 0.5);
	tN = normalize(n + vec3(dn.x, 0.0, dn.y) * (0.4 + rockW));

	// ocean / lakes
	float water = smoothstep(0.02, 0.6, vWater);
	if (water > 0.0) {
		float depth = vWater;
		vec2 g = waveSlope(wp.xz, dist, uTime);
		vec3 wn = normalize(vec3(-g.x, 1.0, -g.y));
		vec3 deep = vec3(0.004, 0.018, 0.03);
		vec3 shallow = vec3(0.02, 0.09, 0.085);
		vec3 wc = mix(shallow, deep, smoothstep(0.5, 25.0, depth));
		wc = mix(vec3(0.3, 0.27, 0.19), wc, smoothstep(0.0, 1.8, depth));
		float foamN = vnoise(wp.xz * 0.25 + vec2(uTime * 0.3, 0.0)) * vnoise(wp.xz * 0.07 - uTime * 0.05);
		float foam = smoothstep(1.6, 0.2, depth + sin(uTime * 0.8 + wp.x * 0.05) * 0.4) * smoothstep(0.12, 0.3, foamN) * (1.0 - smoothstep(800.0, 3000.0, dist));
		wc = mix(wc, vec3(0.7), foam);
		c = mix(c, wc, water);
		tN = normalize(mix(tN, wn, water));
		tRough = mix(tRough, mix(0.035 + 0.1 * smoothstep(400.0, 9000.0, dist), 0.8, foam), water);
		tWaterMask = water * (1.0 - foam);
	}
	tCloudShadow = cloudShadowAt(wp);
	col = c;
}
`;

function createTerrainMaterial(macroTex, cloudTex) {
	const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
	const uniforms = {
		tMacro: { value: macroTex },
		tDigits: { value: createDigitAtlas() },
		tWeather: { value: cloudTex.weather },
		uTime: { value: 0 },
		uRwyA: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
		uRwyB: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
		uRwyCount: { value: 0 },
		uLightDir: { value: new THREE.Vector3(0, 1, 0) },
		uCoverage: { value: 0.4 }, uCloudMid: { value: 2000 }, uCloudsOn: { value: 1 },
		uWind: { value: new THREE.Vector2() },
	};
	airports.slice(0, 3).forEach((ap, i) => {
		uniforms.uRwyA.value[i].set(ap.x, ap.z, ap.hdRad, ap.length);
		uniforms.uRwyB.value[i].set(ap.width, ap.numA, ap.numB, ap.elev);
	});
	uniforms.uRwyCount.value = Math.min(3, airports.length);
	mat.userData.uniforms = uniforms;
	mat.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nattribute float aWater;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nvarying float vWater;')
			.replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);\nvWater = aWater;');
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', '#include <common>\n' + TERRAIN_PARS)
			.replace('#include <color_fragment>', '#include <color_fragment>\nterrainShade(diffuseColor.rgb);')
			.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = tRough;')
			.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(tN, 0.0)).xyz);')
			.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directDiffuse *= tCloudShadow;\nreflectedLight.directSpecular *= tCloudShadow;\nreflectedLight.indirectSpecular *= mix(1.0, 0.55 + 0.45 * tCloudShadow, tWaterMask);');
	};
	mat.customProgramCacheKey = () => 'terrain-v1';
	return mat;
}

// ------------------------------------------------------------------ tile geometry
function buildTile(x0, z0, size, N) {
	const step = size / N;
	const W = N + 3;
	const hs = new Float32Array(W * W);
	for (let j = 0; j < W; j++) {
		const z = z0 + (j - 1) * step;
		for (let i = 0; i < W; i++) hs[j * W + i] = getHeight(x0 + (i - 1) * step, z);
	}
	const cx = x0 + size / 2, cz = z0 + size / 2;
	const nv = (N + 1) * (N + 1) + 4 * (N + 1);
	const pos = new Float32Array(nv * 3);
	const nor = new Float32Array(nv * 3);
	const wat = new Float32Array(nv);
	let minH = Infinity, maxH = -Infinity;
	let k = 0;
	for (let j = 0; j <= N; j++) {
		for (let i = 0; i <= N; i++) {
			const h = hs[(j + 1) * W + (i + 1)];
			const hl = hs[(j + 1) * W + i], hr = hs[(j + 1) * W + i + 2];
			const hd = hs[j * W + i + 1], hu = hs[(j + 2) * W + i + 1];
			const y = Math.max(h, 0);
			pos[k * 3] = x0 + i * step - cx; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z0 + j * step - cz;
			let nx = hl - hr, ny = 2 * step, nz = hd - hu;
			if (h < 0) { nx *= 0.1; nz *= 0.1; }
			const l = Math.hypot(nx, ny, nz);
			nor[k * 3] = nx / l; nor[k * 3 + 1] = ny / l; nor[k * 3 + 2] = nz / l;
			wat[k] = Math.max(0, -h);
			if (y < minH) minH = y; if (y > maxH) maxH = y;
			k++;
		}
	}
	const skirt = size * 0.02 + 4;
	const edgeIdx = [];
	const pushSkirt = (i, j) => {
		const src = j * (N + 1) + i;
		pos[k * 3] = pos[src * 3]; pos[k * 3 + 1] = pos[src * 3 + 1] - skirt; pos[k * 3 + 2] = pos[src * 3 + 2];
		nor[k * 3] = nor[src * 3]; nor[k * 3 + 1] = nor[src * 3 + 1]; nor[k * 3 + 2] = nor[src * 3 + 2];
		wat[k] = wat[src];
		return k++;
	};
	const sides = [[], [], [], []];
	for (let i = 0; i <= N; i++) sides[0].push([i, 0, pushSkirt(i, 0)]);
	for (let i = 0; i <= N; i++) sides[1].push([i, N, pushSkirt(i, N)]);
	for (let j = 0; j <= N; j++) sides[2].push([0, j, pushSkirt(0, j)]);
	for (let j = 0; j <= N; j++) sides[3].push([N, j, pushSkirt(N, j)]);

	const idx = [];
	for (let j = 0; j < N; j++) {
		for (let i = 0; i < N; i++) {
			const a = j * (N + 1) + i, b = a + 1, c = a + (N + 1), d = c + 1;
			if ((i + j) & 1) { idx.push(a, c, b, b, c, d); } else { idx.push(a, c, d, a, d, b); }
		}
	}
	const addSkirt = (side, flip) => {
		for (let s = 0; s < side.length - 1; s++) {
			const [i0, j0, k0] = side[s], [i1, j1, k1] = side[s + 1];
			const t0 = j0 * (N + 1) + i0, t1 = j1 * (N + 1) + i1;
			if (flip) idx.push(t0, k0, t1, t1, k0, k1); else idx.push(t0, t1, k0, t1, k1, k0);
		}
	};
	addSkirt(sides[0], false); addSkirt(sides[1], true); addSkirt(sides[2], true); addSkirt(sides[3], false);
	edgeIdx.length = 0;

	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
	geo.setAttribute('aWater', new THREE.BufferAttribute(wat, 1));
	geo.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
	const r = Math.hypot(size / 2, size / 2, (maxH - minH) / 2 + skirt);
	geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (maxH + minH) / 2, 0), r);
	return { geo, cx, cz, minH, maxH };
}

// ------------------------------------------------------------------ trees
function createTreeGeometries() {
	const merge = (parts) => {
		parts = parts.map((p) => ({ ...p, geo: p.geo.index ? p.geo.toNonIndexed() : p.geo }));
		let count = 0; parts.forEach((p) => { count += p.geo.attributes.position.count; });
		const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
		const idx = []; let off = 0;
		for (const p of parts) {
			const g = p.geo;
			g.computeVertexNormals();
			const pa = g.attributes.position, na = g.attributes.normal;
			for (let i = 0; i < pa.count; i++) {
				pos.set([pa.getX(i), pa.getY(i), pa.getZ(i)], (off + i) * 3);
				nor.set([na.getX(i), na.getY(i), na.getZ(i)], (off + i) * 3);
				const ao = p.ao ? 0.55 + 0.45 * Math.min(1, Math.max(0, (pa.getY(i) - p.ao[0]) / (p.ao[1] - p.ao[0]))) : 1;
				col.set([p.c[0] * ao, p.c[1] * ao, p.c[2] * ao], (off + i) * 3);
				idx.push(off + i);
			}
			off += pa.count;
		}
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
		g.setAttribute('color', new THREE.BufferAttribute(col, 3));
		g.computeBoundingSphere();
		return g;
	};
	const trunk = new THREE.CylinderGeometry(0.18, 0.3, 3, 5).translate(0, 1.5, 0);
	const coniferParts = [{ geo: trunk, c: [0.12, 0.08, 0.05] }];
	for (let t = 0; t < 3; t++) {
		const r = 2.6 - t * 0.65, hh = 5.2 - t * 0.9, y = 2.2 + t * 2.6;
		const cone = new THREE.ConeGeometry(r, hh, 7, 1).translate(0, y + hh / 2, 0);
		coniferParts.push({ geo: cone, c: [0.075, 0.13, 0.065], ao: [1.5, 12.5] });
	}
	const conifer = merge(coniferParts);
	const crown = new THREE.IcosahedronGeometry(3.0, 1);
	const p = crown.attributes.position;
	for (let i = 0; i < p.count; i++) {
		const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
		const f = 1 + 0.18 * Math.sin(x * 2.1 + z * 1.3) * Math.cos(y * 1.7);
		p.setXYZ(i, x * f, y * f * 0.85 + 6.0, z * f);
	}
	const broad = merge([
		{ geo: new THREE.CylinderGeometry(0.2, 0.35, 4, 5).translate(0, 2, 0), c: [0.13, 0.09, 0.06] },
		{ geo: crown, c: [0.1, 0.16, 0.05], ao: [3.5, 8.5] },
	]);
	return { conifer, broad };
}

export class Terrain {
	constructor(scene, cloudTex, quality) {
		this.scene = scene;
		this.group = new THREE.Group();
		scene.add(this.group);
		const macro = createMacroTexture();
		this.macroForest = macro.forest;
		this.material = createTerrainMaterial(macro.tex, cloudTex);
		this.uniforms = this.material.userData.uniforms;
		this.tiles = new Map();
		this.requests = new Map();
		this.frame = 0;
		this.ROOT = 16384;
		this.setQuality(quality);

		// trees
		const tg = createTreeGeometries();
		const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
		this.treeMeshes = {};
		this.treeCap = 90000;
		for (const type of ['conifer', 'broad']) {
			const m = new THREE.InstancedMesh(tg[type], treeMat, this.treeCap);
			m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.treeCap * 3), 3);
			m.count = 0;
			m.frustumCulled = false;
			m.castShadow = true;
			m.receiveShadow = true;
			this.treeMeshes[type] = m;
			scene.add(m);
		}
		this.treeCells = new Map();
		this.treeDirty = false;
		this.treeCellSize = 256;
	}

	setQuality(q) {
		this.N = q.terrainN;
		this.splitK = q.terrainSplit;
		this.maxLevel = q.terrainMaxLevel;
		this.treeRadius = q.treeRadius;
		this.treeDensity = q.treeDensity;
		this.treeShadows = q.treeShadows;
		if (this.treeMeshes) for (const k in this.treeMeshes) this.treeMeshes[k].castShadow = q.treeShadows;
		for (const t of this.tiles.values()) { this.group.remove(t.mesh); t.mesh.geometry.dispose(); }
		this.tiles.clear();
		if (this.treeCells) { this.treeCells.clear(); this.treeDirty = true; }
	}

	_dist(level, ix, iz, cam, agl) {
		const size = this.ROOT / (1 << level);
		const x0 = ix * size, z0 = iz * size;
		const dx = Math.max(x0 - cam.x, 0, cam.x - (x0 + size));
		const dz = Math.max(z0 - cam.z, 0, cam.z - (z0 + size));
		return Math.sqrt(dx * dx + dz * dz + agl * agl);
	}

	_visit(level, ix, iz, cam, agl, out) {
		const size = this.ROOT / (1 << level);
		const d = this._dist(level, ix, iz, cam, agl);
		const key = level + ':' + ix + ':' + iz;
		const want = level < this.maxLevel && d < size * this.splitK;
		if (want) {
			const start = out.length;
			let ok = true;
			for (let c = 0; c < 4; c++) {
				if (!this._visit(level + 1, ix * 2 + (c & 1), iz * 2 + (c >> 1), cam, agl, out)) ok = false;
			}
			if (ok) return true;
			out.length = start;
		}
		const t = this.tiles.get(key);
		if (t) { out.push(t); return true; }
		if (!this.requests.has(key)) this.requests.set(key, { level, ix, iz, key, d });
		else this.requests.get(key).d = d;
		return false;
	}

	_build(r) {
		const size = this.ROOT / (1 << r.level);
		const { geo, cx, cz } = buildTile(r.ix * size, r.iz * size, size, this.N);
		const mesh = new THREE.Mesh(geo, this.material);
		mesh.position.set(cx, 0, cz);
		mesh.receiveShadow = true;
		mesh.matrixAutoUpdate = false;
		mesh.updateMatrix();
		mesh.visible = false;
		this.group.add(mesh);
		this.tiles.set(r.key, { mesh, last: this.frame, key: r.key });
	}

	update(cam, budgetMs = 5, force = false) {
		this.frame++;
		const agl = Math.max(0, cam.y - Math.max(getHeight(cam.x, cam.z), 0));
		const R = this.ROOT;
		const rx = Math.floor(cam.x / R), rz = Math.floor(cam.z / R);
		const out = [];
		this.requests.clear();
		const RR = 3;
		for (let j = -RR; j <= RR; j++) for (let i = -RR; i <= RR; i++) {
			this._visit(0, rx + i, rz + j, cam, agl, out);
		}
		for (const t of this.tiles.values()) t.mesh.visible = false;
		for (const t of out) { t.mesh.visible = true; t.last = this.frame; }

		// build requested tiles (coarse first, then near first)
		const reqs = [...this.requests.values()].sort((a, b) => (a.level - b.level) || (a.d - b.d));
		const t0 = performance.now();
		let built = 0;
		for (const r of reqs) {
			if (!force && performance.now() - t0 > budgetMs && built > 0) break;
			this._build(r);
			built++;
		}
		// eviction
		if (this.tiles.size > 900) {
			const arr = [...this.tiles.values()].filter((t) => !t.mesh.visible).sort((a, b) => a.last - b.last);
			for (let i = 0; i < arr.length && this.tiles.size > 700; i++) {
				this.group.remove(arr[i].mesh);
				arr[i].mesh.geometry.dispose();
				this.tiles.delete(arr[i].key);
			}
		}
		this.updateTrees(cam, agl, force);
		return reqs.length - built;
	}

	// ------------------------------------------------------------ forests
	_buildTreeCell(ci, cj) {
		const S = this.treeCellSize;
		const cand = Math.round(260 * this.treeDensity);
		const out = { conifer: [], broad: [] };
		const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
		const up = new THREE.Vector3(0, 1, 0);
		for (let k = 0; k < cand; k++) {
			const r1 = hash2(ci * 7919 + k, cj * 104729 - k);
			const r2 = hash2(ci * 31 - k * 17, cj * 57 + k * 13);
			const r3 = hash2(ci + k * 101, cj - k * 211);
			const x = (ci + r1) * S, z = (cj + r2) * S;
			const f = sampleMacro(this.macroForest, x, z);
			let dens = smoothstep(0.52, 0.62, f);
			if (dens < 0.05 && r3 > 0.04) continue;
			if (r3 > Math.max(dens, 0.04)) continue;
			const h = getHeight(x, z);
			if (h < 3 || h > 2000) continue;
			const hx = getHeight(x + 3, z) - getHeight(x - 3, z), hz = getHeight(x, z + 3) - getHeight(x, z - 3);
			const slope = 1 - 6 / Math.hypot(hx, 6, hz);
			if (slope > 0.42) continue;
			let nearRwy = false;
			for (const ap of airports) {
				const l = toRunwayLocal(ap, x, z);
				if (Math.abs(l.u) < ap.flatU + 300 && l.v > ap.flatVmin - 250 && l.v < ap.flatVmax + 250) { nearRwy = true; break; }
			}
			if (nearRwy) continue;
			const type = (h > 700 || hash2(k, ci + cj) < 0.45) ? 'conifer' : 'broad';
			const sc = 0.7 + hash2(k * 3, ci - cj) * 0.75;
			q.setFromAxisAngle(up, r1 * 40);
			s.set(sc, sc * (0.85 + r2 * 0.4), sc);
			p.set(x, h - 0.6, z);
			m4.compose(p, q, s);
			const tint = 0.75 + r3 * 8 * 0.06 + hash2(ci + k, cj) * 0.35;
			const hue = hash2(k, k + ci);
			out[type].push({ m: m4.toArray(), c: [tint * (0.9 + hue * 0.25), tint, tint * (0.85 + hue * 0.1)] });
		}
		const pack = (arr) => {
			const mats = new Float32Array(arr.length * 16), cols = new Float32Array(arr.length * 3);
			arr.forEach((t, i) => { mats.set(t.m, i * 16); cols.set(t.c, i * 3); });
			return { mats, cols, n: arr.length };
		};
		return { conifer: pack(out.conifer), broad: pack(out.broad) };
	}

	updateTrees(cam, agl, force) {
		const S = this.treeCellSize, R = this.treeRadius;
		if (R <= 0) {
			for (const k in this.treeMeshes) this.treeMeshes[k].count = 0;
			return;
		}
		const ci0 = Math.floor((cam.x - R) / S), ci1 = Math.floor((cam.x + R) / S);
		const cj0 = Math.floor((cam.z - R) / S), cj1 = Math.floor((cam.z + R) / S);
		const needed = new Set();
		const missing = [];
		if (agl < 4500) {
			for (let j = cj0; j <= cj1; j++) for (let i = ci0; i <= ci1; i++) {
				const dx = Math.max(i * S - cam.x, 0, cam.x - (i + 1) * S), dz = Math.max(j * S - cam.z, 0, cam.z - (j + 1) * S);
				const d = Math.hypot(dx, dz);
				if (d > R) continue;
				const key = i + ',' + j;
				needed.add(key);
				if (!this.treeCells.has(key)) missing.push({ i, j, key, d });
			}
		}
		missing.sort((a, b) => a.d - b.d);
		const lim = force ? missing.length : 3;
		for (let k = 0; k < Math.min(lim, missing.length); k++) {
			const m = missing[k];
			this.treeCells.set(m.key, this._buildTreeCell(m.i, m.j));
			this.treeDirty = true;
		}
		for (const key of this.treeCells.keys()) {
			if (!needed.has(key)) { this.treeCells.delete(key); this.treeDirty = true; }
		}
		if (!this.treeDirty) return;
		this.treeDirty = false;
		for (const type of ['conifer', 'broad']) {
			const mesh = this.treeMeshes[type];
			const ma = mesh.instanceMatrix.array, ca = mesh.instanceColor.array;
			let n = 0;
			for (const cell of this.treeCells.values()) {
				const c = cell[type];
				if (n + c.n > this.treeCap) break;
				ma.set(c.mats, n * 16); ca.set(c.cols, n * 3);
				n += c.n;
			}
			mesh.count = n;
			mesh.instanceMatrix.needsUpdate = true;
			mesh.instanceColor.needsUpdate = true;
		}
	}

	setEnv(env, lightDir, time) {
		const u = this.uniforms;
		u.uTime.value = time;
		u.uLightDir.value.copy(lightDir);
		u.uCoverage.value = env.coverage;
		u.uCloudMid.value = (env.cloudBase + env.cloudTop) * 0.5;
		u.uCloudsOn.value = env.coverage > 0.01 ? 1 : 0;
		u.uWind.value.copy(env.cloudOffset);
	}
}
