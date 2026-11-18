// Render pipeline: HDR scene (MSAA) -> volumetric clouds (reduced res) -> atmosphere composite
// (sky, sun, stars, aerial perspective, clouds) -> bloom -> final (lens flare, tonemap, grading).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ATMOS_GLSL } from './atmosphere.js';
import { createCloudMaterial, DEPTH_GLSL, WEATHER_SCALE } from './clouds.js';

const QUAD_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COMPOSITE_FRAG = /* glsl */`
precision highp float;
${ATMOS_GLSL}
${DEPTH_GLSL}
uniform sampler2D tScene, tDepth, tClouds, tWeather;
uniform mat4 uInvProj, uCamWorld;
uniform vec3 uCamPos;
uniform float uCirrus;
uniform vec3 uCirrusLight;
uniform vec2 uWind;
uniform vec3 uSunDir, uMoonDir;
uniform vec3 uSunRad;
uniform float uNight;
uniform vec3 uNightSky;
uniform float uExposure;
uniform float uCloudsOn, uCloudBase, uCloudTop;
uniform float uTime;
uniform vec2 uCloudTexel;
varying vec2 vUv;

float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }

vec3 stars(vec3 dir) {
	vec3 c = vec3(0.0);
	for (int k = 0; k < 2; k++) {
		float sc = k == 0 ? 180.0 : 420.0;
		vec3 p = dir * sc;
		vec3 cell = floor(p);
		float h = hash13(cell + float(k) * 17.0);
		if (h > (k == 0 ? 0.985 : 0.975)) {
			vec3 sp = cell + vec3(hash13(cell + 1.3), hash13(cell + 2.7), hash13(cell + 5.1));
			float d = length(p - sp);
			float tw = 0.75 + 0.25 * sin(uTime * (2.0 + 6.0 * h) + h * 100.0);
			float px = max(length(fwidth(p)), 1e-4);
			float rad = max(0.06, 1.1 * px);
			float b = smoothstep(rad, 0.0, d) * (h - 0.97) * 60.0 * tw * min(1.0, 0.06 / rad * 4.0);
			vec3 tint = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), hash13(cell + 9.0));
			c += tint * b * (k == 0 ? 0.06 : 0.025);
		}
	}
	return c;
}

void main() {
	vec2 ndc = vUv * 2.0 - 1.0;
	vec4 vp = uInvProj * vec4(ndc, 1.0, 1.0);
	vec3 dirV = normalize(vp.xyz / vp.w);
	vec3 dir = normalize(mat3(uCamWorld) * dirV);
	float d = texture2D(tDepth, vUv).x;
	vec3 col;
	float sceneDist = 1e9;
	if (isSkyDepth(d)) {
		col = sampleSky(dir) + uNightSky * (0.4 + 0.6 * max(dir.y, 0.0));
		float horizonFade = smoothstep(-0.02, 0.06, dir.y);
		// high cirrus deck (~9.5 km): thin ice cloud, strongly forward scattering
		if (uCirrus > 0.0 && dir.y > 0.004 && uCamPos.y < 9300.0) {
			float tc = (9500.0 - uCamPos.y) / dir.y;
			vec2 cp = uCamPos.xz + dir.xz * tc + uWind * 2.5;
			float c1 = texture2D(tWeather, cp * vec2(1.0, 0.28) / 70000.0 + 0.37).g;
			float c2 = texture2D(tWeather, cp * vec2(0.35, 1.0) / 21000.0 + 0.11).r;
			float c3 = texture2D(tWeather, cp / 5200.0).r;
			float cir = smoothstep(0.42, 0.85, c1 * 0.65 + c2 * 0.35) * (0.55 + 0.45 * c3);
			cir *= smoothstep(0.004, 0.09, dir.y) * uCirrus;
			float mu = dot(dir, uSunDir);
			vec3 cl = uCirrusLight * (0.35 + 3.0 * aHG(0.7, mu)) + sampleSky(vec3(0.0, 1.0, 0.0)) * 0.6;
			col = mix(col, cl, cir * 0.55);
		}
		// sun disc with limb darkening
		float cs = dot(dir, uSunDir);
		float sunR = 0.0062;
		float ang = acos(clamp(cs, -1.0, 1.0));
		if (ang < sunR * 1.2) {
			float r = clamp(ang / sunR, 0.0, 1.0);
			float ld = 1.0 - 0.6 * (1.0 - sqrt(max(1.0 - r * r, 0.0)));
			float edge = 1.0 - smoothstep(0.92, 1.05, ang / sunR);
			col += min(uSunRad * ld * edge, vec3(30000.0)) * horizonFade;
		}
		// moon
		float cm = dot(dir, uMoonDir);
		float am = acos(clamp(cm, -1.0, 1.0));
		float moonR = 0.0075;
		if (uNight > 0.01 && am < moonR * 1.3) {
			vec3 mp = dir - uMoonDir * cm;
			float crater = 0.8 + 0.2 * hash13(floor(mp * 3000.0));
			float edge = 1.0 - smoothstep(0.9, 1.0, am / moonR);
			col += vec3(0.9, 0.92, 1.0) * 0.6 * crater * edge * uNight * horizonFade;
		}
		col += exp(-am * 30.0) * vec3(0.02, 0.025, 0.035) * uNight;
		if (uNight > 0.01) col += stars(dir) * uNight * horizonFade;
	} else {
		sceneDist = depthViewZ(d) / max(-dirV.z, 1e-4);
		vec3 s = texture2D(tScene, vUv).rgb;
		vec3 Tf = aerialTransmittance(uCamPos.y, dir, sceneDist);
		col = s * Tf + (aerialInscatter(dir) + uNightSky) * (1.0 - Tf);
	}
	if (uCloudsOn > 0.5) {
		vec3 ro = vec3(0.0, A_RG + uCamPos.y, 0.0);
		float tEnter = 0.0;
		if (uCamPos.y < uCloudBase) { vec2 t = aRaySphere(ro, dir, A_RG + uCloudBase); tEnter = t.y; }
		else if (uCamPos.y > uCloudTop) { vec2 t = aRaySphere(ro, dir, A_RG + uCloudTop); tEnter = t.x < 0.0 ? 1e10 : t.x; }
		if (sceneDist > tEnter) {
			// soft 5-tap upsample hides the raymarch dither at reduced resolution
			vec2 o = uCloudTexel * 0.75;
			vec4 c = texture2D(tClouds, vUv) * 0.4
				+ (texture2D(tClouds, vUv + vec2(o.x, o.y)) + texture2D(tClouds, vUv + vec2(-o.x, o.y))
				+ texture2D(tClouds, vUv + vec2(o.x, -o.y)) + texture2D(tClouds, vUv + vec2(-o.x, -o.y))) * 0.15;
			col = col * c.a + c.rgb;
		}
	}
	gl_FragColor = vec4(col * uExposure, 1.0);
}
`;

const FINAL_FRAG = /* glsl */`
precision highp float;
${DEPTH_GLSL}
uniform sampler2D tColor, tDepth, tClouds, tRays;
uniform vec3 uRayTint;
uniform vec2 uRes;
uniform vec2 uSunUV;
uniform float uSunOnScreen;
uniform vec3 uSunTint;
uniform float uTime;
uniform float uGray, uRed, uFade, uFlash;
uniform float uCloudsOn;
uniform float uFlare;
varying vec2 vUv;

vec3 RRTAndODTFit(vec3 v) {
	vec3 a = v * (v + 0.0245786) - 0.000090537;
	vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
	return a / b;
}
vec3 ACESFitted(vec3 color) {
	const mat3 ACESInputMat = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
	const mat3 ACESOutputMat = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
	color = ACESInputMat * color;
	color = RRTAndODTFit(color);
	color = ACESOutputMat * color;
	return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
	return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

float sunVisibility() {
	if (uSunOnScreen <= 0.0) return 0.0;
	float v = 0.0;
	for (int i = 0; i < 9; i++) {
		vec2 o = vec2(float(i % 3) - 1.0, float(i / 3) - 1.0) * 4.0 / uRes;
		vec2 uv = uSunUV + o;
		if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
		float sky = isSkyDepth(texture2D(tDepth, uv).x) ? 1.0 : 0.0;
		float cl = uCloudsOn > 0.5 ? texture2D(tClouds, uv).a : 1.0;
		v += sky * cl;
	}
	return v / 9.0 * uSunOnScreen;
}

void main() {
	vec2 uv = vUv;
	vec2 dc = uv - 0.5;
	float r2 = dot(dc, dc);
	vec2 ca = dc * r2 * 0.012;
	vec3 col;
	col.r = texture2D(tColor, uv - ca).r;
	col.g = texture2D(tColor, uv).g;
	col.b = texture2D(tColor, uv + ca).b;

	float vis = sunVisibility() * uFlare;
	if (vis > 0.0) {
		float aspect = uRes.x / uRes.y;
		vec2 toC = vec2(0.5) - uSunUV;
		vec3 fl = vec3(0.0);
		for (int i = 0; i < 6; i++) {
			float k = float(i);
			float pos = mix(0.35, 1.9, k / 5.0) + 0.1 * sin(k * 3.7);
			vec2 gp = uSunUV + toC * pos * 2.0;
			float sz = 0.02 + 0.05 * fract(k * 0.618 + 0.2);
			float dd = length((uv - gp) * vec2(aspect, 1.0));
			vec3 gc = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + k * 0.17));
			fl += gc * smoothstep(sz, sz * 0.4, dd) * 0.035;
		}
		vec2 sd = (uv - uSunUV) * vec2(aspect, 1.0);
		float dist = length(sd);
		float halo = smoothstep(0.03, 0.0, abs(dist - 0.28)) * 0.04;
		float glare = exp(-dist * 7.0) * 0.5 + exp(-dist * 25.0) * 0.8;
		float streak = exp(-abs(sd.y) * 220.0) * exp(-abs(sd.x) * 2.8) * 0.35;
		fl += vec3(halo) * vec3(0.6, 0.8, 1.0) + (glare + streak) * vec3(1.0, 0.95, 0.85);
		col += fl * uSunTint * vis;
	}

	// crepuscular rays (computed at quarter resolution)
	col += texture2D(tRays, uv).r * uRayTint;

	col = ACESFitted(col);
	// filmic grade: gentle S-curve, a touch of saturation, warm highlights / cool shadows
	float lumG = dot(col, vec3(0.2126, 0.7152, 0.0722));
	col = mix(vec3(lumG), col, 1.12);
	col = clamp(col, 0.0, 1.0);
	col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
	col *= mix(vec3(0.98, 1.0, 1.035), vec3(1.035, 1.0, 0.965), smoothstep(0.15, 0.8, lumG));
	// G-induced grey-out / red-out
	float lum = dot(col, vec3(0.299, 0.587, 0.114));
	float tunnel = smoothstep(0.75, 0.15, length(dc * vec2(1.3, 1.0)) / max(1.0 - uGray, 0.05));
	col = mix(col, vec3(lum) * 0.8, uGray * 0.85);
	col *= mix(1.0, tunnel, smoothstep(0.3, 1.0, uGray));
	col = mix(col, vec3(lum * 0.9 + 0.1, lum * 0.1, lum * 0.08), uRed * 0.8);
	// vignette
	col *= mix(1.0, smoothstep(1.0, 0.25, length(dc * vec2(1.1, 1.0)) * 1.15), 0.4);
	col = mix(col, vec3(0.0), uFade);
	col += vec3(1.0, 0.7, 0.4) * uFlash;
	col = toSRGB(clamp(col, 0.0, 1.0));
	// grain + dither
	float n = hash12(gl_FragCoord.xy + fract(uTime * 13.7) * 300.0) - 0.5;
	col += n * (1.5 / 255.0 + 0.012 * (1.0 - lum));
	gl_FragColor = vec4(col, 1.0);
}
`;

const RAYS_FRAG = /* glsl */`
precision highp float;
${DEPTH_GLSL}
uniform sampler2D tDepth, tClouds;
uniform vec2 uSunUV;
uniform float uCloudsOn, uAspect, uFrame;
varying vec2 vUv;
float occ(vec2 uv) {
	if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
	float sky = isSkyDepth(texture2D(tDepth, uv).x) ? 1.0 : 0.0;
	return sky * (uCloudsOn > 0.5 ? texture2D(tClouds, uv).a : 1.0);
}
void main() {
	vec2 delta = uSunUV - vUv;
	const int N = 36;
	vec2 stp = delta / float(N) * 0.95;
	float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.618);
	vec2 uv = vUv + stp * j;
	float illum = 0.0, decay = 1.0;
	for (int i = 0; i < N; i++) { illum += occ(uv) * decay; decay *= 0.965; uv += stp; }
	illum /= float(N);
	float r = length(delta * vec2(uAspect, 1.0));
	gl_FragColor = vec4(illum * exp(-r * 2.2), 0.0, 0.0, 1.0);
}`;

export class PostFX {
	constructor(renderer, atmosphere, cloudTex, reversedDepth) {
		this.renderer = renderer;
		this.atm = atmosphere;
		this.cloudScale = 0.5;
		this.samples = 4;
		this.cloudsOn = true;
		this.reversed = !!reversedDepth;
		this.frame = 0;
		this.prevViewProj = new THREE.Matrix4();
		this.prevCamPos = new THREE.Vector3(1e9, 0, 0);
		const w = 4, h = 4;
		this.depthTex = new THREE.DepthTexture(w, h);
		this.depthTex.type = this.reversed ? THREE.FloatType : THREE.UnsignedIntType;
		this.depthTex.minFilter = THREE.NearestFilter;
		this.depthTex.magFilter = THREE.NearestFilter;
		this.rtScene = new THREE.WebGLRenderTarget(w, h, {
			type: THREE.HalfFloatType, samples: this.samples, depthTexture: this.depthTex, stencilBuffer: false,
		});
		const cloudRT = () => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
		this.rtCloudA = cloudRT(); this.rtCloudB = cloudRT();
		this.rtComp = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
		this.rtRays = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });

		this.cloudMat = createCloudMaterial(cloudTex, atmosphere.lut.texture, this.depthTex);
		this.cloudQuad = new FullScreenQuad(this.cloudMat);
		const depthU = () => ({ uDepthMode: { value: this.reversed ? 1 : 0 }, uNear: { value: 0.3 }, uFar: { value: 140000 }, uLogF: { value: 1 } });

		this.compMat = new THREE.ShaderMaterial({
			vertexShader: QUAD_VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false,
			uniforms: {
				...depthU(),
				tSkyLUT: { value: atmosphere.lut.texture },
				tScene: { value: this.rtScene.texture },
				tDepth: { value: this.depthTex },
				tClouds: { value: this.rtCloudA.texture },
				tWeather: { value: cloudTex.weather },
				uInvProj: { value: new THREE.Matrix4() },
				uCamWorld: { value: new THREE.Matrix4() },
				uCamPos: { value: new THREE.Vector3() },
				uSunDir: { value: new THREE.Vector3() },
				uMoonDir: { value: new THREE.Vector3() },
				uSunRad: { value: new THREE.Color() },
				uNight: { value: 0 },
				uNightSky: { value: new THREE.Color() },
				uExposure: { value: 1 },
				uCloudsOn: { value: 1 }, uCloudBase: { value: 1500 }, uCloudTop: { value: 2800 },
				uHaze: { value: 1e-5 }, uHazeH: { value: 1500 },
				uTime: { value: 0 },
				uCloudTexel: { value: new THREE.Vector2(0.002, 0.002) },
				uCirrus: { value: 0.6 }, uCirrusLight: { value: new THREE.Color() }, uWind: { value: new THREE.Vector2() },
			},
		});
		this.compQuad = new FullScreenQuad(this.compMat);

		this.raysMat = new THREE.ShaderMaterial({
			vertexShader: QUAD_VERT, fragmentShader: RAYS_FRAG, depthTest: false, depthWrite: false,
			uniforms: {
				...depthU(),
				tDepth: { value: this.depthTex }, tClouds: { value: this.rtCloudA.texture },
				uSunUV: { value: new THREE.Vector2() }, uCloudsOn: { value: 1 }, uAspect: { value: 1 }, uFrame: { value: 0 },
			},
		});
		this.raysQuad = new FullScreenQuad(this.raysMat);

		this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.6, 1.6);

		this.finalMat = new THREE.ShaderMaterial({
			vertexShader: QUAD_VERT, fragmentShader: FINAL_FRAG, depthTest: false, depthWrite: false,
			uniforms: {
				...depthU(),
				tColor: { value: this.rtComp.texture },
				tDepth: { value: this.depthTex },
				tClouds: { value: this.rtCloudA.texture },
				tRays: { value: this.rtRays.texture },
				uRayTint: { value: new THREE.Color(0, 0, 0) },
				uRes: { value: new THREE.Vector2(w, h) },
				uSunUV: { value: new THREE.Vector2() },
				uSunOnScreen: { value: 0 },
				uSunTint: { value: new THREE.Color(1, 1, 1) },
				uTime: { value: 0 },
				uGray: { value: 0 }, uRed: { value: 0 }, uFade: { value: 0 }, uFlash: { value: 0 },
				uCloudsOn: { value: 1 },
				uFlare: { value: 1 },
			},
		});
		this.finalQuad = new FullScreenQuad(this.finalMat);
		this._v = new THREE.Vector3();
		this._fwd = new THREE.Vector3();
	}

	setQuality(q) {
		this.samples = q.msaa;
		this.rtScene.samples = q.msaa;
		this.cloudScale = q.cloudScale;
		this.cloudMat.uniforms.uSteps.value = q.cloudSteps;
		this.bloomOn = q.bloom;
		this.raysOn = q.godRays !== false;
		this.rtScene.dispose();
		if (this.width) this.setSize(this.width, this.height);
	}

	setSize(w, h) {
		this.width = w; this.height = h;
		this.rtScene.setSize(w, h);
		this.rtComp.setSize(w, h);
		const cw = Math.max(1, Math.round(w * this.cloudScale)), ch = Math.max(1, Math.round(h * this.cloudScale));
		this.rtCloudA.setSize(cw, ch); this.rtCloudB.setSize(cw, ch);
		this.rtRays.setSize(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)));
		this.compMat.uniforms.uCloudTexel.value.set(1 / cw, 1 / ch);
		this.bloom.setSize(w, h);
		this.finalMat.uniforms.uRes.value.set(w, h);
		this.cloudMat.uniforms.uFullRes.value.set(w, h);
		this.raysMat.uniforms.uAspect.value = w / h;
		this.historyValid = false;
	}

	_depthUniforms(u, camera) {
		u.uNear.value = camera.near; u.uFar.value = camera.far; u.uLogF.value = Math.log2(camera.far + 1);
	}

	render(scene, camera, env) {
		const r = this.renderer;
		const atm = this.atm;
		camera.updateMatrixWorld();
		this.frame = (this.frame + 1) % 1024;

		r.setRenderTarget(this.rtScene);
		r.setClearColor(0x000000, 1);
		r.clear(true, true, false);
		r.render(scene, camera);

		// ---- volumetric clouds (reduced resolution + temporal reprojection)
		const cu = this.cloudMat.uniforms;
		const cloudsOn = this.cloudsOn && env.coverage > 0.01;
		const write = this.rtCloudA, read = this.rtCloudB;
		if (cloudsOn) {
			this._depthUniforms(cu, camera);
			cu.uDepthMode.value = this.reversed ? 1 : 0;
			cu.uInvProj.value.copy(camera.projectionMatrixInverse);
			cu.uCamWorld.value.copy(camera.matrixWorld);
			cu.uCamPos.value.copy(camera.position);
			cu.uLightDir.value.copy(atm.lightDir);
			cu.uSunLight.value.copy(atm.cloudLight);
			cu.uGroundBounce.value.copy(atm.groundBounce);
			cu.uNightSky.value.copy(atm.nightSky);
			cu.uBase.value = env.cloudBase; cu.uTop.value = env.cloudTop;
			cu.uCoverage.value = env.coverage; cu.uDensity.value = env.cloudDensity;
			cu.uWind.value.copy(env.cloudOffset);
			cu.uTime.value = env.time;
			cu.uHaze.value = env.haze; cu.uHazeH.value = env.hazeH;
			cu.uFrame.value = this.frame;
			const jump = camera.position.distanceTo(this.prevCamPos) > 250;
			cu.uHistoryWeight.value = this.historyValid && !jump && this.cloudsWereOn ? 0.86 : 0;
			cu.tHistory.value = read.texture;
			cu.uPrevViewProj.value.copy(this.prevViewProj);
			r.setRenderTarget(write);
			this.cloudQuad.render(r);
			this.historyValid = true;
		}
		this.cloudsWereOn = cloudsOn;
		this.prevViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		this.prevCamPos.copy(camera.position);

		// ---- atmosphere composite
		const u = this.compMat.uniforms;
		this._depthUniforms(u, camera);
		u.tClouds.value = write.texture;
		u.uInvProj.value.copy(camera.projectionMatrixInverse);
		u.uCamWorld.value.copy(camera.matrixWorld);
		u.uCamPos.value.copy(camera.position);
		u.uSunDir.value.copy(atm.sunDir);
		u.uMoonDir.value.copy(atm.moonDir);
		const sr = 0.0062;
		const sunRad = 20.0 / (Math.PI * sr * sr) * 0.02;
		u.uSunRad.value.copy(atm.sunColorT).multiplyScalar(sunRad);
		u.uNight.value = atm.night;
		u.uNightSky.value.copy(atm.nightSky);
		u.uExposure.value = env.exposure;
		u.uCloudsOn.value = cloudsOn ? 1 : 0;
		u.uCloudBase.value = env.cloudBase; u.uCloudTop.value = env.cloudTop;
		u.uHaze.value = env.haze; u.uHazeH.value = env.hazeH;
		u.uTime.value = env.time;
		u.uCirrus.value = env.cirrus ?? 0.6;
		u.uCirrusLight.value.copy(atm.cloudLight).multiplyScalar(0.12);
		u.uWind.value.copy(env.cloudOffset);
		r.setRenderTarget(this.rtComp);
		this.compQuad.render(r);

		if (this.bloomOn !== false) this.bloom.render(r, null, this.rtComp, 0, false);

		// ---- sun screen position: lens flare + god rays
		const f = this.finalMat.uniforms;
		const sp = this._v.copy(atm.sunDir).multiplyScalar(10000).add(camera.position).project(camera);
		const camFwd = this._fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
		const facing = camFwd.dot(atm.sunDir);
		const front = facing > 0 && atm.sunDir.y > -0.02;
		f.uSunUV.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
		const edge = Math.max(Math.abs(sp.x), Math.abs(sp.y));
		const sunUp = THREE.MathUtils.smoothstep(atm.sunDir.y, -0.02, 0.05);
		f.uSunOnScreen.value = front ? THREE.MathUtils.clamp((1.15 - edge) * 3, 0, 1) * sunUp : 0;
		const rayAmt = this.raysOn && front ? THREE.MathUtils.clamp((1.8 - edge) * 1.2, 0, 1) * sunUp * Math.pow(facing, 2) : 0;
		if (rayAmt > 0.001) {
			const ru = this.raysMat.uniforms;
			this._depthUniforms(ru, camera);
			ru.tClouds.value = write.texture;
			ru.uSunUV.value.copy(f.uSunUV.value);
			ru.uCloudsOn.value = cloudsOn ? 1 : 0;
			ru.uFrame.value = this.frame;
			r.setRenderTarget(this.rtRays);
			this.raysQuad.render(r);
			const k = rayAmt * env.exposure * 20 * 0.045 * (1 + env.haze * 4000);
			f.uRayTint.value.copy(atm.sunColorT).multiplyScalar(k);
		} else f.uRayTint.value.setRGB(0, 0, 0);

		this._depthUniforms(f, camera);
		f.tClouds.value = write.texture;
		f.uSunTint.value.copy(atm.sunColorT);
		f.uTime.value = env.time;
		f.uGray.value = env.grayout || 0;
		f.uRed.value = env.redout || 0;
		f.uFade.value = env.fade || 0;
		f.uFlash.value = env.flash || 0;
		f.uCloudsOn.value = cloudsOn ? 1 : 0;
		r.setRenderTarget(null);
		this.finalQuad.render(r);

		// swap cloud history buffers
		if (cloudsOn) { this.rtCloudA = read; this.rtCloudB = write; }
	}
}
