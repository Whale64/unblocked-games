// Physically based atmosphere: sky-view LUT (Rayleigh + Mie + ozone single scattering),
// sun/moon positions, sun transmittance (for light colour) and PMREM environment maps.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export const SUN_INTENSITY = 20.0;
const RG = 6360e3, RT = 6460e3;
const BETA_R = [5.802e-6, 13.558e-6, 33.1e-6];
const BETA_MS = 3.996e-6, BETA_MA = 4.4e-6;
const BETA_O = [0.65e-6, 1.881e-6, 0.085e-6];

export const ATMOS_GLSL = /* glsl */`
#define A_PI 3.14159265359
const float A_RG = 6360e3;
const float A_RT = 6460e3;
const vec3 A_BETA_R = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const float A_BETA_MS = 3.996e-6;
const float A_BETA_MA = 4.40e-6;
const vec3 A_BETA_O = vec3(0.650e-6, 1.881e-6, 0.085e-6);

vec2 aRaySphere(vec3 ro, vec3 rd, float r) {
	float b = dot(ro, rd);
	float c = dot(ro, ro) - r * r;
	float h = b * b - c;
	if (h < 0.0) return vec2(-1.0, -2.0);
	h = sqrt(h);
	return vec2(-b - h, -b + h);
}
float aRayleighPhase(float mu) { return 3.0 / (16.0 * A_PI) * (1.0 + mu * mu); }
float aHG(float g, float mu) { float g2 = g * g; return (1.0 - g2) / (4.0 * A_PI * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5)); }

uniform sampler2D tSkyLUT;
vec3 sampleSky(vec3 dir) {
	float el = asin(clamp(dir.y, -1.0, 1.0));
	float az = atan(dir.x, -dir.z);
	if (az < 0.0) az += 2.0 * A_PI;
	float v = sign(el) * sqrt(abs(el) / (0.5 * A_PI));
	return texture2D(tSkyLUT, vec2(az / (2.0 * A_PI), clamp(v * 0.5 + 0.5, 0.004, 0.996))).rgb;
}

// Aerial perspective: transmittance + in-scatter along a ray of length dist from camera height y0.
uniform float uHaze;      // haze extinction at sea level (1/m)
uniform float uHazeH;     // haze scale height (m)
float aHeightIntegral(float y0, float k, float dist, float H) {
	float a = exp(-max(y0, -500.0) / H);
	float kd = k * dist / H;
	if (abs(kd) < 1e-3) return a * dist * (1.0 - 0.5 * kd);
	return a * H / k * (1.0 - exp(-kd));
}
vec3 aerialTransmittance(float y0, vec3 dir, float dist) {
	float iR = aHeightIntegral(y0, dir.y, dist, 8000.0);
	float iH = aHeightIntegral(y0, dir.y, dist, uHazeH);
	return exp(-(A_BETA_R * iR + vec3(uHaze) * iH));
}
vec3 aerialInscatter(vec3 dir) {
	vec3 d = normalize(vec3(dir.x, max(dir.y, 0.015), dir.z));
	return sampleSky(d);
}
`;

const LUT_FRAG = /* glsl */`
precision highp float;
#define A_PI 3.14159265359
const float A_RG = 6360e3;
const float A_RT = 6460e3;
const vec3 A_BETA_R = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const float A_BETA_MS = 3.996e-6;
const float A_BETA_MA = 4.40e-6;
const vec3 A_BETA_O = vec3(0.650e-6, 1.881e-6, 0.085e-6);
uniform vec3 uSunDir;
uniform float uCamHeight;
uniform float uSunI;
uniform float uMie;
varying vec2 vUv;

vec2 aRaySphere(vec3 ro, vec3 rd, float r) {
	float b = dot(ro, rd);
	float c = dot(ro, ro) - r * r;
	float h = b * b - c;
	if (h < 0.0) return vec2(-1.0, -2.0);
	h = sqrt(h);
	return vec2(-b - h, -b + h);
}
float aRayleighPhase(float mu) { return 3.0 / (16.0 * A_PI) * (1.0 + mu * mu); }
float aHG(float g, float mu) { float g2 = g * g; return (1.0 - g2) / (4.0 * A_PI * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5)); }

void dens(float h, out float dR, out float dM, out float dO) {
	dR = exp(-h / 8000.0);
	dM = exp(-h / 1200.0) * uMie;
	dO = max(0.0, 1.0 - abs(h - 25000.0) / 15000.0);
}
vec3 extinction(float h) {
	float dR, dM, dO; dens(h, dR, dM, dO);
	return A_BETA_R * dR + vec3(A_BETA_MS + A_BETA_MA) * dM + A_BETA_O * dO;
}
vec3 sunTrans(vec3 p) {
	vec2 g = aRaySphere(p, uSunDir, A_RG);
	// soft planet shadow around the terminator
	float r = length(p);
	float mu = dot(p / r, uSunDir);
	float muHorizon = -sqrt(max(0.0, 1.0 - (A_RG / r) * (A_RG / r)));
	float vis = smoothstep(muHorizon - 0.01, muHorizon + 0.01, mu);
	if (vis <= 0.0) return vec3(0.0);
	float tEnd = aRaySphere(p, uSunDir, A_RT).y;
	vec3 od = vec3(0.0);
	const int N = 10;
	float dt = tEnd / float(N);
	for (int i = 0; i < N; i++) {
		vec3 q = p + uSunDir * (float(i) + 0.5) * dt;
		od += extinction(length(q) - A_RG) * dt;
	}
	return exp(-od) * vis;
}

void main() {
	float az = vUv.x * 2.0 * A_PI;
	float v = vUv.y * 2.0 - 1.0;
	float el = sign(v) * v * v * 0.5 * A_PI;
	vec3 dir = vec3(cos(el) * sin(az), sin(el), -cos(el) * cos(az));
	vec3 ro = vec3(0.0, A_RG + max(uCamHeight, 2.0), 0.0);
	vec2 ta = aRaySphere(ro, dir, A_RT);
	float tEnd = ta.y;
	vec2 tg = aRaySphere(ro, dir, A_RG);
	bool hitGround = tg.x > 0.0;
	if (hitGround) tEnd = tg.x;
	float mu = dot(dir, uSunDir);
	float pR = aRayleighPhase(mu);
	float pM = aHG(0.78, mu);
	vec3 L = vec3(0.0);
	vec3 T = vec3(1.0);
	const int N = 40;
	for (int i = 0; i < N; i++) {
		float f0 = float(i) / float(N), f1 = float(i + 1) / float(N);
		float t0 = tEnd * f0 * f0, t1 = tEnd * f1 * f1;
		float dt = t1 - t0;
		vec3 p = ro + dir * (0.5 * (t0 + t1));
		float h = length(p) - A_RG;
		float dR, dM, dO; dens(h, dR, dM, dO);
		vec3 sR = A_BETA_R * dR;
		vec3 sM = vec3(A_BETA_MS) * dM;
		vec3 ext = sR + vec3(A_BETA_MS + A_BETA_MA) * dM + A_BETA_O * dO;
		vec3 st = sunTrans(p);
		// single scattering + crude isotropic multiple-scattering term
		vec3 S = st * (sR * pR + sM * pM) + (sR + sM) * (0.07 * st + 0.0004);
		vec3 Tstep = exp(-ext * dt);
		L += T * (S - S * Tstep) / max(ext, vec3(1e-9));
		T *= Tstep;
	}
	if (hitGround) {
		// faint light reflected off the ground far below the horizon
		vec3 gp = ro + dir * tEnd;
		vec3 n = normalize(gp);
		L += T * sunTrans(gp) * max(dot(n, uSunDir), 0.0) * 0.08 / A_PI;
	}
	gl_FragColor = vec4(L * uSunI, 1.0);
}
`;

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// JS port for sun transmittance -> directional light colour
function extinctionJS(h, mie) {
	const dR = Math.exp(-h / 8000), dM = Math.exp(-h / 1200) * mie;
	const dO = Math.max(0, 1 - Math.abs(h - 25000) / 15000);
	return [
		BETA_R[0] * dR + (BETA_MS + BETA_MA) * dM + BETA_O[0] * dO,
		BETA_R[1] * dR + (BETA_MS + BETA_MA) * dM + BETA_O[1] * dO,
		BETA_R[2] * dR + (BETA_MS + BETA_MA) * dM + BETA_O[2] * dO,
	];
}
export function sunTransmittanceJS(height, sunDir, mie = 1) {
	const p = [0, RG + Math.max(height, 1), 0];
	const d = [sunDir.x, sunDir.y, sunDir.z];
	const r = p[1];
	const mu = d[1];
	const muH = -Math.sqrt(Math.max(0, 1 - (RG / r) ** 2));
	const t = Math.min(1, Math.max(0, (mu - (muH - 0.01)) / 0.02));
	const vis = t * t * (3 - 2 * t);
	if (vis <= 0) return [0, 0, 0];
	const b = p[1] * d[1];
	const c = p[1] * p[1] - RT * RT;
	const tEnd = -b + Math.sqrt(b * b - c);
	const N = 48, dt = tEnd / N;
	const od = [0, 0, 0];
	for (let i = 0; i < N; i++) {
		const s = (i + 0.5) * dt;
		const q0 = p[0] + d[0] * s, q1 = p[1] + d[1] * s, q2 = p[2] + d[2] * s;
		const h = Math.sqrt(q0 * q0 + q1 * q1 + q2 * q2) - RG;
		const e = extinctionJS(h, mie);
		od[0] += e[0] * dt; od[1] += e[1] * dt; od[2] += e[2] * dt;
	}
	return [Math.exp(-od[0]) * vis, Math.exp(-od[1]) * vis, Math.exp(-od[2]) * vis];
}

// Solar position for a mid-latitude location, hour in [0,24).
export function sunDirection(hour, out = new THREE.Vector3()) {
	const lat = 38 * Math.PI / 180;
	const decl = 14 * Math.PI / 180;
	const H = (hour - 12) * 15 * Math.PI / 180;
	const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
	const el = Math.asin(sinEl);
	let cosAz = (Math.sin(decl) - Math.sin(el) * Math.sin(lat)) / (Math.cos(el) * Math.cos(lat));
	cosAz = Math.min(1, Math.max(-1, cosAz));
	let az = Math.acos(cosAz);
	if (H > 0) az = 2 * Math.PI - az;
	out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
	return out;
}
export function moonDirection(hour, out = new THREE.Vector3()) {
	// moon roughly opposite the sun, offset so it is up for most of the night
	sunDirection((hour + 11.2) % 24, out);
	out.y = Math.abs(out.y) * 0.8 + 0.25;
	return out.normalize();
}

export class Atmosphere {
	constructor(renderer) {
		this.renderer = renderer;
		this.lut = new THREE.WebGLRenderTarget(256, 128, {
			type: THREE.HalfFloatType, format: THREE.RGBAFormat,
			minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
			wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping,
		});
		this.lut.texture.wrapS = THREE.RepeatWrapping;
		this.lutMat = new THREE.ShaderMaterial({
			vertexShader: QUAD_VERT, fragmentShader: LUT_FRAG,
			uniforms: {
				uSunDir: { value: new THREE.Vector3(0, 1, 0) },
				uCamHeight: { value: 100 },
				uSunI: { value: SUN_INTENSITY },
				uMie: { value: 1 },
			},
			depthTest: false, depthWrite: false,
		});
		this.quad = new FullScreenQuad(this.lutMat);

		this.sunDir = new THREE.Vector3(0, 1, 0);
		this.moonDir = new THREE.Vector3(0, 1, 0);
		this.lightDir = new THREE.Vector3(0, 1, 0);
		this.lightColor = new THREE.Color();
		this.lightIntensity = 1;
		this.sunColorT = new THREE.Color(1, 1, 1); // transmittance at camera
		this.sunColorClouds = new THREE.Color(1, 1, 1);
		this.night = 0;
		this.mie = 1;

		// Environment (reflection / ambient) generation
		this.pmrem = new THREE.PMREMGenerator(renderer);
		this.envScene = new THREE.Scene();
		this.envMat = new THREE.ShaderMaterial({
			side: THREE.BackSide, depthWrite: false, depthTest: false,
			uniforms: {
				tSkyLUT: { value: this.lut.texture },
				uGround: { value: new THREE.Color(0.05, 0.06, 0.04) },
				uNightSky: { value: new THREE.Color(0, 0, 0) },
				uHaze: { value: 0 }, uHazeH: { value: 1500 },
			},
			vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
			fragmentShader: /* glsl */`
				${ATMOS_GLSL}
				uniform vec3 uGround; uniform vec3 uNightSky;
				varying vec3 vDir;
				void main(){
					vec3 d = normalize(vDir);
					vec3 sky = sampleSky(vec3(d.x, max(d.y, 0.0), d.z)) + uNightSky;
					vec3 g = uGround + sampleSky(normalize(vec3(d.x, 0.02, d.z))) * 0.35;
					vec3 c = mix(g, sky, smoothstep(-0.06, 0.02, d.y));
					gl_FragColor = vec4(c, 1.0);
				}`,
		});
		this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.envMat));
		this.envRT = null;
		this.lastEnvSun = new THREE.Vector3(9, 9, 9);
		this.lastEnvHeight = -1e9;
		this.envTimer = 0;
	}

	setTime(hour) {
		this.hour = hour;
		sunDirection(hour, this.sunDir);
		moonDirection(hour, this.moonDir);
	}

	update(camHeight, dt, haze) {
		this.mie = haze;
		const u = this.lutMat.uniforms;
		u.uSunDir.value.copy(this.sunDir);
		u.uCamHeight.value = camHeight;
		u.uMie.value = haze;
		const r = this.renderer;
		const prev = r.getRenderTarget();
		r.setRenderTarget(this.lut);
		this.quad.render(r);
		r.setRenderTarget(prev);

		// light colour from transmittance
		const t = sunTransmittanceJS(camHeight, this.sunDir, haze);
		this.sunColorT.setRGB(t[0], t[1], t[2]);
		const tc = sunTransmittanceJS(2200, this.sunDir, haze);
		this.sunColorClouds.setRGB(tc[0], tc[1], tc[2]);
		const sunUp = this.sunDir.y;
		this.night = 1 - THREE.MathUtils.smoothstep(sunUp, -0.12, 0.02);
		if (this.night < 0.98) {
			this.lightDir.copy(this.sunDir);
			if (this.lightDir.y < 0.02) { this.lightDir.y = 0.02; this.lightDir.normalize(); }
			this.lightColor.setRGB(t[0], t[1], t[2]);
			this.lightIntensity = SUN_INTENSITY;
		}
		const moonI = 0.05 * this.night;
		if (this.night > 0.5) {
			this.lightDir.copy(this.moonDir);
			this.lightColor.setRGB(0.55, 0.65, 1.0);
			this.lightIntensity = moonI * 1.0;
		}
		// Night sky ambient (airglow + moonlit sky) so nights are dark blue, not black
		this.nightSky = new THREE.Color(0.0008, 0.0016, 0.0042).multiplyScalar(this.night);

		this.envTimer -= dt;
		const moved = this.lastEnvSun.distanceTo(this.sunDir) > 0.01 || Math.abs(camHeight - this.lastEnvHeight) > 600;
		if (!this.envRT || (moved && this.envTimer <= 0)) this.regenerateEnv(camHeight);
	}

	regenerateEnv(camHeight) {
		this.envTimer = 1.0;
		this.lastEnvSun.copy(this.sunDir);
		this.lastEnvHeight = camHeight;
		const sunUp = Math.max(0, this.sunDir.y);
		const E = SUN_INTENSITY * sunUp * this.sunColorT.g + 0.4 * this.night * 0;
		const g = this.envMat.uniforms.uGround.value;
		g.setRGB(0.1, 0.12, 0.08).multiplyScalar(E / Math.PI * 0.6);
		g.add(new THREE.Color(0.0006, 0.0008, 0.0012).multiplyScalar(this.night));
		this.envMat.uniforms.uNightSky.value.copy(this.nightSky || new THREE.Color(0, 0, 0));
		const old = this.envRT;
		const prev = this.renderer.getRenderTarget();
		this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
		this.renderer.setRenderTarget(prev);
		if (old) old.dispose();
		if (this.onEnv) this.onEnv(this.envRT.texture);
	}
}
