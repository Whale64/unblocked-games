// Procedural aircraft geometry: lofted superellipse fuselages, NACA 4-digit airfoil wings with
// hinged control surfaces, canopies, landing gear, propeller / jet nozzle with afterburner.
import * as THREE from 'three';

// ---------------------------------------------------------------- helpers
const sgnPow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);

function catmull(p0, p1, p2, p3, t) {
	const t2 = t * t, t3 = t2 * t;
	return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// stations: [z, halfWidth, hTop, hBot, yCentre, exponent]
function loft(stations, radial = 40, perSeg = 6) {
	const rings = [];
	for (let i = 0; i < stations.length - 1; i++) {
		const s0 = stations[Math.max(0, i - 1)], s1 = stations[i], s2 = stations[i + 1], s3 = stations[Math.min(stations.length - 1, i + 2)];
		for (let k = 0; k < perSeg; k++) {
			const t = k / perSeg;
			rings.push(s1.map((_, j) => Math.max(j === 4 ? -10 : 0.0005, catmull(s0[j], s1[j], s2[j], s3[j], t))).map((v, j) => (j === 0 || j === 4 ? catmull(s0[j], s1[j], s2[j], s3[j], t) : v)));
		}
	}
	rings.push(stations[stations.length - 1]);
	const pos = [], uv = [], idx = [];
	const zMin = rings[0][0], zMax = rings[rings.length - 1][0];
	for (let r = 0; r < rings.length; r++) {
		const [z, w, ht, hb, yc, n] = rings[r];
		const e = 2 / (n || 2.5);
		for (let a = 0; a <= radial; a++) {
			const th = (a / radial) * Math.PI * 2; // 0 = bottom, pi/2 = right, pi = top
			const sx = Math.sin(th), cy = -Math.cos(th);
			const x = w * sgnPow(sx, e);
			const y = yc + (cy > 0 ? ht : hb) * sgnPow(cy, e);
			pos.push(x, y, z);
			uv.push((z - zMin) / (zMax - zMin), a / radial);
		}
	}
	const rl = radial + 1;
	for (let r = 0; r < rings.length - 1; r++) {
		for (let a = 0; a < radial; a++) {
			const i0 = r * rl + a, i1 = i0 + 1, i2 = i0 + rl, i3 = i2 + 1;
			idx.push(i0, i1, i2, i1, i3, i2);
		}
	}
	// end caps
	const capStart = pos.length / 3;
	const first = rings[0], last = rings[rings.length - 1];
	pos.push(0, first[4], first[0]); uv.push(0, 0);
	pos.push(0, last[4], last[0]); uv.push(1, 0);
	for (let a = 0; a < radial; a++) {
		idx.push(capStart, a + 1, a);
		const o = (rings.length - 1) * rl;
		idx.push(capStart + 1, o + a, o + a + 1);
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	g.setIndex(idx);
	g.computeVertexNormals();
	return g;
}

function naca(x, t, m, p) {
	const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
	let yc = 0;
	if (m > 0) yc = x < p ? m / (p * p) * (2 * p * x - x * x) : m / ((1 - p) * (1 - p)) * ((1 - 2 * p) + 2 * p * x - x * x);
	return [yc + yt, yc - yt];
}

// Wing planform definition -> point on surface
function wingPoint(def, s, x, upper, side) {
	const chord = def.root + (def.tip - def.root) * s;
	const span = def.span * s;
	const zLE = def.z + span * Math.tan(def.sweep * Math.PI / 180);
	const yOff = span * Math.tan((def.dihedral || 0) * Math.PI / 180);
	const [yu, yl] = naca(Math.min(Math.max(x, 0), 1), def.t, def.m || 0, def.p || 0.4);
	const ya = (upper ? yu : yl) * chord;
	const zz = zLE + x * chord;
	if (def.vertical) return new THREE.Vector3(def.x + ya * side, def.y + span, zz);
	return new THREE.Vector3(def.x * side + span * side, def.y + yOff + ya, zz);
}

function wingPanel(def, s0, s1, c0, c1, side, ns = 6, nc = 12) {
	const pos = [], idx = [];
	const cs = (i) => {
		const t = i / nc;
		const f = 0.5 - 0.5 * Math.cos(Math.PI * t);
		return c0 + (c1 - c0) * (c0 === 0 ? f : (c1 === 1 && c0 > 0 ? t : f));
	};
	const strip = (upper) => {
		const base = pos.length / 3;
		for (let j = 0; j <= ns; j++) {
			const s = s0 + (s1 - s0) * j / ns;
			for (let i = 0; i <= nc; i++) {
				const p = wingPoint(def, s, cs(i), upper, side);
				pos.push(p.x, p.y, p.z);
			}
		}
		for (let j = 0; j < ns; j++) for (let i = 0; i < nc; i++) {
			const a = base + j * (nc + 1) + i, b = a + 1, c = a + nc + 1, d = c + 1;
			if (upper) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
		}
	};
	strip(true); strip(false);
	// caps at span ends and chord cuts
	const cap = (s) => {
		const base = pos.length / 3;
		const ring = [];
		for (let i = 0; i <= nc; i++) ring.push(wingPoint(def, s, cs(i), true, side));
		for (let i = nc; i >= 0; i--) ring.push(wingPoint(def, s, cs(i), false, side));
		const cen = ring.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / ring.length);
		pos.push(cen.x, cen.y, cen.z);
		ring.forEach((p) => pos.push(p.x, p.y, p.z));
		for (let i = 0; i < ring.length - 1; i++) idx.push(base, base + 1 + i, base + 2 + i);
	};
	cap(s0); cap(s1);
	const chordCut = (c) => {
		const base = pos.length / 3;
		for (let j = 0; j <= ns; j++) {
			const s = s0 + (s1 - s0) * j / ns;
			const a = wingPoint(def, s, c, true, side), b = wingPoint(def, s, c, false, side);
			pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
		}
		for (let j = 0; j < ns; j++) {
			const a = base + j * 2;
			idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
		}
	};
	if (c0 > 0) chordCut(c0);
	if (c1 < 1) chordCut(c1);
	if ((side < 0) !== !!def.vertical) {
		for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setIndex(idx);
	g.computeVertexNormals();
	return g;
}

// Hinged control surface. Returns group with userData.axis; geometry relative to hinge.
function controlSurface(def, s0, s1, c0, c1, side, mat, hingeC = null) {
	const hc = hingeC ?? c0;
	const geo = wingPanel(def, s0, s1, c0, c1, side, 5, 10);
	const pa = wingPoint(def, s0, hc, true, side).add(wingPoint(def, s0, hc, false, side)).multiplyScalar(0.5);
	const pb = wingPoint(def, s1, hc, true, side).add(wingPoint(def, s1, hc, false, side)).multiplyScalar(0.5);
	geo.translate(-pa.x, -pa.y, -pa.z);
	const mesh = new THREE.Mesh(geo, mat);
	mesh.castShadow = true; mesh.receiveShadow = true;
	const grp = new THREE.Group();
	grp.position.copy(pa);
	grp.add(mesh);
	grp.userData.axis = pb.clone().sub(pa).normalize();
	return grp;
}

export function setSurface(grp, teDown) {
	if (!grp) return;
	const ax = grp.userData.axis;
	let a = teDown;
	if (Math.abs(ax.y) > 0.7) a = teDown; // rudder: positive = trailing edge to the right
	else if (ax.x < 0) a = -teDown;
	grp.quaternion.setFromAxisAngle(ax, a);
}

function liveryTexture(draw) {
	const c = document.createElement('canvas');
	c.width = 2048; c.height = 512;
	const g = c.getContext('2d');
	draw(g, c.width, c.height);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 8;
	return t;
}

function textOnSide(g, W, H, text, vCenter, uCenter, height, rightSide, color) {
	// u (around) -> canvas y = (1-u)*H ; v (along) -> canvas x
	g.save();
	g.translate(vCenter * W, (1 - uCenter) * H);
	g.scale(rightSide ? -1 : 1, rightSide ? 1 : -1);
	g.fillStyle = color;
	g.font = `bold ${height * H}px Arial, sans-serif`;
	g.textAlign = 'center'; g.textBaseline = 'middle';
	g.scale(1, -1);
	g.fillText(text, 0, 0);
	g.restore();
}

function wheel(r, w, tireMat, hubMat) {
	const grp = new THREE.Group();
	const tire = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, r * 0.3, 10, 22), tireMat);
	tire.rotation.y = Math.PI / 2;
	tire.scale.set(1, 1, w / (r * 0.6));
	const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.48, r * 0.48, w * 0.85, 16), hubMat);
	hub.rotation.z = Math.PI / 2;
	grp.add(tire, hub);
	grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
	return grp;
}

function navLight(color, intensity) {
	const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6),
		new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), toneMapped: false }));
	return m;
}

const flameMaterial = () => new THREE.ShaderMaterial({
	transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
	uniforms: { uAB: { value: 0 }, uPower: { value: 0 }, uTime: { value: 0 } },
	vertexShader: /* glsl */`
		#include <common>
		#include <logdepthbuf_pars_vertex>
		varying vec3 vP; varying vec3 vN; varying vec3 vV;
		void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv;
		#include <logdepthbuf_vertex>
		}`,
	fragmentShader: /* glsl */`
		#include <common>
		#include <logdepthbuf_pars_fragment>
		uniform float uAB; uniform float uPower; uniform float uTime;
		varying vec3 vP; varying vec3 vN; varying vec3 vV;
		void main(){
			#include <logdepthbuf_fragment>
			float t = clamp(vP.y, 0.0, 1.0); // 0 at nozzle, 1 at tail
			float rim = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
			float diamonds = 0.6 + 0.4 * pow(0.5 + 0.5 * cos(t * 38.0 - uTime * 2.0), 6.0) * (1.0 - t);
			vec3 core = mix(vec3(1.0, 0.85, 0.6), vec3(1.0, 0.45, 0.15), t);
			vec3 blue = vec3(0.35, 0.5, 1.0);
			vec3 c = mix(blue * 0.6, core, uAB) * diamonds;
			float a = pow(1.0 - t, 1.6) * rim * (0.12 + uAB * 1.6) * uPower;
			a *= 0.85 + 0.15 * sin(uTime * 60.0 + t * 20.0);
			gl_FragColor = vec4(c * a * 2.2, 1.0);
		}`,
});

// ---------------------------------------------------------------- aircraft builders
export function buildAircraft(cfg) {
	return cfg.id === 'kestrel' ? buildJet(cfg) : buildTrainer(cfg);
}

function common() {
	const tireMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
	const hubMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.35, metalness: 0.8 });
	const strutMat = new THREE.MeshStandardMaterial({ color: 0xcfd2d6, roughness: 0.25, metalness: 0.9 });
	const glassMat = new THREE.MeshPhysicalMaterial({
		color: 0x99aabb, roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0.28,
		envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.02, side: THREE.DoubleSide, depthWrite: false,
	});
	const darkMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 });
	return { tireMat, hubMat, strutMat, glassMat, darkMat };
}

function finalize(root) {
	root.traverse((o) => { if (o.isMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });
}

function buildCockpit(eye, width, panelColor) {
	const grp = new THREE.Group();
	const panelMat = new THREE.MeshStandardMaterial({ color: panelColor, roughness: 0.75 });
	const panel = new THREE.Mesh(new THREE.BoxGeometry(width, 0.32, 0.08), panelMat);
	panel.position.set(0, eye[1] - 0.36, eye[2] - 0.72);
	panel.rotation.x = -0.25;
	const glare = new THREE.Mesh(new THREE.BoxGeometry(width * 1.02, 0.05, 0.25), panelMat);
	glare.position.set(0, eye[1] - 0.2, eye[2] - 0.78);
	grp.add(panel, glare);
	// gauges
	const gMat = new THREE.MeshStandardMaterial({ color: 0x0b0d0f, roughness: 0.25, metalness: 0.2, emissive: 0x0a1810, emissiveIntensity: 0.02 });
	for (let i = 0; i < 6; i++) {
		const g = new THREE.Mesh(new THREE.CircleGeometry(0.055, 20), gMat);
		g.position.set((i % 3 - 1) * 0.16 - 0.05, eye[1] - 0.31 - Math.floor(i / 3) * 0.13, eye[2] - 0.675 + Math.floor(i / 3) * 0.03);
		g.rotation.x = -0.25;
		grp.add(g);
	}
	const mfdMat = new THREE.MeshStandardMaterial({ color: 0x050807, roughness: 0.15, emissive: 0x1d6040, emissiveIntensity: 0.05 });
	const mfd = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.13), mfdMat);
	mfd.position.set(0.24, eye[1] - 0.37, eye[2] - 0.67); mfd.rotation.x = -0.25;
	grp.add(mfd);
	// control stick
	const stick = new THREE.Group();
	const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.42, 8), panelMat);
	shaft.position.y = 0.21;
	const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.02, 0.1, 8), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 }));
	grip.position.y = 0.45;
	stick.add(shaft, grip);
	stick.position.set(0, eye[1] - 0.9, eye[2] - 0.38);
	grp.add(stick);
	grp.userData.stick = stick;
	grp.userData.glow = [gMat, mfdMat];
	return grp;
}

function buildPilot(eye, suitColor) {
	const g = new THREE.Group();
	const suit = new THREE.MeshStandardMaterial({ color: suitColor, roughness: 0.8 });
	const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.3 }));
	helmet.position.set(eye[0], eye[1] + 0.04, eye[2] + 0.06);
	const visor = new THREE.Mesh(new THREE.SphereGeometry(0.152, 16, 8, -0.9, 1.8, 1.1, 0.8), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.05, metalness: 0.6 }));
	visor.position.copy(helmet.position);
	visor.rotation.y = Math.PI;
	const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.35, 4, 10), suit);
	body.position.set(eye[0], eye[1] - 0.38, eye[2] + 0.15);
	g.add(helmet, visor, body);
	return g;
}

function buildTrainer(cfg) {
	const root = new THREE.Group();
	const M = common();
	const livery = liveryTexture((g, W, H) => {
		g.fillStyle = '#f2f2ee'; g.fillRect(0, 0, W, H);
		// red sweeping cheat-line on both sides + blue belly
		for (const uc of [0.25, 0.75]) {
			g.fillStyle = '#c4161c';
			g.beginPath();
			const yc = (1 - uc) * H;
			g.moveTo(0.04 * W, yc - 0.03 * H);
			g.bezierCurveTo(0.35 * W, yc - 0.06 * H, 0.6 * W, yc + 0.0 * H, 1.0 * W, yc - 0.12 * H * (uc < 0.5 ? 1 : -1));
			g.lineTo(1.0 * W, yc + 0.02 * H * (uc < 0.5 ? 1 : -1));
			g.bezierCurveTo(0.6 * W, yc + 0.07 * H, 0.35 * W, yc + 0.02 * H, 0.04 * W, yc + 0.03 * H);
			g.fill();
			g.fillStyle = '#1b2e6b';
			g.fillRect(0.04 * W, yc + (uc < 0.5 ? 0.05 : -0.065) * H, 0.6 * W, 0.015 * H);
		}
		g.fillStyle = '#1b2e6b'; g.fillRect(0, H * 0.94, W, H * 0.06); g.fillRect(0, 0, W, H * 0.06);
		textOnSide(g, W, H, 'SK-201', 0.66, 0.22, 0.07, true, '#1b2e6b');
		textOnSide(g, W, H, 'SK-201', 0.66, 0.78, 0.07, false, '#1b2e6b');
		g.fillStyle = '#222'; g.fillRect(0, 0.46 * H, 0.06 * W, 0.08 * H); // cowl detail
	});
	const paint = new THREE.MeshPhysicalMaterial({ map: livery, roughness: 0.32, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12 });
	const wingMat = new THREE.MeshPhysicalMaterial({ color: 0xf0f0ea, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15, side: THREE.DoubleSide });
	const redMat = new THREE.MeshPhysicalMaterial({ color: 0xb81419, roughness: 0.35, clearcoat: 0.8, side: THREE.DoubleSide });
	const S = (z, w, ht, hb, yc, n = 2.6) => [z, w, ht, hb, yc, n];
	const fus = loft([
		S(-3.32, 0.30, 0.30, 0.30, 0.0, 2.2),
		S(-3.0, 0.43, 0.44, 0.46, 0.0, 2.5),
		S(-2.4, 0.52, 0.52, 0.56, 0.02),
		S(-1.5, 0.57, 0.55, 0.6, 0.02),
		S(-0.4, 0.58, 0.52, 0.6, 0.02),
		S(0.8, 0.5, 0.48, 0.52, 0.06),
		S(2.2, 0.34, 0.38, 0.36, 0.14),
		S(3.6, 0.18, 0.28, 0.2, 0.26),
		S(4.55, 0.06, 0.15, 0.07, 0.34, 2.2),
	], 44, 7);
	const fm = new THREE.Mesh(fus, paint);
	root.add(fm);

	const wing = { x: 0.5, y: -0.44, z: -1.15, root: 1.78, tip: 1.08, span: 4.35, sweep: 2.5, dihedral: 5, t: 0.15, m: 0.02, p: 0.4 };
	const surfaces = {};
	for (const side of [1, -1]) {
		const k = side > 0 ? 'R' : 'L';
		root.add(new THREE.Mesh(wingPanel(wing, 0, 1, 0, 0.74, side, 10, 14), wingMat));
		root.add(new THREE.Mesh(wingPanel(wing, 0.47, 0.51, 0.74, 1, side, 1, 6), wingMat));
		root.add(new THREE.Mesh(wingPanel(wing, 0.95, 1.0, 0.74, 1, side, 1, 6), redMat));
		surfaces['flap' + k] = controlSurface(wing, 0.0, 0.47, 0.74, 1, side, wingMat);
		surfaces['ail' + k] = controlSurface(wing, 0.51, 0.95, 0.74, 1, side, wingMat);
		root.add(surfaces['flap' + k], surfaces['ail' + k]);
		// red wing tip cap
		const tipDef = { ...wing };
		root.add(new THREE.Mesh(wingPanel(tipDef, 0.95, 1.0, 0, 0.74, side, 1, 12), redMat));
		const nl = navLight(side > 0 ? 0x00ff40 : 0xff1010, 12);
		nl.position.copy(wingPoint(wing, 1, 0.15, true, side)).add(new THREE.Vector3(side * 0.04, 0, 0));
		root.add(nl);
		surfaces['nav' + k] = nl;
		// horizontal tail
		const ht = { x: 0.08, y: 0.24, z: 3.55, root: 1.05, tip: 0.66, span: 1.62, sweep: 9, dihedral: 0, t: 0.1 };
		root.add(new THREE.Mesh(wingPanel(ht, 0, 1, 0, 0.6, side, 4, 10), wingMat));
		surfaces['elev' + k] = controlSurface(ht, 0.04, 1, 0.6, 1, side, redMat);
		root.add(surfaces['elev' + k]);
	}
	const vt = { x: 0, y: 0.3, z: 3.15, root: 1.35, tip: 0.72, span: 1.38, sweep: 32, t: 0.1, vertical: true };
	root.add(new THREE.Mesh(wingPanel(vt, 0, 1, 0, 0.6, 1, 4, 10), wingMat));
	surfaces.rudder = controlSurface(vt, 0.03, 1, 0.6, 1, 1, redMat);
	root.add(surfaces.rudder);
	const beacon = navLight(0xff2010, 0); beacon.position.set(0, 0.62, 1.2);
	const strobe = navLight(0xffffff, 0); strobe.position.copy(wingPoint(vt, 1, 0.98, true, 1)).add(new THREE.Vector3(0, -0.02, 0.05));
	root.add(beacon, strobe);
	surfaces.beacon = beacon; surfaces.strobe = strobe;

	// canopy
	const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.glassMat);
	canopy.scale.set(0.5, 0.5, 1.35);
	canopy.position.set(0, 0.42, -0.65);
	canopy.renderOrder = 2;
	root.add(canopy);
	const frame = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.025, 6, 24, Math.PI), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 }));
	frame.position.set(0, 0.42, -1.25); frame.scale.set(1, 0.98, 1);
	root.add(frame);

	// spinner + propeller
	const spinner = new THREE.Mesh(new THREE.LatheGeometry(
		Array.from({ length: 12 }, (_, i) => { const t = i / 11; return new THREE.Vector2(0.27 * Math.sqrt(Math.max(0, 1 - t * t)) + 0.001, t * 0.55); }), 24), redMat);
	spinner.rotation.x = -Math.PI / 2;
	spinner.position.set(0, 0.0, -3.3);
	root.add(spinner);
	const prop = new THREE.Group();
	prop.position.set(0, 0, -3.42);
	const bladeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 });
	for (let b = 0; b < 2; b++) {
		const bladeGeo = new THREE.BoxGeometry(0.11, 0.92, 0.025, 1, 6, 1);
		const bp = bladeGeo.attributes.position;
		for (let i = 0; i < bp.count; i++) {
			const y = bp.getY(i) + 0.46;
			const tw = (1 - y / 0.92) * 0.6 + 0.15;
			const x = bp.getX(i) * (1 - 0.45 * y / 0.92), z = bp.getZ(i);
			bp.setXYZ(i, x * Math.cos(tw) - z * Math.sin(tw), y + 0.1, x * Math.sin(tw) + z * Math.cos(tw));
		}
		bladeGeo.computeVertexNormals();
		const blade = new THREE.Mesh(bladeGeo, bladeMat);
		blade.rotation.z = b * Math.PI;
		prop.add(blade);
	}
	root.add(prop);
	const discMat = new THREE.ShaderMaterial({
		transparent: true, depthWrite: false, side: THREE.DoubleSide,
		uniforms: { uAlpha: { value: 0 }, uLight: { value: new THREE.Color(1, 1, 1) } },
		vertexShader: `#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);\n#include <logdepthbuf_vertex>\n}`,
		fragmentShader: `#include <common>\n#include <logdepthbuf_pars_fragment>\nuniform float uAlpha; uniform vec3 uLight; varying vec2 vUv; void main(){\n#include <logdepthbuf_fragment>\n vec2 p = vUv*2.0-1.0; float r = length(p); if (r > 1.0) discard; float a = smoothstep(1.0, 0.9, r) * (0.55 + 0.45*smoothstep(0.2,0.95,r)) * uAlpha; float tipBand = smoothstep(0.93, 0.97, r) * smoothstep(1.0, 0.97, r); vec3 c = mix(vec3(0.02), vec3(0.6,0.55,0.1), tipBand) * uLight; gl_FragColor = vec4(c, a * 0.32 + tipBand * uAlpha * 0.3); }`,
	});
	const disc = new THREE.Mesh(new THREE.CircleGeometry(1.03, 48), discMat);
	disc.position.set(0, 0, -3.43);
	root.add(disc);

	// fixed tricycle gear with wheel fairings
	const gear = [];
	cfg.gear.forEach((gd, i) => {
		const grp = new THREE.Group();
		const wpos = new THREE.Vector3(gd.p[0], gd.p[1] + gd.r, gd.p[2]);
		const top = i === 0 ? new THREE.Vector3(0, -0.4, -2.35) : new THREE.Vector3(gd.p[0] * 0.55, -0.55, gd.p[2] - 0.1);
		const len = top.distanceTo(wpos);
		const strut = new THREE.Mesh(new THREE.CylinderGeometry(i === 0 ? 0.035 : 0.05, i === 0 ? 0.035 : 0.06, len, 8), i === 0 ? M.strutMat : wingMat);
		strut.position.copy(top).add(wpos).multiplyScalar(0.5);
		strut.lookAt(wpos); strut.rotateX(Math.PI / 2);
		const wh = wheel(gd.r, i === 0 ? 0.12 : 0.15, M.tireMat, M.hubMat);
		wh.position.copy(wpos);
		const spat = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), i === 0 ? redMat : wingMat);
		spat.scale.set(0.13, gd.r * 0.95, gd.r * 2.3);
		spat.position.copy(wpos).add(new THREE.Vector3(0, 0.06, -0.05));
		grp.add(strut, wh, spat);
		root.add(grp);
		gear.push({ grp, wheel: wh, base: wpos.clone(), strut });
	});

	const cockpit = buildCockpit(cfg.eye, 0.8, 0x2a2c30);
	const pilot = buildPilot(cfg.eye, 0x3b4a2a);
	root.add(cockpit, pilot);
	finalize(root);
	return { root, surfaces, prop, disc, discMat, gear, canopy, cockpit, pilot, type: 'prop', spinner };
}

function buildJet(cfg) {
	const root = new THREE.Group();
	const M = common();
	const camo = liveryTexture((g, W, H) => {
		g.fillStyle = '#7c8792'; g.fillRect(0, 0, W, H);
		// splinter camo on top half
		let seed = 7;
		const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
		g.fillStyle = '#5d6873';
		for (let i = 0; i < 28; i++) {
			g.beginPath();
			const x = rnd() * W, y = H * (0.35 + rnd() * 0.3);
			g.moveTo(x, y);
			for (let k = 0; k < 4; k++) g.lineTo(x + (rnd() - 0.5) * 420, y + (rnd() - 0.5) * 160);
			g.fill();
		}
		g.fillStyle = '#9aa3ab'; g.fillRect(0, 0, W, H * 0.2); g.fillRect(0, H * 0.8, W, H * 0.2);
		// anti-glare panel ahead of canopy
		g.fillStyle = '#2b2f33'; g.fillRect(0.12 * W, H * 0.46, 0.16 * W, H * 0.08);
		// radome
		g.fillStyle = '#6e767e'; g.fillRect(0, 0, 0.05 * W, H);
		textOnSide(g, W, H, '09-417', 0.82, 0.23, 0.05, true, '#2e3338');
		textOnSide(g, W, H, '09-417', 0.82, 0.77, 0.05, false, '#2e3338');
		// rescue arrow / panel lines
		g.strokeStyle = 'rgba(40,45,50,0.35)'; g.lineWidth = 2;
		for (let i = 1; i < 14; i++) { g.beginPath(); g.moveTo(i * W / 14, 0); g.lineTo(i * W / 14, H); g.stroke(); }
	});
	const paint = new THREE.MeshPhysicalMaterial({ map: camo, roughness: 0.55, metalness: 0.25, clearcoat: 0.3, clearcoatRoughness: 0.4 });
	const grey = new THREE.MeshPhysicalMaterial({ color: 0x75808a, roughness: 0.55, metalness: 0.25, clearcoat: 0.25, side: THREE.DoubleSide });
	const greyD = new THREE.MeshPhysicalMaterial({ color: 0x5f6973, roughness: 0.55, metalness: 0.25, clearcoat: 0.25, side: THREE.DoubleSide });
	const S = (z, w, ht, hb, yc, n = 2.4) => [z, w, ht, hb, yc, n];
	const fus = loft([
		S(-8.15, 0.01, 0.01, 0.01, -0.02, 2),
		S(-7.6, 0.24, 0.25, 0.22, 0.0, 2),
		S(-6.6, 0.44, 0.42, 0.38, 0.03, 2.1),
		S(-5.4, 0.6, 0.55, 0.5, 0.06, 2.3),
		S(-4.2, 0.72, 0.62, 0.6, 0.06),
		S(-2.8, 1.02, 0.66, 0.68, 0.0, 2.8),
		S(-1.0, 1.28, 0.66, 0.72, -0.02, 3.0),
		S(1.6, 1.24, 0.62, 0.7, 0.0, 3.0),
		S(4.0, 0.98, 0.56, 0.6, 0.02, 2.6),
		S(5.6, 0.66, 0.54, 0.54, 0.04, 2.1),
		S(6.25, 0.58, 0.52, 0.52, 0.04, 2.0),
	], 48, 7);
	root.add(new THREE.Mesh(fus, paint));
	// intakes
	for (const side of [1, -1]) {
		const intakeGeo = loft([
			[-3.35, 0.3, 0.44, 0.44, 0, 3.2], [-3.2, 0.34, 0.47, 0.47, 0, 3.2], [-2.0, 0.36, 0.48, 0.5, 0, 3.0],
			[-0.6, 0.32, 0.42, 0.48, 0.02, 2.6], [0.6, 0.2, 0.3, 0.36, 0.05, 2.2],
		], 28, 5);
		const intake = new THREE.Mesh(intakeGeo, paint);
		intake.position.set(side * 1.0, -0.12, 0);
		root.add(intake);
		const lip = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.74), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 }));
		lip.position.set(side * 1.0, -0.12, -3.36);
		lip.rotation.y = Math.PI;
		root.add(lip);
	}
	const wing = { x: 0.95, y: -0.12, z: -2.0, root: 4.7, tip: 1.25, span: 3.95, sweep: 40, dihedral: -2.5, t: 0.05, m: 0.0, p: 0.4 };
	const surfaces = {};
	for (const side of [1, -1]) {
		const k = side > 0 ? 'R' : 'L';
		root.add(new THREE.Mesh(wingPanel(wing, 0, 1, 0, 0.76, side, 10, 14), grey));
		root.add(new THREE.Mesh(wingPanel(wing, 0.92, 1, 0.76, 1, side, 1, 6), grey));
		surfaces['flap' + k] = controlSurface(wing, 0.0, 0.5, 0.76, 1, side, grey);
		surfaces['ail' + k] = controlSurface(wing, 0.5, 0.92, 0.76, 1, side, grey);
		root.add(surfaces['flap' + k], surfaces['ail' + k]);
		// LERX
		const lerx = new THREE.Shape();
		lerx.moveTo(0, 0); lerx.lineTo(0.6, 2.9); lerx.lineTo(0, 3.1); lerx.lineTo(0, 0);
		const lg = new THREE.ExtrudeGeometry(lerx, { depth: 0.06, bevelEnabled: false });
		lg.rotateX(Math.PI / 2);
		const lm = new THREE.Mesh(lg, grey);
		lm.position.set(side * 0.9, -0.06, -5.0);
		lm.scale.x = side;
		root.add(lm);
		// stabilators (all-moving)
		const ht = { x: 1.0, y: -0.15, z: 3.7, root: 2.3, tip: 0.85, span: 2.35, sweep: 42, dihedral: -6, t: 0.045 };
		surfaces['elev' + k] = controlSurface(ht, 0, 1, 0, 1, side, greyD, 0.38);
		root.add(surfaces['elev' + k]);
		// wingtip launch rail + missile
		const tip = wingPoint(wing, 1, 0.5, true, side);
		const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 2.4), greyD);
		rail.position.set(tip.x + side * 0.03, tip.y, tip.z - 0.2);
		const msl = new THREE.Group();
		const body = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 2.9, 12), new THREE.MeshStandardMaterial({ color: 0xe6e6e0, roughness: 0.4 }));
		body.rotation.x = Math.PI / 2;
		const seeker = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.5 }));
		seeker.rotation.x = -Math.PI / 2; seeker.position.z = -1.45;
		msl.add(body, seeker);
		for (let f = 0; f < 4; f++) {
			const fin = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.26, 0.3), new THREE.MeshStandardMaterial({ color: 0xd0d0cc }));
			fin.position.z = 1.2; fin.rotation.z = f * Math.PI / 2 + Math.PI / 4;
			fin.position.x = Math.cos(f * Math.PI / 2 + Math.PI / 4) * 0.0;
			msl.add(fin);
		}
		msl.position.set(tip.x + side * 0.12, tip.y - 0.02, tip.z - 0.4);
		root.add(rail, msl);
		const nl = navLight(side > 0 ? 0x00ff40 : 0xff1010, 12);
		nl.position.set(tip.x - side * 0.1, tip.y + 0.05, tip.z - 0.6);
		root.add(nl);
		surfaces['nav' + k] = nl;
	}
	const vt = { x: 0, y: 0.5, z: 2.6, root: 3.2, tip: 1.05, span: 2.9, sweep: 46, t: 0.05, vertical: true };
	root.add(new THREE.Mesh(wingPanel(vt, 0, 1, 0, 0.72, 1, 6, 12), grey));
	surfaces.rudder = controlSurface(vt, 0.05, 0.85, 0.72, 1, 1, greyD);
	root.add(surfaces.rudder);
	const beacon = navLight(0xff2010, 0); beacon.position.set(0, -0.8, 0.5);
	const strobe = navLight(0xffffff, 0); strobe.position.copy(wingPoint(vt, 1, 0.6, true, 1)).add(new THREE.Vector3(0, 0.03, 0));
	root.add(beacon, strobe);
	surfaces.beacon = beacon; surfaces.strobe = strobe;
	// speed brake panel
	const sbGeo = new THREE.BoxGeometry(1.1, 0.04, 1.4).translate(0, 0, 0.7);
	const sb = new THREE.Mesh(sbGeo, greyD);
	const sbG = new THREE.Group(); sbG.position.set(0, 0.62, 2.0); sbG.add(sb);
	root.add(sbG);
	surfaces.airbrake = sbG;

	// canopy
	const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.glassMat);
	canopy.scale.set(0.52, 0.62, 2.0);
	canopy.position.set(0, 0.5, -4.25);
	canopy.renderOrder = 2;
	root.add(canopy);
	const hudGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.14), new THREE.MeshBasicMaterial({ color: 0x88ffaa, transparent: true, opacity: 0.08, depthWrite: false }));
	hudGlass.position.set(0, cfg.eye[1] - 0.06, cfg.eye[2] - 0.62); hudGlass.rotation.x = -0.35;
	root.add(hudGlass);

	// nozzle + flame
	const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 1.0, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x4a4440, roughness: 0.45, metalness: 0.9, side: THREE.DoubleSide }));
	noz.rotation.x = Math.PI / 2; noz.position.set(0, 0.04, 6.7);
	const inner = new THREE.Mesh(new THREE.CircleGeometry(0.48, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.15, 0.05) }));
	inner.position.set(0, 0.04, 6.5); inner.rotation.y = Math.PI;
	root.add(noz, inner);
	const flameMat = flameMaterial();
	const flameGeo = new THREE.CylinderGeometry(0.42, 0.12, 1, 24, 8, true).translate(0, 0.5, 0);
	flameGeo.rotateX(Math.PI / 2);
	const flame = new THREE.Mesh(flameGeo, flameMat);
	flame.position.set(0, 0.04, 7.15);
	flame.renderOrder = 3;
	flame.frustumCulled = false;
	root.add(flame);
	// the shader uses distance along the flame (local z after rotation) as vP.y
	flameMat.vertexShader = flameMat.vertexShader.replace('vP = position;', 'vP = vec3(position.x, position.z, position.y);');

	// retractable gear
	const gear = [];
	cfg.gear.forEach((gd, i) => {
		const pivot = new THREE.Group();
		const top = i === 0 ? new THREE.Vector3(0, -0.6, -5.0) : new THREE.Vector3(gd.p[0] * 0.75, -0.55, gd.p[2] - 0.2);
		pivot.position.copy(top);
		const wpos = new THREE.Vector3(gd.p[0], gd.p[1] + gd.r, gd.p[2]).sub(top);
		const len = wpos.length();
		const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, len, 10), M.strutMat);
		strut.position.copy(wpos).multiplyScalar(0.5);
		strut.lookAt(wpos); strut.rotateX(Math.PI / 2);
		const wh = wheel(gd.r, i === 0 ? 0.2 : 0.26, M.tireMat, M.hubMat);
		wh.position.copy(wpos);
		pivot.add(strut, wh);
		if (i === 0) {
			const ll = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 8, 7) }));
			ll.position.copy(wpos).multiplyScalar(0.55).add(new THREE.Vector3(0, 0, -0.12));
			pivot.add(ll);
		}
		root.add(pivot);
		gear.push({ grp: pivot, wheel: wh, base: wh.position.clone(), strut, retractAxis: i === 0 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, gd.p[0] > 0 ? 1 : -1), retractAngle: i === 0 ? -1.75 : 1.6 });
	});
	const cockpit = buildCockpit(cfg.eye, 0.75, 0x2d3034);
	cockpit.position.set(0, -0.08, -0.1);
	const pilot = buildPilot(cfg.eye, 0x4a5240);
	root.add(cockpit, pilot);
	finalize(root);
	return { root, surfaces, gear, canopy, cockpit, pilot, flame, flameMat, type: 'jet' };
}
