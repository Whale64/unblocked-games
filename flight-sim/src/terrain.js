// Quadtree LOD terrain with procedural PBR shading, ocean, airports and instanced forests.
import * as THREE from 'three';
import { getHeight, airports, toRunwayLocal } from './world.js';
import { fbm2Tile } from './clouds.js';
import { WORLD_LIGHT_GLSL, worldUniforms, patchWorldLighting } from './worldlight.js';
import { generateLayerTextures } from './texgen.js';
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
precision highp sampler2DArray;
uniform sampler2D tMacro;
uniform sampler2D tDigits;
uniform sampler2DArray tLayA;
uniform sampler2DArray tLayN;
uniform float uTime;
uniform vec4 uRwyA[3];
uniform vec4 uRwyB[3];
uniform int uRwyCount;
varying vec3 vWPos;
varying vec3 vWNormal;
varying float vWater;

float tRough = 0.9;
vec3 tN = vec3(0.0, 1.0, 0.0);
float tCloudShadow = 1.0;
float tWaterMask = 0.0;
float tDetAO = 1.0;
vec2 gX, gY; // world-xz screen derivatives (computed in uniform control flow)
vec4 sA(vec3 p, vec2 dx, vec2 dy) { vec4 s = textureGrad(tLayA, p, dx, dy); s.rgb *= s.rgb; return s; }
vec4 sN(vec3 p, vec2 dx, vec2 dy) { return textureGrad(tLayN, p, dx, dy); }
vec3 layerMean(float l) { vec3 m = textureLod(tLayA, vec3(0.5, 0.5, l), 12.0).rgb; return max(m * m, vec3(0.003)); }
vec3 topOff(vec4 n) { vec2 t = n.xy * 2.0 - 1.0; return vec3(t.x, 0.0, t.y); }
float hblend(float w, float ha, float hb) {
	return clamp((w - 0.5) * 3.0 + (hb - ha) * 1.8 * 4.0 * w * (1.0 - w) + 0.5, 0.0, 1.0) * smoothstep(0.0, 0.08, w);
}

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

void airportSurface(vec3 wp, inout vec3 col, inout float rough, float aa, vec4 aspT, vec4 conT, float texF, inout float pavOut) {
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
		vec3 asphalt = mix(vec3(0.036, 0.036, 0.038) * (0.8 + 0.45 * n), aspT.rgb * (0.85 + 0.3 * n), texF);
		vec3 concrete = mix(vec3(0.28, 0.27, 0.25) * (0.85 + 0.3 * n), conT.rgb * (0.9 + 0.2 * n), texF);
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
		pavOut = max(pavOut, pav);
		col = mix(col, vec3(0.62, 0.62, 0.6) * mix(1.0, 0.75 + 0.5 * aspT.a, texF), white);
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

void terrainShade(inout vec3 col) {
	vec3 wp = vWPos;
	gX = dFdx(wp.xz); gY = dFdy(wp.xz);
	vec3 g3x = dFdx(wp), g3y = dFdy(wp);
	vec3 n = normalize(vWNormal);
	float dist = length(wp - cameraPosition);
	float slope = 1.0 - n.y;
	float h = wp.y;
	vec4 m = texture2D(tMacro, wp.xz / ${MACRO_SCALE.toFixed(1)});
	float n1 = vnoise(wp.xz * 0.012);
	float n2 = vnoise(wp.xz * 0.11);
	float nearT = 1.0 - smoothstep(900.0, 3200.0, dist);

	// ---------------- macro colour (what you see from altitude)
	vec3 grassA = vec3(0.085, 0.135, 0.038);
	vec3 grassB = vec3(0.150, 0.175, 0.060);
	vec3 dryG = vec3(0.20, 0.17, 0.09);
	vec3 c = mix(grassA, grassB, n1);
	float dryW = clamp(smoothstep(0.5, 0.9, m.a) * 0.75 + smoothstep(700.0, 1700.0, h) * 0.35, 0.0, 1.0);
	c = mix(c, dryG, dryW);
	c *= 0.82 + 0.36 * mix(0.5, n2, 0.8);

	float fieldMask = smoothstep(0.52, 0.62, m.g) * smoothstep(420.0, 180.0, h) * smoothstep(0.1, 0.04, slope) * smoothstep(3.0, 8.0, h);
	float plowed = 0.0;
	if (fieldMask > 0.0) {
		float ang = 0.35 + floor(m.b * 3.0) * 0.5;
		mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
		vec2 qq = R * wp.xz;
		vec2 cs = vec2(240.0, 150.0);
		vec2 id = floor(qq / cs);
		vec2 fr = fract(qq / cs);
		float hs = th12(id);
		vec3 fc = hs < 0.22 ? vec3(0.30, 0.23, 0.09) : (hs < 0.5 ? vec3(0.07, 0.13, 0.03) : (hs < 0.68 ? vec3(0.11, 0.075, 0.045) : (hs < 0.85 ? vec3(0.15, 0.16, 0.06) : vec3(0.21, 0.19, 0.08))));
		float rows = 0.5 + 0.5 * sin((hs > 0.5 ? qq.x : qq.y) * 2.4);
		fc *= 0.9 + 0.2 * rows * (1.0 - smoothstep(200.0, 1200.0, dist));
		vec2 e = min(fr, 1.0 - fr) * cs;
		float hedge = smoothstep(5.0, 1.5, min(e.x, e.y));
		fc = mix(fc, vec3(0.03, 0.055, 0.02), hedge * 0.85);
		c = mix(c, fc, fieldMask);
		plowed = fieldMask * (1.0 - hedge) * ((hs >= 0.5 && hs < 0.68) || hs < 0.22 ? 1.0 : 0.0);
	}
	float forest = smoothstep(0.52, 0.62, m.r) * smoothstep(3.0, 8.0, h) * smoothstep(2000.0, 1750.0, h) * smoothstep(0.45, 0.3, slope);
	vec3 canopy = mix(vec3(0.03, 0.062, 0.022), vec3(0.06, 0.09, 0.032), n2);
	c = mix(c, canopy, forest * 0.85);
	float strata = vnoise(vec2(h * 0.12 + n1 * 3.0, wp.x * 0.0007));
	vec3 rock = mix(vec3(0.10, 0.092, 0.082), vec3(0.21, 0.19, 0.165), n2 * 0.6 + strata * 0.4);
	float rockW = clamp(smoothstep(0.30, 0.48, slope + (n1 - 0.5) * 0.18) + smoothstep(2200.0, 2900.0, h + n1 * 350.0) * 0.65, 0.0, 1.0);
	c = mix(c, rock, rockW);
	float snowLine = 2550.0 + (n1 - 0.5) * 600.0;
	float snow = smoothstep(snowLine, snowLine + 220.0, h) * smoothstep(0.62, 0.4, slope + (n2 - 0.5) * 0.15);
	c = mix(c, vec3(0.78, 0.81, 0.86), snow);
	float beach = smoothstep(4.5, 1.2, h + (n2 - 0.5) * 3.0) * (1.0 - snow);
	c = mix(c, vec3(0.40, 0.35, 0.25), beach);
	tRough = mix(0.95, 0.75, snow);

	// ---------------- close-range PBR detail from the generated texture arrays
	vec3 Noff = vec3(0.0);
	vec4 aspT = vec4(0.04, 0.04, 0.042, 0.5), conT = vec4(0.3, 0.29, 0.27, 0.5);
	vec4 aspN = vec4(0.5, 0.5, 0.85, 1.0);
	if (nearT > 0.0) {
		const float S0 = 1.0 / 6.0, S1 = 1.0 / 31.0;
		const mat2 R1 = mat2(0.799, -0.602, 0.602, 0.799);
		vec2 uv0 = wp.xz * S0, uv1 = R1 * wp.xz * S1;
		vec2 dx0 = gX * S0, dy0 = gY * S0, dx1 = R1 * gX * S1, dy1 = R1 * gY * S1;
		vec4 A = mix(sA(vec3(uv0, 0.0), dx0, dy0), sA(vec3(uv1, 0.0), dx1, dy1), 0.4);
		vec4 N = mix(sN(vec3(uv0, 0.0), dx0, dy0), sN(vec3(uv1, 0.0), dx1, dy1), 0.4);
		vec3 M = layerMean(0.0);
		vec3 off = topOff(N);
		float rgh = N.b, ao = N.a, f;
		#define LAYER_TOP(L, W, SC) { vec2 u_ = wp.xz * SC; vec4 a_ = sA(vec3(u_, L), gX * SC, gY * SC); f = hblend(W, A.a, a_.a); if (f > 0.0) { vec4 n_ = sN(vec3(u_, L), gX * SC, gY * SC); A = mix(A, a_, f); M = mix(M, layerMean(L), f); off = mix(off, topOff(n_), f); rgh = mix(rgh, n_.b, f); ao = mix(ao, n_.a, f); } }
		float dryD = max(dryW, plowed * 0.9);
		if (dryD > 0.01) LAYER_TOP(1.0, dryD, (1.0 / 4.0))
		if (forest > 0.01) LAYER_TOP(5.0, forest * 0.9, (1.0 / 5.0))
		if (beach > 0.01) LAYER_TOP(3.0, beach, (1.0 / 5.0))
		if (rockW > 0.01) {
			vec3 bw = pow(abs(n), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
			const float SR = 1.0 / 13.0;
			vec4 ax = sA(vec3(wp.zy * SR, 2.0), g3x.zy * SR, g3y.zy * SR);
			vec4 ay = sA(vec3(wp.xz * SR, 2.0), g3x.xz * SR, g3y.xz * SR);
			vec4 az = sA(vec3(wp.xy * SR, 2.0), g3x.xy * SR, g3y.xy * SR);
			vec4 ra = ax * bw.x + ay * bw.y + az * bw.z;
			f = hblend(rockW, A.a, ra.a);
			if (f > 0.0) {
				vec4 nx = sN(vec3(wp.zy * SR, 2.0), g3x.zy * SR, g3y.zy * SR);
				vec4 ny = sN(vec3(wp.xz * SR, 2.0), g3x.xz * SR, g3y.xz * SR);
				vec4 nz = sN(vec3(wp.xy * SR, 2.0), g3x.xy * SR, g3y.xy * SR);
				vec2 tx = nx.xy * 2.0 - 1.0, ty = ny.xy * 2.0 - 1.0, tz = nz.xy * 2.0 - 1.0;
				vec3 roff = vec3(0.0, tx.y, tx.x) * bw.x + vec3(ty.x, 0.0, ty.y) * bw.y + vec3(tz.x, tz.y, 0.0) * bw.z;
				vec4 rn = nx * bw.x + ny * bw.y + nz * bw.z;
				A = mix(A, ra, f); M = mix(M, layerMean(2.0), f); off = mix(off, roff * 1.4, f); rgh = mix(rgh, rn.b, f); ao = mix(ao, rn.a, f);
			}
		}
		if (snow > 0.01) LAYER_TOP(4.0, snow, (1.0 / 9.0))
		c = mix(c, c * clamp(A.rgb / M, 0.0, 3.0), nearT);
		Noff = off * nearT;
		tRough = mix(tRough, rgh, nearT * 0.85);
		tDetAO = mix(1.0, ao, nearT);
	}

	// ---------------- airports
	float pav = 0.0;
	float aa = max(fwidth(wp.x), fwidth(wp.z)) + 0.02;
	float texF = 1.0 - smoothstep(1500.0, 4000.0, dist);
	bool nearRwy = false;
	for (int i = 0; i < 3; i++) {
		if (i >= uRwyCount) break;
		if (length(wp.xz - uRwyA[i].xy) < uRwyA[i].w * 0.5 + 1200.0) nearRwy = true;
	}
	if (nearRwy) {
		if (texF > 0.0) {
			const float SA = 1.0 / 3.0, SC = 1.0 / 5.0;
			aspT = sA(vec3(wp.xz * SA, 6.0), gX * SA, gY * SA);
			aspN = sN(vec3(wp.xz * SA, 6.0), gX * SA, gY * SA);
			conT = sA(vec3(wp.xz * SC, 7.0), gX * SC, gY * SC);
		}
		airportSurface(wp, c, tRough, aa, aspT, conT, texF, pav);
		if (pav > 0.0) {
			Noff = mix(Noff, topOff(aspN) * 0.6 * texF, pav);
			tRough = mix(tRough, aspN.b, pav * texF * 0.6);
			tDetAO = mix(tDetAO, mix(1.0, aspN.a, texF), pav);
		}
	}
	tN = normalize(n + Noff);

	// ---------------- ocean / lakes
	float water = smoothstep(0.02, 0.6, vWater);
	if (water > 0.0) {
		float depth = vWater;
		vec2 g = waveSlope(wp.xz, dist, uTime);
		const float SW0 = 1.0 / 9.0, SW1 = 1.0 / 23.0;
		vec2 u0 = wp.xz * SW0 + vec2(uTime * 0.021, uTime * 0.013), u1 = wp.xz * SW1 - vec2(uTime * 0.008, -uTime * 0.017);
		vec4 r0 = sN(vec3(u0, 8.0), gX * SW0, gY * SW0), r1 = sN(vec3(u1, 8.0), gX * SW1, gY * SW1);
		vec2 rip = (r0.xy + r1.xy - 1.0) * (1.0 - smoothstep(300.0, 4000.0, dist)) * 0.35;
		vec3 wn = normalize(vec3(-g.x + rip.x, 1.0, -g.y + rip.y));
		vec3 deep = vec3(0.004, 0.018, 0.03);
		vec3 shallow = vec3(0.02, 0.09, 0.085);
		vec3 wc = mix(shallow, deep, smoothstep(0.5, 25.0, depth));
		// light scattering in wave crests facing the viewer
		vec3 V = normalize(cameraPosition - wp);
		wc += vec3(0.01, 0.05, 0.045) * pow(clamp(1.0 - dot(wn, V), 0.0, 1.0), 3.0) * smoothstep(-0.2, 0.3, uLightDir.y);
		wc = mix(vec3(0.3, 0.27, 0.19), wc, smoothstep(0.0, 1.8, depth));
		float foamN = vnoise(wp.xz * 0.25 + vec2(uTime * 0.3, 0.0)) * vnoise(wp.xz * 0.07 - uTime * 0.05);
		float foam = smoothstep(1.6, 0.2, depth + sin(uTime * 0.8 + wp.x * 0.05) * 0.4) * smoothstep(0.12, 0.3, foamN + (r0.x - 0.5) * 0.15) * (1.0 - smoothstep(800.0, 3000.0, dist));
		wc = mix(wc, vec3(0.7), foam);
		c = mix(c, wc, water);
		tN = normalize(mix(tN, wn, water));
		tRough = mix(tRough, mix(0.03 + 0.1 * smoothstep(400.0, 9000.0, dist), 0.8, foam), water);
		tWaterMask = water * (1.0 - foam);
		tDetAO = mix(tDetAO, 1.0, water);
	}
	tCloudShadow = wlCloudShadow(wp);
	col = c;
}
`;

function createTerrainMaterial(macroTex, cloudTex, layers) {
	const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
	worldUniforms.tWeather.value = cloudTex.weather;
	const uniforms = {
		tMacro: { value: macroTex },
		tDigits: { value: createDigitAtlas() },
		tLayA: { value: layers.A },
		tLayN: { value: layers.N },
		uTime: { value: 0 },
		uRwyA: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
		uRwyB: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
		uRwyCount: { value: 0 },
	};
	airports.slice(0, 3).forEach((ap, i) => {
		uniforms.uRwyA.value[i].set(ap.x, ap.z, ap.hdRad, ap.length);
		uniforms.uRwyB.value[i].set(ap.width, ap.numA, ap.numB, ap.elev);
	});
	uniforms.uRwyCount.value = Math.min(3, airports.length);
	mat.userData.uniforms = uniforms;
	mat.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms, worldUniforms);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nattribute float aWater;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nvarying float vWater;')
			.replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);\nvWater = aWater;');
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', '#include <common>\n' + WORLD_LIGHT_GLSL + TERRAIN_PARS)
			.replace('#include <color_fragment>', '#include <color_fragment>\nterrainShade(diffuseColor.rgb);')
			.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = tRough;')
			.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(tN, 0.0)).xyz);')
			.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n{ vec2 wlt = wlTerrain(vWPos); float sh = tCloudShadow * wlt.x;\nreflectedLight.directDiffuse *= sh;\nreflectedLight.directSpecular *= sh;\nreflectedLight.indirectDiffuse *= wlt.y * tDetAO;\nreflectedLight.indirectSpecular *= mix(1.0, 0.5 + 0.5 * sh, tWaterMask) * mix(0.55, 1.0, wlt.y * tDetAO); }');
	};
	mat.customProgramCacheKey = () => 'terrain-v2';
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
const TREE_CELL = 512;

// Low-poly but organic tree meshes with baked vertex AO.
function createTreeGeometries() {
	const merge = (parts) => {
		parts = parts.map((p) => ({ ...p, geo: p.geo.index ? p.geo.toNonIndexed() : p.geo }));
		let count = 0; parts.forEach((p) => { count += p.geo.attributes.position.count; });
		const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
		let off = 0;
		for (const p of parts) {
			const g = p.geo;
			g.computeVertexNormals();
			const pa = g.attributes.position, na = g.attributes.normal;
			for (let i = 0; i < pa.count; i++) {
				const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
				pos.set([x, y, z], (off + i) * 3);
				// foliage normals bend outward from the crown centre -> soft, rounded canopy shading
				let nx = na.getX(i), ny = na.getY(i), nz = na.getZ(i);
				if (p.crown) {
					const cx = x, cy = y - p.crown, cz = z;
					const l = Math.hypot(cx, cy, cz) || 1;
					nx = nx * 0.4 + cx / l * 0.6; ny = ny * 0.4 + cy / l * 0.6; nz = nz * 0.4 + cz / l * 0.6;
					const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
				}
				nor.set([nx, ny, nz], (off + i) * 3);
				const ao = p.ao ? 0.45 + 0.55 * Math.min(1, Math.max(0, (y - p.ao[0]) / (p.ao[1] - p.ao[0]))) : 1;
				const v = p.vary ? 0.85 + 0.3 * Math.abs(Math.sin(x * 3.1 + y * 1.7 + z * 2.3)) : 1;
				col.set([p.c[0] * ao * v, p.c[1] * ao * v, p.c[2] * ao * v], (off + i) * 3);
			}
			off += pa.count;
		}
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
		g.setAttribute('color', new THREE.BufferAttribute(col, 3));
		g.computeBoundingSphere();
		g.computeBoundingBox();
		return g;
	};
	const jag = (geo, amt, seed) => {
		const p = geo.attributes.position;
		for (let i = 0; i < p.count; i++) {
			const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
			const a = Math.atan2(z, x);
			const r = Math.hypot(x, z);
			const k = 1 + amt * (Math.sin(a * 7 + seed) * 0.6 + Math.sin(a * 13 + y * 2 + seed * 2) * 0.4);
			p.setXYZ(i, Math.cos(a) * r * k, y, Math.sin(a) * r * k);
		}
		return geo;
	};
	const trunk = new THREE.CylinderGeometry(0.16, 0.32, 3.2, 6).translate(0, 1.6, 0);
	const coniferParts = [{ geo: trunk, c: [0.13, 0.085, 0.05] }];
	for (let t = 0; t < 4; t++) {
		const r = 2.7 - t * 0.55, hh = 4.4 - t * 0.6, y = 2.0 + t * 2.3;
		const cone = jag(new THREE.ConeGeometry(r, hh, 11, 2), 0.16, t * 1.7).translate(0, y + hh / 2, 0);
		coniferParts.push({ geo: cone, c: [0.07, 0.125, 0.06], ao: [1.2, 13.0], vary: true, crown: 7 });
	}
	const conifer = merge(coniferParts);
	const blobs = [];
	const blobDefs = [[0, 6.2, 0, 2.6], [1.3, 5.2, 0.6, 1.9], [-1.2, 5.4, -0.5, 2.0], [0.3, 5.0, -1.4, 1.8], [-0.4, 7.4, 0.4, 1.8], [0.9, 6.8, -0.8, 1.6]];
	for (const [x, y, z, r] of blobDefs) {
		const g = new THREE.IcosahedronGeometry(r, 1);
		const p = g.attributes.position;
		for (let i = 0; i < p.count; i++) {
			const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
			const f = 1 + 0.14 * Math.sin(px * 2.3 + pz * 1.9) * Math.cos(py * 2.1);
			p.setXYZ(i, px * f + x, py * f * 0.85 + y, pz * f + z);
		}
		blobs.push({ geo: g, c: [0.09, 0.15, 0.045], ao: [3.2, 8.8], vary: true, crown: 6.2 });
	}
	const broad = merge([
		{ geo: new THREE.CylinderGeometry(0.18, 0.34, 4.6, 6).translate(0, 2.3, 0), c: [0.14, 0.1, 0.065] },
		...blobs,
	]);
	return { conifer, broad };
}

// Render each tree mesh into an atlas (side + top views) and build crossed-quad impostors.
function createImpostors(renderer, geos) {
	const T = 256;
	const rt = new THREE.WebGLRenderTarget(T * 2, T * 2, { depthBuffer: true });
	rt.texture.generateMipmaps = true;
	rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
	rt.texture.colorSpace = THREE.NoColorSpace;
	const scene = new THREE.Scene();
	const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
	const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
	const prevRT = renderer.getRenderTarget();
	renderer.setRenderTarget(rt);
	renderer.setClearColor(new THREE.Color(0.05, 0.09, 0.035), 0);
	renderer.clear();
	const out = {};
	['conifer', 'broad'].forEach((type, ti) => {
		const geo = geos[type];
		const bb = geo.boundingBox;
		const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 1.04;
		const hgt = (bb.max.y - bb.min.y) * 1.02;
		const mesh = new THREE.Mesh(geo, mat);
		scene.add(mesh);
		// side view (column ti, row 0)
		const sz = Math.max(w, hgt);
		const side = new THREE.OrthographicCamera(-sz / 2, sz / 2, sz, 0, 0.1, 100);
		side.position.set(0, bb.min.y, 50); side.lookAt(0, bb.min.y, 0);
		rt.viewport.set(ti * T, 0, T, T); rt.scissor.set(ti * T, 0, T, T); rt.scissorTest = true;
		renderer.setRenderTarget(rt);
		renderer.render(scene, side);
		// top view (column ti, row 1)
		const top = new THREE.OrthographicCamera(-w / 2, w / 2, w / 2, -w / 2, 0.1, 200);
		top.position.set(0, 100, 0); top.up.set(0, 0, -1); top.lookAt(0, 0, 0);
		rt.viewport.set(ti * T, T, T, T); rt.scissor.set(ti * T, T, T, T);
		renderer.setRenderTarget(rt);
		renderer.render(scene, top);
		scene.remove(mesh);
		// impostor geometry: two vertical crossed quads + one horizontal quad
		const u0 = ti * 0.5, u1 = u0 + 0.5;
		const hw = sz / 2, base = bb.min.y;
		const P = [], N = [], UV = [], I = [];
		const quad = (pts, nrm, uvs) => {
			const o = P.length / 3;
			pts.forEach((p, k) => { P.push(...p); N.push(...nrm[k]); UV.push(...uvs[k]); });
			I.push(o, o + 1, o + 2, o, o + 2, o + 3);
		};
		const sideUV = [[u0, 0], [u1, 0], [u1, 0.5], [u0, 0.5]];
		const rn = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
		quad([[-hw, base, 0], [hw, base, 0], [hw, base + sz, 0], [-hw, base + sz, 0]], [rn(-1, 0.3, 0.2), rn(1, 0.3, 0.2), rn(1, 1, 0.2), rn(-1, 1, 0.2)], sideUV);
		quad([[0, base, hw], [0, base, -hw], [0, base + sz, -hw], [0, base + sz, hw]], [rn(0.2, 0.3, 1), rn(0.2, 0.3, -1), rn(0.2, 1, -1), rn(0.2, 1, 1)], sideUV);
		const ty = base + hgt * 0.62, tw = w / 2;
		quad([[-tw, ty, tw], [tw, ty, tw], [tw, ty, -tw], [-tw, ty, -tw]], [rn(-0.4, 1, 0.4), rn(0.4, 1, 0.4), rn(0.4, 1, -0.4), rn(-0.4, 1, -0.4)],
			[[u0, 0.5], [u1, 0.5], [u1, 1], [u0, 1]]);
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
		g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
		g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
		g.setIndex(I);
		g.computeBoundingSphere();
		out[type] = g;
	});
	rt.scissorTest = false;
	rt.viewport.set(0, 0, T * 2, T * 2);
	renderer.setRenderTarget(prevRT);
	renderer.setClearColor(prevClear, prevAlpha);
	mat.dispose();
	return { geos: out, texture: rt.texture };
}

// subtle procedural leaf clumping for the near trees
function patchFoliage(mat) {
	const prev = mat.onBeforeCompile;
	mat.onBeforeCompile = (shader, r) => {
		if (prev) prev(shader, r);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vLeafP;')
			.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLeafP = position * 1.7;');
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>
varying vec3 vLeafP;
float lh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float ln3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(lh(i), lh(i + vec3(1,0,0)), f.x), mix(lh(i + vec3(0,1,0)), lh(i + vec3(1,1,0)), f.x), f.y),
	           mix(mix(lh(i + vec3(0,0,1)), lh(i + vec3(1,0,1)), f.x), mix(lh(i + vec3(0,1,1)), lh(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
			.replace('#include <color_fragment>', `#include <color_fragment>
	float leafN = ln3(vLeafP * 1.6) * 0.6 + ln3(vLeafP * 4.1) * 0.4;
	diffuseColor.rgb *= 0.7 + 0.6 * leafN;`)
			.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
	vec3 lp = vLeafP * 2.3;
	vec3 lg = vec3(ln3(lp + vec3(0.3, 0.0, 0.0)) - ln3(lp - vec3(0.3, 0.0, 0.0)), ln3(lp + vec3(0.0, 0.3, 0.0)) - ln3(lp - vec3(0.0, 0.3, 0.0)), ln3(lp + vec3(0.0, 0.0, 0.3)) - ln3(lp - vec3(0.0, 0.0, 0.3)));
	normal = normalize(normal + (viewMatrix * vec4(lg, 0.0)).xyz * 0.9);`);
	};
	const pk = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
	mat.customProgramCacheKey = () => pk() + '|leaf';
	return mat;
}

export class Terrain {
	constructor(scene, cloudTex, quality, renderer) {
		this.scene = scene;
		this.group = new THREE.Group();
		scene.add(this.group);
		const macro = createMacroTexture();
		this.macroForest = macro.forest;
		this.layers = generateLayerTextures(renderer, quality.texSize || 512);
		this.material = createTerrainMaterial(macro.tex, cloudTex, this.layers);
		this.uniforms = this.material.userData.uniforms;
		this.tiles = new Map();
		this.requests = new Map();
		this.frame = 0;
		this.ROOT = 16384;

		// forests
		this.treeGeos = createTreeGeometries();
		this.impostors = createImpostors(renderer, this.treeGeos);
		this.treeMat = patchFoliage(patchWorldLighting(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }), { key: 'tree' }));
		this.impMat = patchWorldLighting(new THREE.MeshStandardMaterial({
			map: this.impostors.texture, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
		}), { key: 'imp' });
		this.impMat.onBeforeCompile = ((prev) => (shader, r) => {
			prev(shader, r);
			// impostor atlas is stored linearly; boost to match the lit meshes
			shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= 1.25;');
		})(this.impMat.onBeforeCompile);
		this.treeGroup = new THREE.Group();
		scene.add(this.treeGroup);
		this.treeCells = new Map();
		this.setQuality(quality);
	}

	setQuality(q) {
		this.N = q.terrainN;
		this.splitK = q.terrainSplit;
		this.maxLevel = q.terrainMaxLevel;
		this.treeRadius = q.treeRadius;
		this.treeNear = q.treeNear || 1000;
		this.treeDensity = q.treeDensity;
		this.treeShadows = q.treeShadows;
		this.impMat.alphaToCoverage = q.msaa > 0;
		this.impMat.needsUpdate = true;
		for (const t of this.tiles.values()) { this.group.remove(t.mesh); t.mesh.geometry.dispose(); }
		this.tiles.clear();
		for (const c of this.treeCells.values()) this._disposeCell(c);
		this.treeCells.clear();
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
		if (this.tiles.size > 1500) {
			// keep every ancestor of a visible tile: they are needed the moment the view coarsens,
			// and evicting them would leave holes that blink until rebuilt
			const keep = new Set();
			for (const t of out) {
				let [l, ix, iz] = t.key.split(':').map(Number);
				while (l > 0) { l--; ix = Math.floor(ix / 2); iz = Math.floor(iz / 2); keep.add(l + ':' + ix + ':' + iz); }
			}
			const arr = [...this.tiles.values()].filter((t) => !t.mesh.visible && !keep.has(t.key) && this.frame - t.last > 90).sort((a, b) => a.last - b.last);
			for (let i = 0; i < arr.length && this.tiles.size > 1150; i++) {
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
		const S = TREE_CELL;
		const cand = Math.round(1040 * this.treeDensity);
		const out = { conifer: [], broad: [] };
		const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
		const up = new THREE.Vector3(0, 1, 0);
		for (let k = 0; k < cand; k++) {
			const r1 = hash2(ci * 7919 + k, cj * 104729 - k);
			const r2 = hash2(ci * 31 - k * 17, cj * 57 + k * 13);
			const r3 = hash2(ci + k * 101, cj - k * 211);
			const x = (ci + r1) * S, z = (cj + r2) * S;
			const f = sampleMacro(this.macroForest, x, z);
			const dens = smoothstep(0.52, 0.62, f);
			if (r3 > Math.max(dens, 0.035)) continue;
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
			const tint = 0.78 + hash2(ci + k, cj) * 0.4;
			const hue = hash2(k, k + ci);
			out[type].push({ m: m4.toArray(), c: [tint * (0.88 + hue * 0.3), tint, tint * (0.85 + hue * 0.12)] });
		}
		const cell = { cx: (ci + 0.5) * S, cz: (cj + 0.5) * S, types: {} };
		for (const type of ['conifer', 'broad']) {
			const arr = out[type];
			if (!arr.length) continue;
			const mats = new Float32Array(arr.length * 16), cols = new Float32Array(arr.length * 3);
			arr.forEach((t, i) => { mats.set(t.m, i * 16); cols.set(t.c, i * 3); });
			const mAttr = new THREE.InstancedBufferAttribute(mats, 16);
			const cAttr = new THREE.InstancedBufferAttribute(cols, 3);
			const mk = (geo, mat, shadow) => {
				const im = new THREE.InstancedMesh(geo, mat, arr.length);
				im.instanceMatrix = mAttr;
				im.instanceColor = cAttr;
				im.computeBoundingSphere();
				im.castShadow = shadow; im.receiveShadow = true;
				im.matrixAutoUpdate = false;
				im.visible = false;
				this.treeGroup.add(im);
				return im;
			};
			cell.types[type] = {
				near: mk(this.treeGeos[type], this.treeMat, this.treeShadows),
				far: mk(this.impostors.geos[type], this.impMat, false),
			};
		}
		return cell;
	}

	_disposeCell(cell) {
		for (const t of Object.values(cell.types)) {
			for (const m of [t.near, t.far]) { this.treeGroup.remove(m); m.dispose(); }
		}
	}

	updateTrees(cam, agl, force) {
		const S = TREE_CELL, R = this.treeRadius;
		const needed = new Set();
		const missing = [];
		if (R > 0 && agl < 4500) {
			const ci0 = Math.floor((cam.x - R) / S), ci1 = Math.floor((cam.x + R) / S);
			const cj0 = Math.floor((cam.z - R) / S), cj1 = Math.floor((cam.z + R) / S);
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
		const lim = force ? missing.filter((m) => m.d < 1600).length : 1;
		for (let k = 0; k < Math.min(Math.max(lim, 1), missing.length); k++) {
			const m = missing[k];
			this.treeCells.set(m.key, this._buildTreeCell(m.i, m.j));
		}
		for (const [key, cell] of this.treeCells) {
			if (!needed.has(key)) {
				const d = Math.hypot(cell.cx - cam.x, cell.cz - cam.z);
				if (d > R + S * 1.2 || agl >= 5000) { this._disposeCell(cell); this.treeCells.delete(key); continue; }
			}
			const d = Math.hypot(cell.cx - cam.x, cell.cz - cam.z, agl * 0.7);
			const near = d < this.treeNear + S * 0.7;
			for (const t of Object.values(cell.types)) { t.near.visible = near; t.far.visible = !near; }
		}
	}

	setEnv(env, lightDir, time) {
		this.uniforms.uTime.value = time;
		const u = worldUniforms;
		u.uLightDir.value.copy(lightDir);
		u.uCoverage.value = env.coverage;
		u.uCloudMid.value = (env.cloudBase + env.cloudTop) * 0.5;
		u.uCloudsOn.value = env.coverage > 0.01 ? 1 : 0;
		u.uWind.value.copy(env.cloudOffset);
	}
}
