// Airport furniture: buildings, windsocks, parked aircraft and runway lighting (edge, centre-line,
// threshold/end, approach lights with sequenced flashers and PAPI with real 2.5-3.5 deg transitions).
import * as THREE from 'three';
import { airports, fromRunwayLocal, getHeight } from './world.js';

function windowTexture(cols, rows, lit) {
	const c = document.createElement('canvas');
	c.width = 512; c.height = 256;
	const g = c.getContext('2d');
	g.fillStyle = lit ? '#000' : '#6c7177'; g.fillRect(0, 0, 512, 256);
	const cw = 512 / cols, rh = 256 / rows;
	for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
		if (lit) {
			const on = Math.random() < 0.55;
			g.fillStyle = on ? `rgb(${230 + Math.random() * 25},${190 + Math.random() * 40},${120 + Math.random() * 50})` : '#000';
		} else g.fillStyle = `rgb(${30 + Math.random() * 20},${45 + Math.random() * 20},${60 + Math.random() * 25})`;
		g.fillRect(i * cw + cw * 0.12, j * rh + rh * 0.18, cw * 0.76, rh * 0.62);
	}
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	return t;
}

const LIGHT_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 color;
attribute float size;
attribute vec3 facing;
attribute float kind;
attribute float param;
uniform float uTime, uScale, uNight;
varying vec3 vColor;
void main() {
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	vec3 toCam = normalize(cameraPosition - position);
	float vis = 1.0;
	if (dot(facing, facing) > 0.25) vis = smoothstep(-0.05, 0.35, dot(toCam, facing));
	vec3 col = color;
	float dayI = 0.12;
	if (kind > 0.5 && kind < 1.5) { // PAPI
		float elev = degrees(asin(clamp(toCam.y, -1.0, 1.0)));
		col = elev > param ? vec3(1.0, 0.92, 0.85) : vec3(1.0, 0.04, 0.02);
		col *= 3.0;
		dayI = 1.0;
	} else if (kind > 1.5) { // sequenced flasher
		float ph = fract(uTime * 2.0 - param);
		vis *= smoothstep(0.0, 0.01, ph) * (1.0 - smoothstep(0.03, 0.07, ph));
		col *= 6.0;
		dayI = 0.6;
	}
	float d = max(-mv.z, 1.0);
	float inten = mix(dayI, 1.0, uNight);
	float px = size * uScale / d;
	float ps = clamp(px, 2.0, 40.0);
	// keep total energy roughly constant when clamped to the min size
	float boost = px < 2.0 ? max(px / 2.0, 0.08) : 1.0;
	vColor = col * vis * inten * boost;
	gl_PointSize = ps;
	gl_Position = projectionMatrix * mv;
	if (vis * inten < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
	#include <logdepthbuf_vertex>
}`;
const LIGHT_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
void main() {
	#include <logdepthbuf_fragment>
	vec2 p = gl_PointCoord - 0.5;
	float r2 = dot(p, p) * 4.0;
	if (r2 > 1.0) discard;
	float a = (exp(-r2 * 6.0) + 0.2 * exp(-r2 * 1.5)) * (1.0 - r2) * (1.0 - r2);
	gl_FragColor = vec4(vColor * a * 8.0, 1.0);
}`;

export class Airports {
	constructor(scene, buildParked) {
		this.scene = scene;
		this.group = new THREE.Group();
		scene.add(this.group);
		this.windsocks = [];
		this.beacons = [];
		this.windowMats = [];
		const L = { pos: [], col: [], size: [], facing: [], kind: [], param: [] };
		const add = (p, c, s, f = [0, 0, 0], k = 0, prm = 0) => {
			L.pos.push(p.x, p.y, p.z); L.col.push(c[0], c[1], c[2]); L.size.push(s);
			L.facing.push(f[0], f[1], f[2]); L.kind.push(k); L.param.push(prm);
		};
		for (const ap of airports) this.buildAirport(ap, add, buildParked);
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(L.pos, 3));
		geo.setAttribute('color', new THREE.Float32BufferAttribute(L.col, 3));
		geo.setAttribute('size', new THREE.Float32BufferAttribute(L.size, 1));
		geo.setAttribute('facing', new THREE.Float32BufferAttribute(L.facing, 3));
		geo.setAttribute('kind', new THREE.Float32BufferAttribute(L.kind, 1));
		geo.setAttribute('param', new THREE.Float32BufferAttribute(L.param, 1));
		this.lightMat = new THREE.ShaderMaterial({
			vertexShader: LIGHT_VERT, fragmentShader: LIGHT_FRAG,
			uniforms: { uTime: { value: 0 }, uScale: { value: 800 }, uNight: { value: 0 } },
			transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
		});
		this.lights = new THREE.Points(geo, this.lightMat);
		this.lights.frustumCulled = false;
		this.lights.renderOrder = 5;
		scene.add(this.lights);
	}

	buildAirport(ap, add, buildParked) {
		const E = ap.elev;
		const P = (u, v, y = 0) => { const p = fromRunwayLocal(ap, u, v); return new THREE.Vector3(p.x, E + y, p.z); };
		const hl = ap.length / 2, hw = ap.width / 2;
		const d = [ap.dir.x, 0, ap.dir.z], nd = [-ap.dir.x, 0, -ap.dir.z];
		const white = [1.0, 0.92, 0.78], yellow = [1.0, 0.7, 0.2], red = [1.0, 0.06, 0.03], green = [0.1, 1.0, 0.35], blue = [0.15, 0.3, 1.0];
		// edge lights
		for (let u = -hl; u <= hl + 0.1; u += 60) {
			for (const s of [-1, 1]) {
				const caution = (hl - Math.abs(u)) < 600;
				add(P(u, s * (hw + 1.5), 0.35), caution ? yellow : white, 1.4);
			}
		}
		// centreline
		for (let u = -hl + 30; u < hl; u += 30) {
			const fromEndA = hl - u, fromEndB = u + hl;
			const remA = fromEndA, remB = fromEndB;
			// colour as seen when rolling toward each end (approximate with the closer end)
			const rem = Math.min(remA, remB);
			const col = rem < 300 ? red : (rem < 900 ? ((Math.round(u / 30) & 1) ? red : white) : white);
			add(P(u, 0, 0.05), col, 0.9);
		}
		// thresholds / ends
		for (let v = -hw; v <= hw + 0.01; v += 3) {
			add(P(-hl - 1, v, 0.3), green, 1.6, nd);
			add(P(-hl + 1, v, 0.3), red, 1.4, d);
			add(P(hl + 1, v, 0.3), green, 1.6, d);
			add(P(hl - 1, v, 0.3), red, 1.4, nd);
		}
		// approach lighting systems on both ends
		for (const end of [-1, 1]) {
			const sgn = end; // -1 => approach from -u side
			const outward = end < 0 ? nd : d;
			for (let k = 1; k <= 30; k++) {
				const dist = k * 30;
				const u = sgn * (hl + dist);
				const gy = getHeight(P(u, 0).x, P(u, 0).z);
				const y = Math.max(gy, E) - E + 0.8 + Math.max(0, E - Math.max(gy, 0)) * 0;
				for (let b = -2; b <= 2; b++) add(P(u, b * 1.0, y), white, 1.2, outward);
				if (dist === 300) for (let b = -7; b <= 7; b++) if (Math.abs(b) > 2) add(P(u, b * 1.5, y), white, 1.2, outward);
				add(P(u, 0, y + 0.3), [1, 1, 1], 2.0, outward, 2, k / 30);
			}
			// PAPI on the left side (as seen on approach) 300 m past the threshold
			const u0 = sgn * (hl - 300);
			const left = end < 0 ? -1 : 1; // landing toward +u: left is -v
			const angles = [3.5, 3.17, 2.83, 2.5];
			for (let i = 0; i < 4; i++) {
				add(P(u0, left * (hw + 15 + i * 9), 0.6), white, 2.4, outward, 1, angles[i]);
			}
		}
		// taxiway edge lights
		for (let u = -hl - 30; u <= hl + 30; u += 45) {
			add(P(u, 108, 0.25), blue, 0.8); add(P(u, 132, 0.25), blue, 0.8);
		}

		// ------------------------------------------------ buildings
		const conc = new THREE.MeshStandardMaterial({ color: 0xb9b5ad, roughness: 0.85 });
		const darkRoof = new THREE.MeshStandardMaterial({ color: 0x3d4045, roughness: 0.7, metalness: 0.3 });
		const glassDay = windowTexture(24, 3, false), glassNight = windowTexture(24, 3, true);
		const termMat = new THREE.MeshStandardMaterial({ map: glassDay, emissiveMap: glassNight, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.25, metalness: 0.4 });
		this.windowMats.push(termMat);
		const place = (mesh, u, v, y) => {
			const p = P(u, v, y);
			mesh.position.copy(p);
			mesh.rotation.y = -ap.hdRad + Math.PI / 2 - Math.PI / 2;
			this.group.add(mesh);
			mesh.castShadow = true; mesh.receiveShadow = true;
			return mesh;
		};
		const box = (w, h, dpt, mat) => new THREE.Mesh(new THREE.BoxGeometry(dpt, h, w), mat);
		if (ap.main) {
			// terminal: long glass building along the apron
			const term = box(280, 16, 44, [termMat, termMat, darkRoof, conc, termMat, termMat]);
			place(term, -150, 380, 8);
			const term2 = box(90, 24, 40, [termMat, termMat, darkRoof, conc, termMat, termMat]);
			place(term2, 30, 385, 12);
			// control tower
			const shaft = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.2, 40, 16), conc);
			place(shaft, 150, 375, 20);
			const cab = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 6.2, 6, 8), new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.05, metalness: 0.9, emissive: 0x99aa88, emissiveIntensity: 0 }));
			place(cab, 150, 375, 43);
			this.windowMats.push(cab.material);
			const roof = new THREE.Mesh(new THREE.CylinderGeometry(8.2, 7.6, 1.4, 8), darkRoof);
			place(roof, 150, 375, 46.7);
			const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 7, 6), darkRoof);
			place(mast, 150, 375, 50.8);
			add(P(150, 375, 54.5), red, 2.5);
			this.beacons.push(P(150, 375, 48));
		}
		// hangars with curved roofs
		const hangarMat = new THREE.MeshStandardMaterial({ color: 0x8e9499, roughness: 0.5, metalness: 0.6 });
		const nH = ap.main ? 4 : 2;
		for (let i = 0; i < nH; i++) {
			const u = (ap.main ? 260 : -120) + i * 70;
			const base = box(55, 9, 60, conc);
			place(base, u, 380, 4.5);
			const roofG = new THREE.CylinderGeometry(36.2, 36.2, 60, 24, 1, false, Math.PI / 2 - Math.PI * 0.275, Math.PI * 0.55);
			roofG.rotateZ(Math.PI / 2);
			roofG.scale(1, 0.5, 1);
			const roofM = new THREE.Mesh(roofG, hangarMat);
			roofM.material.side = THREE.DoubleSide;
			place(roofM, u, 380, 9 - 36.2 * 0.5 * Math.cos(Math.PI * 0.275));
			const door = new THREE.Mesh(new THREE.PlaneGeometry(48, 8.5), new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.6, metalness: 0.5 }));
			const dp = P(u, 349.8, 4.3);
			door.position.copy(dp);
			door.lookAt(P(u, 300, 4.3));
			this.group.add(door);
		}
		// fuel tanks
		for (let i = 0; i < 2; i++) {
			const t = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 9, 20), new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.4, metalness: 0.3 }));
			place(t, (ap.main ? 560 : 60) + i * 16, 395, 4.5);
		}
		// windsocks near both thresholds
		for (const end of [-1, 1]) {
			const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 7, 6), darkRoof);
			const base = P(end * (hl - 250), -hw - 45, 0);
			pole.position.copy(base).add(new THREE.Vector3(0, 3.5, 0));
			this.group.add(pole);
			const sockGeo = new THREE.ConeGeometry(0.45, 3.6, 12, 4, true).rotateX(-Math.PI / 2).translate(0, 0, 1.8);
			const cols = [];
			const sp = sockGeo.attributes.position;
			for (let i = 0; i < sp.count; i++) {
				const band = Math.floor(sp.getZ(i) / 0.72);
				const c = band % 2 === 0 ? [1, 0.25, 0.02] : [1, 1, 1];
				cols.push(...c);
			}
			sockGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
			const sock = new THREE.Mesh(sockGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
			sock.position.copy(base).add(new THREE.Vector3(0, 7, 0));
			sock.castShadow = true;
			this.group.add(sock);
			this.windsocks.push(sock);
			add(base.clone().add(new THREE.Vector3(0, 7.3, 0)), red, 1.2);
		}
		// parked aircraft on the apron
		if (buildParked) {
			const n = ap.main ? 4 : 2;
			for (let i = 0; i < n; i++) {
				const m = buildParked(i);
				if (!m) continue;
				const u = -330 + i * 60;
				const v = 290;
				const p = P(u, v, 0);
				m.position.set(p.x, E + 1.42 - 0.08, p.z);
				m.rotation.y = Math.PI / 2 - ap.hdRad;
				this.group.add(m);
			}
		}
	}

	update(time, night, windDir, windSpeed, camera, height) {
		const u = this.lightMat.uniforms;
		u.uTime.value = time;
		u.uNight.value = night;
		u.uScale.value = height / (2 * Math.tan(camera.fov * Math.PI / 360));
		for (const m of this.windowMats) m.emissiveIntensity = night * 3.0;
		// windsock points downwind; droops in light wind
		const kt = windSpeed * 1.94384;
		const lift = Math.min(1, kt / 15);
		for (const s of this.windsocks) {
			const toward = windDir + Math.PI; // wind FROM windDir -> blows toward windDir+180
			s.rotation.set(0, 0, 0);
			s.rotation.order = 'YXZ';
			s.rotation.y = Math.PI - toward;
			s.rotation.x = (1 - lift) * 1.2 + Math.sin(time * 3.1) * 0.04 * lift;
			s.rotation.y += Math.sin(time * 1.7) * 0.06 * lift;
		}
	}
}
