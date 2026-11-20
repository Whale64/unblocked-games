// GPU procedural PBR texture synthesis. Produces two tileable, mip-mapped 2D texture arrays:
//   A: rgb = albedo (gamma-2 encoded), a = height
//   N: rg = tangent-space normal xy, b = roughness, a = ambient occlusion
// Layers: 0 grass, 1 dry soil, 2 rock, 3 sand, 4 snow, 5 forest floor, 6 asphalt, 7 concrete, 8 water ripples
import * as THREE from 'three';

export const LAYERS = { grass: 0, dirt: 1, rock: 2, sand: 3, snow: 4, forest: 5, asphalt: 6, concrete: 7, water: 8 };
const NUM = 9;

const NOISE = /* glsl */`
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 h22(vec2 p) { float n = h21(p); return vec2(n, h21(p + n + 17.17)); }
vec2 grd(vec2 i, vec2 P) { float a = h21(mod(i, P)) * 6.2831853; return vec2(cos(a), sin(a)); }
// tileable gradient noise in [0,1], period P (lattice units)
float gn(vec2 p, vec2 P) {
	vec2 i = floor(p), f = fract(p);
	vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
	float a = dot(grd(i, P), f), b = dot(grd(i + vec2(1, 0), P), f - vec2(1, 0));
	float c = dot(grd(i + vec2(0, 1), P), f - vec2(0, 1)), d = dot(grd(i + vec2(1, 1), P), f - vec2(1, 1));
	return clamp(mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.3 + 0.5, 0.0, 1.0);
}
float fbm(vec2 uv, vec2 F, int oct, float gain) {
	float s = 0.0, a = 0.5, n = 0.0; vec2 f = F;
	for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * gn(uv * f, f); n += a; a *= gain; f *= 2.0; }
	return s / n;
}
// tileable voronoi: (F1, F2, cell id)
vec3 vor(vec2 uv, float F) {
	vec2 p = uv * F, i = floor(p), f = fract(p);
	float f1 = 8.0, f2 = 8.0, id = 0.0;
	for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
		vec2 g = vec2(x, y);
		vec2 o = h22(mod(i + g, F));
		vec2 r = g + o - f;
		float d = dot(r, r);
		if (d < f1) { f2 = f1; f1 = d; id = h21(mod(i + g, F) + 3.1); } else if (d < f2) f2 = d;
	}
	return vec3(sqrt(f1), sqrt(f2), id);
}
`;

const GEN_FRAG = /* glsl */`
precision highp float;
uniform int uLayer;
varying vec2 vUv;
${NOISE}
void main() {
	vec2 uv = vUv;
	vec3 col = vec3(0.5); float h = 0.5;
	if (uLayer == 0) { // grass: hundreds of randomly oriented tapered blades over thatch, soil and clover
		float lush = fbm(uv + 0.31, vec2(3.0), 4, 0.5);
		float base = fbm(uv, vec2(9.0), 5, 0.55);
		// background: dead thatch and soil showing through
		col = mix(vec3(0.045, 0.040, 0.020), vec3(0.11, 0.095, 0.05), base);
		float thatch = pow(gn(uv * 70.0 + base * 3.0, vec2(70.0)), 3.0);
		col = mix(col, vec3(0.20, 0.17, 0.09), thatch * 0.6);
		h = base * 0.15;
		// clover / weed patches
		float clov = smoothstep(0.62, 0.72, fbm(uv + 7.3, vec2(9.0), 4, 0.5));
		if (clov > 0.0) {
			vec3 lv = vor(uv, 90.0);
			float leaf = smoothstep(0.45, 0.3, lv.x) * clov;
			col = mix(col, mix(vec3(0.06, 0.10, 0.035), vec3(0.08, 0.125, 0.04), lv.z), leaf * 0.7);
			h = max(h, leaf * (0.45 - lv.x) * 1.4 + 0.2 * leaf);
		}
		// three layers of blades, each cell holding two blades with random direction, length and tint
		for (int L = 0; L < 3; L++) {
			float F = L == 0 ? 48.0 : (L == 1 ? 72.0 : 104.0);
			vec2 p = uv * F, ci = floor(p), cf = fract(p);
			for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
				vec2 g = vec2(x, y);
				vec2 cell = mod(ci + g, F);
				for (int k = 0; k < 2; k++) {
					float kk = float(k) * 7.13 + float(L) * 3.7;
					vec2 r = h22(cell + kk);
					float r3 = h21(cell * 1.7 + kk + 11.0);
					float ang = r3 * 6.2831853;
					vec2 dir = vec2(cos(ang), sin(ang)), perp = vec2(-dir.y, dir.x);
					vec2 loc = cf - (g + r);
					float len = 0.9 + 1.1 * h21(cell + kk + 5.0);
					float t = dot(loc, dir) / len;
					if (t < 0.0 || t > 1.0) continue;
					float across = dot(loc, perp);
					float w = (0.075 + 0.04 * r.x) * (1.0 - t * 0.85) * (1.0 + 0.4 * float(2 - L) * 0.5);
					float a = abs(across) / w;
					if (a > 1.0) continue;
					float hb = 0.3 + float(L) * 0.2 + t * 0.25 + r.y * 0.1 + (1.0 - a * a) * 0.08;
					if (hb <= h) continue;
					h = hb;
					float dryB = step(0.9, h21(cell + kk + 23.0)) + lush * 0.15;
					vec3 g0 = mix(vec3(0.07, 0.13, 0.03), vec3(0.13, 0.20, 0.05), r.x);
					g0 = mix(g0, vec3(0.05, 0.11, 0.04), r.y * 0.5);
					g0 = mix(g0, vec3(0.26, 0.23, 0.10), clamp(dryB, 0.0, 1.0) * 0.7);
					g0 *= 0.65 + 0.55 * t; // darker at the base, catching light toward the tip
					g0 *= 1.0 - 0.25 * a * a; // rounded blade, darker at the edges
					col = g0 * (0.8 + 0.4 * lush);
				}
			}
		}
	} else if (uLayer == 1) { // dry soil with pebbles and sparse straw
		float base = fbm(uv, vec2(5.0), 6, 0.55);
		vec3 pv = vor(uv, 36.0);
		float peb = smoothstep(0.42, 0.28, pv.x) * step(0.45, pv.z);
		vec3 soil = mix(vec3(0.11, 0.075, 0.045), vec3(0.22, 0.16, 0.10), base);
		vec3 pc = mix(vec3(0.20, 0.19, 0.17), vec3(0.34, 0.31, 0.27), h21(vec2(pv.z * 91.0)));
		col = mix(soil, pc, peb);
		float straw = pow(gn(vec2(uv.x * 120.0, uv.y * 10.0), vec2(120.0, 10.0)), 6.0);
		col = mix(col, vec3(0.32, 0.27, 0.15), straw * 0.6);
		h = base * 0.5 + peb * (0.5 - pv.x) * 1.4 + straw * 0.2;
	} else if (uLayer == 2) { // rock: cracks, strata, lichen
		vec3 v = vor(uv, 5.0);
		vec3 v2 = vor(uv, 17.0);
		float grain = fbm(uv, vec2(16.0), 5, 0.6);
		float big = fbm(uv, vec2(3.0), 4, 0.5);
		float crack = smoothstep(0.0, 0.06, v.y - v.x) * (0.6 + 0.4 * smoothstep(0.0, 0.05, v2.y - v2.x));
		float strata = 0.5 + 0.5 * sin((uv.y + big * 0.25) * 6.2831853 * 9.0);
		col = mix(vec3(0.12, 0.11, 0.10), vec3(0.32, 0.30, 0.27), grain * 0.6 + strata * 0.25 + v.z * 0.2);
		col *= mix(0.45, 1.0, crack);
		float lichen = smoothstep(0.68, 0.78, fbm(uv + 3.7, vec2(9.0), 4, 0.5));
		col = mix(col, vec3(0.26, 0.25, 0.12), lichen * 0.6);
		h = grain * 0.45 + big * 0.35 + crack * 0.25 + v.z * 0.1;
	} else if (uLayer == 3) { // sand: fine grain + wind ripples
		float base = fbm(uv, vec2(4.0), 4, 0.5);
		float grain = gn(uv * 256.0, vec2(256.0));
		float rip = 0.5 + 0.5 * sin((uv.x * 18.0 + fbm(uv, vec2(3.0), 3, 0.5) * 2.2) * 6.2831853);
		col = mix(vec3(0.36, 0.31, 0.21), vec3(0.55, 0.49, 0.36), base * 0.6 + grain * 0.4);
		vec3 sh = vor(uv, 40.0);
		col = mix(col, vec3(0.62, 0.6, 0.55), smoothstep(0.2, 0.1, sh.x) * step(0.93, sh.z));
		h = rip * 0.55 + grain * 0.2 + base * 0.25;
	} else if (uLayer == 4) { // snow: soft drifts, blue hollows
		float base = fbm(uv, vec2(4.0), 6, 0.5);
		float fine = gn(uv * 128.0, vec2(128.0));
		col = mix(vec3(0.62, 0.68, 0.78), vec3(0.88, 0.9, 0.93), smoothstep(0.25, 0.75, base));
		col *= 0.96 + 0.04 * fine;
		h = base * 0.9 + fine * 0.1;
	} else if (uLayer == 5) { // forest floor: needles, moss, twigs
		float base = fbm(uv, vec2(5.0), 5, 0.55);
		float n1 = gn(vec2(uv.x * 200.0, uv.y * 20.0), vec2(200.0, 20.0));
		float n2 = gn(vec2(uv.x * 22.0, uv.y * 190.0), vec2(22.0, 190.0));
		float needles = pow(max(n1, n2), 3.0);
		float moss = smoothstep(0.5, 0.7, fbm(uv + 1.3, vec2(4.0), 4, 0.5));
		col = mix(vec3(0.07, 0.045, 0.025), vec3(0.20, 0.11, 0.05), needles);
		col = mix(col, vec3(0.06, 0.10, 0.03), moss * 0.8);
		vec3 tw = vor(uv, 8.0);
		float twig = smoothstep(0.03, 0.0, abs(tw.y - tw.x - 0.02)) * step(0.7, tw.z);
		col = mix(col, vec3(0.16, 0.11, 0.07), twig);
		h = needles * 0.5 + base * 0.3 + moss * 0.2 + twig * 0.3;
	} else if (uLayer == 6) { // asphalt: aggregate, binder, sealed cracks
		vec3 st = vor(uv, 110.0);
		float stone = smoothstep(0.5, 0.25, st.x);
		float fine = gn(uv * 256.0, vec2(256.0));
		float blot = fbm(uv, vec2(4.0), 4, 0.5);
		col = vec3(0.028, 0.028, 0.03) * (0.8 + 0.4 * blot);
		col = mix(col, vec3(0.05 + 0.09 * st.z), stone * (0.55 + 0.45 * fine));
		vec3 cr = vor(uv, 3.0);
		float crack = smoothstep(0.012, 0.0, cr.y - cr.x) * step(0.4, fbm(uv + 7.0, vec2(5.0), 3, 0.5));
		col = mix(col, vec3(0.012), crack);
		h = stone * (0.5 - st.x) + fine * 0.2 - crack * 0.4 + 0.3;
	} else if (uLayer == 7) { // concrete: pores, stains, aggregate
		float base = fbm(uv, vec2(4.0), 6, 0.55);
		float pores = smoothstep(0.82, 0.9, gn(uv * 220.0, vec2(220.0)));
		vec3 ag = vor(uv, 70.0);
		col = mix(vec3(0.32, 0.31, 0.29), vec3(0.46, 0.45, 0.42), base);
		col *= 0.95 + 0.08 * smoothstep(0.4, 0.2, ag.x) * ag.z;
		col *= 1.0 - pores * 0.35;
		float stain = smoothstep(0.6, 0.85, fbm(uv + 5.0, vec2(3.0), 4, 0.5));
		col *= 1.0 - stain * 0.3;
		h = base * 0.6 - pores * 0.3 + 0.3;
	} else { // water ripples (height only)
		float r1 = fbm(uv, vec2(8.0), 5, 0.5);
		float r2 = fbm(uv + 0.37, vec2(16.0, 12.0), 4, 0.55);
		h = r1 * 0.6 + r2 * 0.4;
		col = vec3(0.0);
	}
	gl_FragColor = vec4(sqrt(clamp(col, 0.0, 1.0)), clamp(h, 0.0, 1.0));
}`;

const NORM_FRAG = /* glsl */`
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray tA;
uniform int uLayer;
uniform float uSize;
varying vec2 vUv;
float H(vec2 o) { return textureLod(tA, vec3(vUv + o / uSize, float(uLayer)), 0.0).a; }
void main() {
	float s = uLayer == 2 ? 7.0 : (uLayer == 4 ? 2.5 : (uLayer == 8 ? 5.0 : (uLayer == 6 ? 5.0 : 4.0)));
	float tl = H(vec2(-1, -1)), t = H(vec2(0, -1)), tr = H(vec2(1, -1));
	float l = H(vec2(-1, 0)), c = H(vec2(0)), r = H(vec2(1, 0));
	float bl = H(vec2(-1, 1)), b = H(vec2(0, 1)), br = H(vec2(1, 1));
	float dx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
	float dy = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);
	vec3 n = normalize(vec3(-dx * s, -dy * s, 1.0));
	float cav = clamp(1.0 - ((tl + t + tr + l + r + bl + b + br) / 8.0 - c) * 6.0, 0.0, 1.0);
	float ao = mix(0.55, 1.0, cav) * mix(0.7, 1.0, c);
	float rough = 0.92;
	if (uLayer == 2) rough = mix(0.95, 0.72, c);
	else if (uLayer == 3) rough = 0.96;
	else if (uLayer == 4) rough = mix(0.75, 0.45, c);
	else if (uLayer == 6) rough = mix(0.95, 0.72, c);
	else if (uLayer == 7) rough = mix(0.92, 0.8, c);
	else if (uLayer == 8) rough = 0.05;
	gl_FragColor = vec4(n.xy * 0.5 + 0.5, rough, ao);
}`;

export function generateLayerTextures(renderer, size = 512) {
	const mk = () => {
		const rt = new THREE.WebGLArrayRenderTarget(size, size, NUM, { depthBuffer: false });
		const t = rt.texture;
		t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
		t.wrapS = t.wrapT = THREE.RepeatWrapping;
		t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
		t.generateMipmaps = true;
		t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
		return rt;
	};
	const A = mk(), N = mk();
	const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	const vs = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
	const genMat = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: GEN_FRAG, uniforms: { uLayer: { value: 0 } }, depthTest: false, depthWrite: false });
	const nMat = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: NORM_FRAG, uniforms: { tA: { value: A.texture }, uLayer: { value: 0 }, uSize: { value: size } }, depthTest: false, depthWrite: false });
	const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), genMat);
	quad.frustumCulled = false;
	const prev = renderer.getRenderTarget();
	for (let i = 0; i < NUM; i++) {
		genMat.uniforms.uLayer.value = i;
		renderer.setRenderTarget(A, i);
		renderer.render(quad, cam);
	}
	quad.material = nMat;
	for (let i = 0; i < NUM; i++) {
		nMat.uniforms.uLayer.value = i;
		renderer.setRenderTarget(N, i);
		renderer.render(quad, cam);
	}
	renderer.setRenderTarget(prev);
	genMat.dispose(); nMat.dispose(); quad.geometry.dispose();
	return { A: A.texture, N: N.texture };
}
