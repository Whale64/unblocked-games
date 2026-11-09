// Volumetric clouds: procedural tileable 3D noise textures + spherical-shell raymarcher.
import * as THREE from 'three';
import { ATMOS_GLSL } from './atmosphere.js';

// ---------- tileable noise generation (CPU, once at startup) ----------
function hash3(x, y, z, s) {
	let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683) ^ Math.imul(s, 2246822519);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const G3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];

function perlin3(x, y, z, P, seed) {
	const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
	const xf = x - xi, yf = y - yi, zf = z - zi;
	const u = fade(xf), v = fade(yf), w = fade(zf);
	let res = 0;
	const vals = [];
	for (let c = 0; c < 8; c++) {
		const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
		const g = G3[Math.floor(hash3(((xi + dx) % P + P) % P, ((yi + dy) % P + P) % P, ((zi + dz) % P + P) % P, seed) * 12)];
		vals.push(g[0] * (xf - dx) + g[1] * (yf - dy) + g[2] * (zf - dz));
	}
	const lx = (a, b, t) => a + (b - a) * t;
	res = lx(
		lx(lx(vals[0], vals[1], u), lx(vals[2], vals[3], u), v),
		lx(lx(vals[4], vals[5], u), lx(vals[6], vals[7], u), v), w);
	return res;
}

function worley3(x, y, z, C, seed) {
	// x,y,z in [0,1); C cells per side
	const px = x * C, py = y * C, pz = z * C;
	const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
	let md = 1e9;
	for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
		const ix = cx + i, iy = cy + j, iz = cz + k;
		const wx = ((ix % C) + C) % C, wy = ((iy % C) + C) % C, wz = ((iz % C) + C) % C;
		const fx = ix + hash3(wx, wy, wz, seed);
		const fy = iy + hash3(wx, wy, wz, seed + 1);
		const fz = iz + hash3(wx, wy, wz, seed + 2);
		const dx = fx - px, dy = fy - py, dz = fz - pz;
		const d = dx * dx + dy * dy + dz * dz;
		if (d < md) md = d;
	}
	return 1 - Math.min(1, Math.sqrt(md));
}

function make3DTexture(size, fn) {
	const data = new Uint8Array(size * size * size);
	let i = 0;
	for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		const v = fn(x / size, y / size, z / size);
		data[i++] = Math.max(0, Math.min(255, Math.round(v * 255)));
	}
	const tex = new THREE.Data3DTexture(data, size, size, size);
	tex.format = THREE.RedFormat;
	tex.type = THREE.UnsignedByteType;
	tex.minFilter = THREE.LinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
	tex.unpackAlignment = 1;
	tex.needsUpdate = true;
	return tex;
}

function perlin2Tile(x, y, P, seed) {
	const xi = Math.floor(x), yi = Math.floor(y);
	const xf = x - xi, yf = y - yi;
	const u = fade(xf), v = fade(yf);
	const g = (ix, iy) => {
		const a = hash3(((ix % P) + P) % P, ((iy % P) + P) % P, 0, seed) * Math.PI * 2;
		return [Math.cos(a), Math.sin(a)];
	};
	const d = (ix, iy) => { const gg = g(ix, iy); return gg[0] * (x - ix) + gg[1] * (y - iy); };
	const a = d(xi, yi), b = d(xi + 1, yi), c = d(xi, yi + 1), e = d(xi + 1, yi + 1);
	return (a + (b - a) * u) + ((c + (e - c) * u) - (a + (b - a) * u)) * v;
}

export function fbm2Tile(x, y, P, oct, seed) {
	let s = 0, a = 0.5, f = 1, n = 0;
	for (let i = 0; i < oct; i++) { s += perlin2Tile(x * f, y * f, P * f, seed + i * 13) * a; n += a; a *= 0.5; f *= 2; }
	return s / n;
}

export const WEATHER_SIZE = 256;
export const WEATHER_SCALE = 36000; // metres covered by one tile of the weather map

export function createCloudTextures() {
	const shape = make3DTexture(64, (x, y, z) => {
		let p = 0, a = 1, f = 4, n = 0;
		for (let o = 0; o < 4; o++) { p += perlin3(x * f, y * f, z * f, f, 11 + o) * a; n += a; a *= 0.5; f *= 2; }
		p = p / n * 0.5 + 0.5 + 0.1;
		const w = worley3(x, y, z, 4, 3) * 0.625 + worley3(x, y, z, 8, 5) * 0.25 + worley3(x, y, z, 16, 7) * 0.125;
		const pw = Math.max(0, (p - (1 - w)) / (1 - (1 - w) + 1e-4)); // perlin-worley remap
		const w2 = worley3(x, y, z, 8, 21) * 0.6 + worley3(x, y, z, 16, 23) * 0.3 + worley3(x, y, z, 32, 25) * 0.1;
		return Math.min(1, pw * 0.65 + w2 * 0.45 - 0.1);
	});
	const detail = make3DTexture(32, (x, y, z) => {
		return worley3(x, y, z, 4, 31) * 0.625 + worley3(x, y, z, 8, 33) * 0.25 + worley3(x, y, z, 16, 35) * 0.125;
	});
	const N = WEATHER_SIZE;
	const wData = new Uint8Array(N * N * 4);
	const wF = new Float32Array(N * N);
	for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
		const u = i / N, v = j / N;
		let c = fbm2Tile(u * 6, v * 6, 6, 5, 101) * 1.7 + 0.5;
		c = Math.max(0, Math.min(1, c));
		const hvar = Math.max(0, Math.min(1, fbm2Tile(u * 4, v * 4, 4, 3, 202) * 1.5 + 0.5));
		const o = (j * N + i) * 4;
		wData[o] = c * 255; wData[o + 1] = hvar * 255; wData[o + 2] = 0; wData[o + 3] = 255;
		wF[j * N + i] = c;
	}
	const weather = new THREE.DataTexture(wData, N, N, THREE.RGBAFormat);
	weather.wrapS = weather.wrapT = THREE.RepeatWrapping;
	weather.minFilter = THREE.LinearFilter; weather.magFilter = THREE.LinearFilter;
	weather.needsUpdate = true;
	return { shape, detail, weather, weatherData: wF };
}

// Coverage as used by the shader, evaluated on the CPU (for cloud shadows on the aircraft).
export function sampleCoverageCPU(weatherData, x, z, windOffset, coverage) {
	const N = WEATHER_SIZE;
	let u = ((x + windOffset.x) / WEATHER_SCALE) * N, v = ((z + windOffset.y) / WEATHER_SCALE) * N;
	u = ((u % N) + N) % N; v = ((v % N) + N) % N;
	const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
	const i1 = (i0 + 1) % N, j1 = (j0 + 1) % N;
	const a = weatherData[j0 * N + i0], b = weatherData[j0 * N + i1], c = weatherData[j1 * N + i0], d = weatherData[j1 * N + i1];
	const w = (a + (b - a) * fu) + ((c + (d - c) * fu) - (a + (b - a) * fu)) * fv;
	const lo = 1 - coverage, hi = 1 - coverage + 0.35;
	const t = Math.min(1, Math.max(0, (w - lo) / (hi - lo)));
	return t * t * (3 - 2 * t);
}

export const CLOUD_DENSITY_GLSL = /* glsl */`
precision highp sampler3D;
uniform sampler3D tShape;
uniform sampler3D tDetail;
uniform sampler2D tWeather;
uniform float uBase, uTop, uCoverage, uDensity;
uniform vec2 uWind;
uniform float uTime;

float cloudLocalCoverage(vec2 xz, out float hvar) {
	vec4 w = texture(tWeather, (xz + uWind) / ${WEATHER_SCALE.toFixed(1)});
	hvar = w.g;
	return smoothstep(1.0 - uCoverage, 1.0 - uCoverage + 0.35, w.r);
}

float cloudDensity(vec3 p, float h, bool detail) {
	float hf = (h - uBase) / (uTop - uBase);
	if (hf <= 0.0 || hf >= 1.0) return 0.0;
	float hvar;
	float lc = cloudLocalCoverage(p.xz, hvar);
	if (lc <= 0.001) return 0.0;
	float topF = mix(0.55, 1.0, hvar);
	float grad = smoothstep(0.0, 0.08, hf) * smoothstep(topF, topF * 0.55, hf);
	vec3 sp = p * (1.0 / 3400.0) + vec3(uWind.x, 0.0, uWind.y) * (1.0 / 3400.0) + vec3(0.0, uTime * 0.0004, 0.0);
	float n = texture(tShape, sp).r;
	float base = n * grad;
	float d = clamp((base - (1.0 - lc)) / max(lc, 0.05), 0.0, 1.0);
	if (detail && d > 0.0) {
		float dn = texture(tDetail, p * (1.0 / 700.0) + vec3(uTime * 0.002, 0.0, 0.0)).r;
		float er = dn * mix(0.45, 0.2, hf);
		d = clamp((d - er) / (1.0 - er), 0.0, 1.0);
	}
	return d;
}
`;

export function createCloudMaterial(tex, skyLUT, depthTex) {
	return new THREE.ShaderMaterial({
		depthTest: false, depthWrite: false,
		uniforms: {
			tSkyLUT: { value: skyLUT },
			tDepth: { value: depthTex },
			tShape: { value: tex.shape },
			tDetail: { value: tex.detail },
			tWeather: { value: tex.weather },
			uInvProj: { value: new THREE.Matrix4() },
			uCamWorld: { value: new THREE.Matrix4() },
			uCamPos: { value: new THREE.Vector3() },
			uLogF: { value: 1 },
			uLightDir: { value: new THREE.Vector3(0, 1, 0) },
			uSunLight: { value: new THREE.Color(1, 1, 1) },
			uGroundBounce: { value: new THREE.Color(0, 0, 0) },
			uNightSky: { value: new THREE.Color(0, 0, 0) },
			uBase: { value: 1500 }, uTop: { value: 2800 }, uCoverage: { value: 0.5 }, uDensity: { value: 0.03 },
			uWind: { value: new THREE.Vector2() }, uTime: { value: 0 },
			uSteps: { value: 48 }, uMaxDist: { value: 70000 },
			uFullRes: { value: new THREE.Vector2(1, 1) },
			uHaze: { value: 1e-5 }, uHazeH: { value: 1500 },
		},
		vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
		fragmentShader: /* glsl */`
precision highp float;
${ATMOS_GLSL}
${CLOUD_DENSITY_GLSL}
uniform sampler2D tDepth;
uniform mat4 uInvProj, uCamWorld;
uniform vec3 uCamPos;
uniform float uLogF;
uniform vec3 uLightDir;
uniform vec3 uSunLight, uGroundBounce, uNightSky;
uniform int uSteps;
uniform float uMaxDist;
uniform vec2 uFullRes;
varying vec2 vUv;

float lightMarch(vec3 p, float h) {
	float tau = 0.0;
	float st = (uTop - uBase) * 0.06;
	float t = 0.0;
	for (int j = 0; j < 6; j++) {
		float tm = t + st * 0.5;
		vec3 q = p + uLightDir * tm;
		float hq = h + uLightDir.y * tm;
		tau += cloudDensity(q, hq, j < 2) * uDensity * st;
		t += st;
		st *= 1.7;
	}
	return tau;
}

void main() {
	vec2 ndc = vUv * 2.0 - 1.0;
	vec4 vp = uInvProj * vec4(ndc, 1.0, 1.0);
	vec3 dirV = normalize(vp.xyz / vp.w);
	vec3 dir = normalize(mat3(uCamWorld) * dirV);

	// farthest depth of the 2x2 full-res footprint
	vec2 px = 0.5 / uFullRes;
	float d = max(max(texture2D(tDepth, vUv + vec2(-px.x, -px.y)).x, texture2D(tDepth, vUv + vec2(px.x, -px.y)).x),
	              max(texture2D(tDepth, vUv + vec2(-px.x, px.y)).x, texture2D(tDepth, vUv + vec2(px.x, px.y)).x));
	float sceneDist = 1e9;
	if (d < 0.999999) sceneDist = (exp2(d * uLogF) - 1.0) / max(-dirV.z, 1e-4);

	vec3 ro = vec3(0.0, A_RG + uCamPos.y, 0.0);
	vec2 tIn = aRaySphere(ro, dir, A_RG + uBase);
	vec2 tOut = aRaySphere(ro, dir, A_RG + uTop);
	float t0, t1;
	float h0 = uCamPos.y;
	if (h0 < uBase) {
		vec2 g = aRaySphere(ro, dir, A_RG);
		if (g.x > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
		t0 = tIn.y; t1 = tOut.y;
	} else if (h0 < uTop) {
		t0 = 0.0; t1 = tIn.x > 0.0 ? tIn.x : tOut.y;
	} else {
		if (tOut.x < 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
		t0 = tOut.x; t1 = tIn.x > 0.0 ? tIn.x : tOut.y;
	}
	t1 = min(t1, min(sceneDist, uMaxDist));
	if (t0 >= t1) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

	float seg = t1 - t0;
	float dt = max(seg / float(uSteps), 25.0);
	dt = min(dt, 900.0);
	float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
	float t = t0 + dt * jitter;

	float mu = dot(dir, uLightDir);
	float phase = mix(aHG(0.8, mu), aHG(-0.2, mu), 0.3) + 0.25 * aHG(0.45, mu);
	vec3 ambTop = sampleSky(vec3(0.0, 1.0, 0.0)) * 0.55 + sampleSky(normalize(vec3(dir.x, 0.15, dir.z))) * 0.45 + uNightSky;
	vec3 ambBot = ambTop * 0.3 + uGroundBounce;

	float T = 1.0;
	vec3 L = vec3(0.0);
	float tw = 0.0, ws = 0.0;
	for (int i = 0; i < 160; i++) {
		if (i >= uSteps || t > t1) break;
		vec3 p = uCamPos + dir * t;
		float h = length(ro + dir * t) - A_RG;
		float den = cloudDensity(p, h, t < 22000.0);
		if (den > 0.003) {
			float sigma = den * uDensity;
			float tau = lightMarch(p, h);
			float beer = exp(-tau);
			// multiple-scattering approximation: attenuated, broad isotropic-ish lobe (~3x single scatter)
			float msE = exp(-tau * 0.22) * 0.65 + exp(-tau * 0.07) * 0.35;
			float powder = 1.0 - exp(-sigma * 140.0);
			float hf = clamp((h - uBase) / (uTop - uBase), 0.0, 1.0);
			vec3 amb = mix(ambBot, ambTop, hf * hf * (3.0 - 2.0 * hf));
			vec3 S = uSunLight * (phase * beer * mix(0.65, 1.0, powder) + 0.24 * msE * mix(0.45, 1.0, powder)) + amb;
			float Ts = exp(-sigma * dt);
			float a = T * (1.0 - Ts);
			L += S * a;
			tw += t * a; ws += a;
			T *= Ts;
			if (T < 0.015) break;
		}
		t += dt;
	}
	float tAvg = ws > 0.0 ? tw / ws : t1;
	vec3 Tf = aerialTransmittance(uCamPos.y, dir, tAvg);
	float alpha = 1.0 - T;
	L = L * Tf + (aerialInscatter(dir) + uNightSky) * (1.0 - Tf) * alpha;
	gl_FragColor = vec4(L, T);
}
`,
	});
}
