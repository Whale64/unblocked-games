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
function loft(stations, radial = 40, perSeg = 6, caps = true) {
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
	if (!caps) {
		const g0 = new THREE.BufferGeometry();
		g0.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		g0.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
		g0.setIndex(idx);
		g0.computeVertexNormals();
		return g0;
	}
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
	const pos = [], idx = [], uvs = [];
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
				uvs.push(s, cs(i));
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
		uvs.push(s, 0.5);
		ring.forEach((p, k) => { pos.push(p.x, p.y, p.z); uvs.push(s, k <= nc ? cs(k) : cs(2 * nc + 1 - k)); });
		for (let i = 0; i < ring.length - 1; i++) idx.push(base, base + 1 + i, base + 2 + i);
	};
	cap(s0); cap(s1);
	const chordCut = (c) => {
		const base = pos.length / 3;
		for (let j = 0; j <= ns; j++) {
			const s = s0 + (s1 - s0) * j / ns;
			const a = wingPoint(def, s, c, true, side), b = wingPoint(def, s, c, false, side);
			pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
			uvs.push(s, c, s, c);
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
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
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

function makeCanvas(W, H) { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; }

// Normal map from a height (bump) canvas via a Sobel filter. Canvas rows run top-down while v runs up.
function normalFromBump(bump, strength) {
	const W = bump.width, H = bump.height;
	const src = bump.getContext('2d').getImageData(0, 0, W, H).data;
	const out = makeCanvas(W, H);
	const og = out.getContext('2d');
	const img = og.createImageData(W, H);
	const h = (x, y) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x - 1, y) + h(x - 1, y + 1));
		const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x, y - 1) + h(x + 1, y - 1));
		let nx = -dx * strength, ny = dy * strength, nz = 1;
		const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
		const o = (y * W + x) * 4;
		img.data[o] = (nx * 0.5 + 0.5) * 255; img.data[o + 1] = (ny * 0.5 + 0.5) * 255; img.data[o + 2] = (nz * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
	}
	og.putImageData(img, 0, 0);
	const t = new THREE.CanvasTexture(out);
	t.anisotropy = 8;
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	return t;
}

function seeded(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

// Draws recessed panel seams, rivet rows and access hatches into the albedo, bump and roughness canvases.
function panelDetail(ctxs, W, H, layout, seed) {
	const rnd = seeded(seed);
	const { a, b, r } = ctxs;
	const line = (x0, y0, x1, y1) => {
		a.strokeStyle = `rgba(20,22,26,${layout.lineAlpha ?? 0.32})`; a.lineWidth = 1.4; a.beginPath(); a.moveTo(x0, y0); a.lineTo(x1, y1); a.stroke();
		b.strokeStyle = 'rgb(40,40,40)'; b.lineWidth = 2.2; b.beginPath(); b.moveTo(x0, y0); b.lineTo(x1, y1); b.stroke();
		r.strokeStyle = 'rgba(200,200,200,0.5)'; r.lineWidth = 2; r.beginPath(); r.moveTo(x0, y0); r.lineTo(x1, y1); r.stroke();
	};
	const rivets = (x0, y0, x1, y1, off = 5, step = 7) => {
		const len = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(len / step);
		const nx = -(y1 - y0) / len * off, ny = (x1 - x0) / len * off;
		for (let i = 0; i <= n; i++) {
			const t = i / Math.max(n, 1), x = x0 + (x1 - x0) * t + nx, y = y0 + (y1 - y0) * t + ny;
			b.fillStyle = 'rgb(165,165,165)'; b.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
			a.fillStyle = 'rgba(255,255,255,0.10)'; a.fillRect(x - 0.7, y - 0.7, 1.4, 1.4);
		}
	};
	for (const x of layout.frames || []) {
		const X = x * W;
		let y = 0;
		while (y < H) { const seg = 40 + rnd() * 160; if (rnd() > 0.15) { line(X, y, X, Math.min(H, y + seg)); rivets(X, y, X, Math.min(H, y + seg)); } y += seg; }
	}
	for (const v of layout.stringers || []) {
		const Y = (1 - v) * H;
		let x = 0;
		while (x < W) { const seg = 120 + rnd() * 380; if (rnd() > 0.2) { line(x, Y, Math.min(W, x + seg), Y); rivets(x, Y, Math.min(W, x + seg), Y, 4, 9); } x += seg; }
	}
	for (let i = 0; i < (layout.hatches || 0); i++) {
		const x = rnd() * W * 0.9, y = H * (0.1 + rnd() * 0.8), w = 20 + rnd() * 50, hh = 14 + rnd() * 30;
		a.strokeStyle = 'rgba(20,22,26,0.3)'; a.lineWidth = 1.2; a.strokeRect(x, y, w, hh);
		b.strokeStyle = 'rgb(55,55,55)'; b.lineWidth = 2; b.strokeRect(x, y, w, hh);
		for (const [cx, cy] of [[x + 3, y + 3], [x + w - 3, y + 3], [x + 3, y + hh - 3], [x + w - 3, y + hh - 3]]) { b.fillStyle = 'rgb(175,175,175)'; b.fillRect(cx - 1.2, cy - 1.2, 2.4, 2.4); }
	}
}

// Build albedo + normal + roughness maps. drawBase paints the livery; layout describes panels;
// grime(a, r, W, H) adds weathering. Roughness canvas is grey = roughness * 255.
export function skin(W, H, roughness, drawBase, layout, grime, seed = 7, bumpStrength = 2.2, bumpDraw = null) {
	const ca = makeCanvas(W, H), cb = makeCanvas(W, H), cr = makeCanvas(W, H);
	const a = ca.getContext('2d'), b = cb.getContext('2d'), r = cr.getContext('2d');
	drawBase(a, W, H);
	b.fillStyle = 'rgb(128,128,128)'; b.fillRect(0, 0, W, H);
	if (bumpDraw) bumpDraw(b, W, H);
	const rv = Math.round(roughness * 255);
	r.fillStyle = `rgb(${rv},${rv},${rv})`; r.fillRect(0, 0, W, H);
	// subtle large-scale roughness / dirt variation
	const rnd = seeded(seed * 31 + 5);
	for (let i = 0; i < 90; i++) {
		const x = rnd() * W, y = rnd() * H, rad = 20 + rnd() * 120;
		const gr = r.createRadialGradient(x, y, 0, x, y, rad);
		const gv = rnd() > 0.5 ? 255 : 0;
		gr.addColorStop(0, `rgba(${gv},${gv},${gv},0.07)`);
		gr.addColorStop(1, 'rgba(128,128,128,0)');
		r.fillStyle = gr; r.fillRect(x - rad, y - rad, rad * 2, rad * 2);
	}
	panelDetail({ a, b, r }, W, H, layout, seed);
	if (grime) grime(a, r, W, H);
	const map = new THREE.CanvasTexture(ca); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
	map.wrapS = map.wrapT = THREE.RepeatWrapping;
	const rough = new THREE.CanvasTexture(cr); rough.anisotropy = 8;
	rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
	return { map, normalMap: normalFromBump(cb, bumpStrength), roughnessMap: rough };
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
	// right side: text runs tail->nose (mirror x); left side: "up" the fuselage is canvas-down (mirror y)
	g.scale(rightSide ? -1 : 1, rightSide ? 1 : -1);
	g.fillStyle = color;
	g.font = `bold ${height * H}px Arial, sans-serif`;
	g.textAlign = 'center'; g.textBaseline = 'middle';
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

// ---------------------------------------------------------------- skin layouts
const range = (a, b, st) => { const o = []; for (let x = a; x <= b + 1e-6; x += st) o.push(x); return o; };
const TRAINER_FUS = { frames: [0.08, 0.17, 0.31, 0.44, 0.52, 0.6, 0.68, 0.76, 0.84, 0.92], stringers: [0.13, 0.31, 0.5, 0.69, 0.87], hatches: 10 };
const JET_FUS = { frames: range(0.05, 0.97, 0.045), stringers: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9], hatches: 26 };
const WING = { frames: range(0.08, 0.95, 0.09), stringers: [0.12, 0.42, 0.74], hatches: 6 };
const TAIL = { frames: range(0.15, 0.9, 0.17), stringers: [0.15, 0.6], hatches: 0 };

function soot(a, r, x0, x1, y0, y1, alpha) {
	const g = a.createLinearGradient(x0, 0, x1, 0);
	g.addColorStop(0, `rgba(25,22,20,${alpha})`); g.addColorStop(1, 'rgba(25,22,20,0)');
	a.fillStyle = g; a.fillRect(x0, y0, x1 - x0, y1 - y0);
	const gr = r.createLinearGradient(x0, 0, x1, 0);
	gr.addColorStop(0, 'rgba(230,230,230,0.6)'); gr.addColorStop(1, 'rgba(230,230,230,0)');
	r.fillStyle = gr; r.fillRect(x0, y0, x1 - x0, y1 - y0);
}
function trainerGrime(a, r, W, H) {
	// exhaust soot streaks behind the cowling on the lower sides, oil film on the belly
	soot(a, r, 0.07 * W, 0.42 * W, 0.78 * H, 0.84 * H, 0.35);
	soot(a, r, 0.07 * W, 0.42 * W, 0.16 * H, 0.22 * H, 0.35);
	const g = a.createLinearGradient(0, 0.9 * H, 0, H);
	g.addColorStop(0, 'rgba(40,35,25,0)'); g.addColorStop(1, 'rgba(40,35,25,0.18)');
	a.fillStyle = g; a.fillRect(0, 0.9 * H, W, 0.1 * H);
}
function jetGrime(a, r, W, H) {
	soot(a, r, W, 0.86 * W, 0, H, 0.0);
	const g = a.createLinearGradient(0.9 * W, 0, W, 0);
	g.addColorStop(0, 'rgba(30,26,22,0)'); g.addColorStop(1, 'rgba(30,26,22,0.55)');
	a.fillStyle = g; a.fillRect(0.9 * W, 0, 0.1 * W, H);
	const gr = r.createLinearGradient(0.9 * W, 0, W, 0);
	gr.addColorStop(0, 'rgba(240,240,240,0)'); gr.addColorStop(1, 'rgba(240,240,240,0.6)');
	r.fillStyle = gr; r.fillRect(0.9 * W, 0, 0.1 * W, H);
}
function plainSkin(color, roughness, layout, seed, W = 1024, H = 512, extra) {
	return skin(W, H, roughness, (g) => { g.fillStyle = color; g.fillRect(0, 0, W, H); if (extra) extra(g, W, H); }, layout, null, seed);
}
export function skinMat(sk, opts) {
	return new THREE.MeshPhysicalMaterial({ map: sk.map, normalMap: sk.normalMap, normalScale: new THREE.Vector2(0.55, 0.55), roughnessMap: sk.roughnessMap, roughness: 1, ...opts });
}

// ---------------------------------------------------------------- aircraft builders
export function buildAircraft(cfg) {
	if (cfg.category === 'airliner') return buildAirliner(cfg);
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
	const fusSkin = skin(2048, 512, 0.3, (g, W, H) => {
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
		// cowl louvres
		g.fillStyle = 'rgba(30,30,30,0.6)';
		for (let i = 0; i < 6; i++) { g.fillRect(0.03 * W + i * 9, 0.70 * H, 5, 0.05 * H); g.fillRect(0.03 * W + i * 9, 0.25 * H, 5, 0.05 * H); }
	}, TRAINER_FUS, trainerGrime, 11);
	const paint = skinMat(fusSkin, { metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.1 });
	const wingSkin = plainSkin('#f0f0ea', 0.32, WING, 23, 1024, 512, (g, W, H) => {
		// walkway & "NO STEP" stencils near the root
		g.fillStyle = 'rgba(25,25,25,0.85)'; g.fillRect(0.02 * W, 0.45 * H, 0.1 * W, 0.22 * H);
		g.save(); g.translate(0.2 * W, 0.6 * H); g.fillStyle = 'rgba(40,40,40,0.7)'; g.font = 'bold 22px Arial'; g.fillText('NO STEP', 0, 0); g.restore();
	});
	const wingMat = skinMat(wingSkin, { clearcoat: 0.8, clearcoatRoughness: 0.12, side: THREE.DoubleSide });
	const redMat = skinMat(plainSkin('#b81419', 0.32, TAIL, 31, 512, 256), { clearcoat: 0.8, clearcoatRoughness: 0.12, side: THREE.DoubleSide });
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
	const fusSkin = skin(2048, 512, 0.55, (g, W, H) => {
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
		// stencils
		g.fillStyle = 'rgba(40,45,50,0.6)'; g.font = 'bold 14px Arial';
		g.save(); g.translate(0.3 * W, 0.62 * H); g.scale(1, -1); g.fillText('RESCUE', 0, 0); g.restore();
		g.fillStyle = 'rgba(200,60,40,0.7)'; g.fillRect(0.29 * W, 0.66 * H, 40, 4);
	}, JET_FUS, jetGrime, 17, 2.6);
	const paint = skinMat(fusSkin, { metalness: 0.2, clearcoat: 0.25, clearcoatRoughness: 0.45 });
	const wingSkin = skin(1024, 512, 0.55, (g, W, H) => {
		g.fillStyle = '#75808a'; g.fillRect(0, 0, W, H);
		const rnd = seeded(41);
		g.fillStyle = '#5f6a75';
		for (let i = 0; i < 12; i++) { g.beginPath(); const x = rnd() * W, y = rnd() * H; g.moveTo(x, y); for (let k = 0; k < 4; k++) g.lineTo(x + (rnd() - 0.5) * 300, y + (rnd() - 0.5) * 260); g.fill(); }
		// low-visibility roundel near the tip
		const cx = 0.74 * W, cy = 0.55 * H, R = 0.14 * H;
		g.strokeStyle = 'rgba(55,62,70,0.9)'; g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
		g.fillStyle = 'rgba(55,62,70,0.9)';
		g.beginPath(); g.moveTo(cx, cy - R * 0.7); g.lineTo(cx + R * 0.6, cy + R * 0.45); g.lineTo(cx, cy + R * 0.15); g.lineTo(cx - R * 0.6, cy + R * 0.45); g.fill();
	}, WING, null, 29, 2.4);
	const grey = skinMat(wingSkin, { metalness: 0.2, clearcoat: 0.2, clearcoatRoughness: 0.45, side: THREE.DoubleSide });
	const greyD = skinMat(plainSkin('#5f6973', 0.55, TAIL, 37, 512, 256), { metalness: 0.2, clearcoat: 0.2, clearcoatRoughness: 0.45, side: THREE.DoubleSide });
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

// ---------------------------------------------------------------- airliners (737 MAX 8 / A320neo)
const AIRLINER = {
	b737: {
		airline: 'SKYWARD', reg: 'N738SK', body: '#f4f5f7', accent: '#123a7a', accent2: '#3fa3e0',
		fus: [[-19.9, 0.05, 0.05, 0.05, -0.35, 2], [-19.4, 0.75, 0.62, 0.72, -0.38, 2], [-18.4, 1.35, 1.2, 1.38, -0.22, 2], [-17.0, 1.75, 1.7, 1.8, -0.06, 2],
			[-15.2, 1.88, 1.86, 1.9, 0, 2], [8.5, 1.88, 1.86, 1.9, 0, 2], [11.5, 1.72, 1.78, 1.6, 0.18, 2], [14.5, 1.32, 1.48, 1.0, 0.5, 2], [17.2, 0.78, 1.0, 0.42, 0.9, 2], [19.6, 0.22, 0.32, 0.12, 1.3, 2]],
		wing: { x: 1.7, y: -1.25, z: -4.4, root: 7.2, tip: 1.35, span: 16.25, sweep: 27, dihedral: 6, t: 0.13, m: 0.025, p: 0.4 },
		winglet: 'split',
		eng: { x: 4.95, y: -1.95, len: 4.6, r: 1.06, ahead: 3.0, chevrons: true },
		vt: { x: 0, y: 1.5, z: 12.7, root: 6.3, tip: 2.0, span: 6.7, sweep: 36, t: 0.1, vertical: true },
		dorsal: { x: 0, y: 1.3, z: 10.2, root: 3.2, tip: 0.25, span: 1.2, sweep: 68, t: 0.08, vertical: true },
		ht: { x: 0.45, y: 0.65, z: 15.3, root: 3.9, tip: 1.3, span: 6.4, sweep: 32, dihedral: 7, t: 0.09 },
		gearTop: { nose: [0, -1.6, -14.0], main: [2.25, -1.45, 1.4] },
		fairing: [0, -1.65, -0.8, 2.3, 0.9, 8.5],
	},
	a320: {
		airline: 'AEROLUMEN', reg: 'F-LUMN', body: '#f6f7f8', accent: '#0e6f6a', accent2: '#e8a33a',
		fus: [[-18.3, 0.05, 0.05, 0.05, -0.3, 2], [-17.75, 0.85, 0.72, 0.8, -0.32, 2], [-16.6, 1.5, 1.4, 1.5, -0.15, 2], [-15.2, 1.88, 1.86, 1.94, -0.02, 2],
			[-13.8, 1.98, 1.97, 2.0, 0, 2], [8.0, 1.98, 1.97, 2.0, 0, 2], [11.0, 1.8, 1.86, 1.62, 0.2, 2], [14.0, 1.35, 1.5, 0.95, 0.55, 2], [16.8, 0.75, 0.98, 0.4, 0.95, 2], [19.2, 0.2, 0.3, 0.1, 1.35, 2]],
		wing: { x: 1.9, y: -1.3, z: -4.6, root: 7.0, tip: 1.5, span: 15.95, sweep: 27, dihedral: 5.1, t: 0.125, m: 0.025, p: 0.4 },
		winglet: 'sharklet',
		eng: { x: 5.75, y: -2.25, len: 5.0, r: 1.22, ahead: 3.2, chevrons: false },
		vt: { x: 0, y: 1.6, z: 12.6, root: 5.8, tip: 2.3, span: 6.0, sweep: 34, t: 0.1, vertical: true },
		dorsal: { x: 0, y: 1.45, z: 11.0, root: 1.8, tip: 0.2, span: 0.7, sweep: 60, t: 0.08, vertical: true },
		ht: { x: 0.5, y: 0.6, z: 14.6, root: 3.8, tip: 1.4, span: 6.15, sweep: 29, dihedral: 6, t: 0.09 },
		gearTop: { nose: [0, -1.7, -11.1], main: [3.0, -1.5, 1.4] },
		fairing: [0, -1.75, -0.8, 2.4, 0.95, 8.5],
	},
};

function airlinerLivery(spec, zMin, zMax) {
	const W = 3072, H = 768;
	const sOf = (z) => (z - zMin) / (zMax - zMin);
	const frames = []; for (let z = -16; z <= 15; z += 1.6) frames.push(sOf(z));
	return skin(W, H, 0.28, (g) => {
		g.fillStyle = spec.body; g.fillRect(0, 0, W, H);
		// belly band in the accent colour + side sweep (u: 0 belly, 0.25 right, 0.5 top, 0.75 left)
		g.fillStyle = spec.accent;
		g.fillRect(0, H * 0.9, W, H * 0.1); g.fillRect(0, 0, W, H * 0.1);
		for (const rightSide of [true, false]) {
			const yBand = (u) => (1 - u) * H;
			const u0 = rightSide ? 0.16 : 0.84;
			g.beginPath();
			g.moveTo(0.45 * W, yBand(rightSide ? 0.1 : 0.9));
			g.bezierCurveTo(0.7 * W, yBand(rightSide ? 0.12 : 0.88), 0.85 * W, yBand(rightSide ? 0.2 : 0.8), W, yBand(rightSide ? 0.36 : 0.64));
			g.lineTo(W, yBand(rightSide ? 0.1 : 0.9));
			g.closePath(); g.fill();
			g.fillStyle = spec.accent2;
			g.beginPath();
			g.moveTo(0.52 * W, yBand(u0));
			g.bezierCurveTo(0.72 * W, yBand(rightSide ? 0.17 : 0.83), 0.86 * W, yBand(rightSide ? 0.24 : 0.76), W, yBand(rightSide ? 0.4 : 0.6));
			g.lineTo(W, yBand(rightSide ? 0.37 : 0.63));
			g.bezierCurveTo(0.86 * W, yBand(rightSide ? 0.21 : 0.79), 0.72 * W, yBand(rightSide ? 0.15 : 0.85), 0.52 * W, yBand(u0 + (rightSide ? -0.01 : 0.01)));
			g.fill();
			g.fillStyle = spec.accent;
			// cabin windows (slightly above the centre line), doors, titles
			const uw = rightSide ? 0.283 : 0.717;
			for (let z = -14.2; z <= 10.3; z += 0.51) {
				if (Math.abs(z - (-0.6)) < 0.25 || Math.abs(z - 0.3) < 0.2) continue; // overwing exits
				const x = sOf(z) * W, y = (1 - uw) * H;
				g.fillStyle = '#1b2633';
				g.beginPath(); g.ellipse(x, y, 6, 9, 0, 0, Math.PI * 2); g.fill();
			}
			for (const [z, w] of [[-15.6, 0.95], [13.6, 0.85]]) {
				const x = sOf(z) * W, y = (1 - (rightSide ? 0.25 : 0.75)) * H;
				g.strokeStyle = 'rgba(60,70,80,0.55)'; g.lineWidth = 2.5;
				g.strokeRect(x - (w / (zMax - zMin)) * W / 2, y - 0.075 * H, (w / (zMax - zMin)) * W, 0.15 * H);
			}
			textOnSide(g, W, H, spec.airline, 0.36, rightSide ? 0.335 : 0.665, 0.085, rightSide, spec.accent);
			textOnSide(g, W, H, spec.reg, 0.86, rightSide ? 0.205 : 0.795, 0.035, rightSide, '#334');
		}
		// cockpit windows
		g.fillStyle = '#121a24';
		for (const side of [1, -1]) {
			for (let k = 0; k < 3; k++) {
				const u = 0.5 + side * (0.035 + k * 0.06);
				const x0 = sOf(-18.55 + k * 0.42) * W;
				g.beginPath();
				g.moveTo(x0, (1 - u) * H - 22); g.lineTo(x0 + 30, (1 - u) * H - 22); g.lineTo(x0 + 34, (1 - u) * H + 20); g.lineTo(x0 + 4, (1 - u) * H + 20);
				g.fill();
			}
		}
		// radome
		g.fillStyle = 'rgba(40,45,52,0.9)'; g.fillRect(0, 0, sOf(-19.1) * W, H);
	}, { frames, stringers: [0.1, 0.35, 0.5, 0.65, 0.9], hatches: 24, lineAlpha: 0.1 }, (a, r, W2, H2) => {
		const gr = a.createLinearGradient(0, 0, 0, H2);
		gr.addColorStop(0, 'rgba(60,55,45,0.12)'); gr.addColorStop(0.15, 'rgba(60,55,45,0)'); gr.addColorStop(0.85, 'rgba(60,55,45,0)'); gr.addColorStop(1, 'rgba(60,55,45,0.12)');
		a.fillStyle = gr; a.fillRect(0, 0, W2, H2);
	}, 61, 1.8);
}

function fanTexture() {
	const c = makeCanvas(256, 256), g = c.getContext('2d');
	g.fillStyle = '#16191d'; g.fillRect(0, 0, 256, 256);
	g.translate(128, 128);
	for (let i = 0; i < 22; i++) {
		g.rotate(Math.PI * 2 / 22);
		const gr = g.createLinearGradient(0, 0, 120, 0);
		gr.addColorStop(0, '#6b7178'); gr.addColorStop(1, '#3a3f45');
		g.fillStyle = gr;
		g.beginPath(); g.moveTo(18, -3); g.quadraticCurveTo(70, -14, 124, -10); g.lineTo(124, 4); g.quadraticCurveTo(70, 2, 18, 5); g.fill();
	}
	const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
	return t;
}

// Inside-the-cockpit shell with window cut-outs (seen only from the pilot's seat).
function cockpitShell(eye) {
	const W = 1024, H = 512;
	const c = makeCanvas(W, H), g = c.getContext('2d');
	g.fillStyle = '#2b2f34'; g.fillRect(0, 0, W, H);
	const P = (yawDeg, elDeg) => [(0.75 - yawDeg / 360) * W, (0.5 - elDeg / 180) * H];
	const hole = (pts) => { g.beginPath(); pts.forEach((p, i) => { const q = P(p[0], p[1]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.closePath(); g.fill(); };
	g.globalCompositeOperation = 'destination-out';
	g.fillStyle = '#000';
	// captain seat: centre post slightly right of the eye
	hole([[-36, -9], [4, -9], [5, 17], [-30, 15]]);
	hole([[9, -9], [44, -8], [38, 14], [10, 17]]);
	hole([[-74, -6], [-41, -8], [-36, 13], [-70, 11]]);
	hole([[48, -7], [78, -5], [74, 11], [44, 13]]);
	hole([[-112, -3], [-80, -5], [-77, 9], [-108, 8]]);
	hole([[84, -4], [110, -2], [107, 8], [81, 9]]);
	g.globalCompositeOperation = 'source-over';
	const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
	const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.BackSide, roughness: 0.85 });
	const m = new THREE.Mesh(new THREE.SphereGeometry(1.1, 48, 24), mat);
	m.position.set(eye[0], eye[1], eye[2]);
	m.renderOrder = 1;
	return m;
}

function buildAirliner(cfg) {
	const spec = AIRLINER[cfg.id];
	const root = new THREE.Group();
	const M = common();
	const zMin = spec.fus[0][0], zMax = spec.fus[spec.fus.length - 1][0];
	const paint = skinMat(airlinerLivery(spec, zMin, zMax), { metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08 });
	const wingSkin = plainSkin('#c9ced4', 0.4, WING, 71, 1024, 512, (g, W, H) => {
		// walkway outline and anti-slip area near the root
		g.strokeStyle = 'rgba(40,40,40,0.5)'; g.lineWidth = 3; g.strokeRect(0.03 * W, 0.3 * H, 0.22 * W, 0.35 * H);
	});
	const wingMat = skinMat(wingSkin, { metalness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.3, side: THREE.DoubleSide });
	const tailSkin = plainSkin(spec.accent, 0.3, TAIL, 73, 1024, 512, (g, W, H) => {
		// airline emblem on the fin
		g.fillStyle = spec.accent2;
		g.beginPath(); g.arc(0.5 * W, 0.42 * H, 0.18 * H, 0, Math.PI * 2); g.fill();
		g.fillStyle = spec.accent;
		g.beginPath(); g.moveTo(0.5 * W - 0.12 * H, 0.42 * H); g.lineTo(0.5 * W + 0.13 * H, 0.32 * H); g.lineTo(0.5 * W + 0.02 * H, 0.47 * H); g.fill();
	});
	const tailMat = skinMat(tailSkin, { clearcoat: 1, clearcoatRoughness: 0.1, side: THREE.DoubleSide });
	const stabMat = skinMat(plainSkin('#d2d6db', 0.4, TAIL, 79, 512, 256), { metalness: 0.4, clearcoat: 0.4, side: THREE.DoubleSide });
	const nacMat = new THREE.MeshPhysicalMaterial({ color: spec.accent, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
	const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.95 });
	const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d21, roughness: 0.6, side: THREE.DoubleSide });

	root.add(new THREE.Mesh(loft(spec.fus, 56, 6), paint));
	const fr = spec.fairing;
	const fairing = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshPhysicalMaterial({ color: 0xdde0e4, roughness: 0.35, clearcoat: 0.6 }));
	fairing.scale.set(fr[3], fr[4], fr[5]); fairing.position.set(fr[0], fr[1], fr[2]);
	root.add(fairing);

	const surfaces = {};
	const w = spec.wing;
	const lights = { strobe: new THREE.MeshBasicMaterial({ color: 0x000000 }), beacon: new THREE.MeshBasicMaterial({ color: 0x000000 }) };
	for (const side of [1, -1]) {
		const k = side > 0 ? 'R' : 'L';
		root.add(new THREE.Mesh(wingPanel(w, 0, 1, 0.1, 0.72, side, 12, 12), wingMat));
		root.add(new THREE.Mesh(wingPanel(w, 0, 0.12, 0, 0.1, side, 2, 6), wingMat));
		root.add(new THREE.Mesh(wingPanel(w, 0.6, 0.64, 0.72, 1, side, 1, 4), wingMat));
		root.add(new THREE.Mesh(wingPanel(w, 0.92, 1, 0.72, 1, side, 1, 4), wingMat));
		surfaces['slat' + k] = controlSurface(w, 0.12, 0.98, 0, 0.1, side, metal, 0.1);
		surfaces['flap' + k] = controlSurface(w, 0.0, 0.6, 0.72, 1, side, wingMat);
		surfaces['ail' + k] = controlSurface(w, 0.64, 0.92, 0.74, 1, side, wingMat);
		surfaces['spoil' + k] = controlSurface(w, 0.3, 0.6, 0.6, 0.72, side, wingMat);
		root.add(surfaces['slat' + k], surfaces['flap' + k], surfaces['ail' + k], surfaces['spoil' + k]);
		// winglets
		const tip = wingPoint(w, 1, 0, true, side);
		const tipChord = w.tip;
		const up = new THREE.Mesh(wingPanel({ x: 0, y: 0, z: 0, root: tipChord, tip: 0.42, span: spec.winglet === 'split' ? 2.6 : 2.45, sweep: 42, t: 0.08, vertical: true }, 0, 1, 0, 1, side, 4, 8), tailMat);
		up.position.copy(tip); up.rotation.z = -side * (spec.winglet === 'split' ? 0.24 : 0.32);
		root.add(up);
		if (spec.winglet === 'split') {
			const lo = new THREE.Mesh(wingPanel({ x: 0, y: 0, z: 0, root: tipChord * 0.7, tip: 0.35, span: 0.95, sweep: 40, t: 0.08, vertical: true }, 0, 1, 0, 1, side, 2, 6), tailMat);
			lo.position.copy(tip).add(new THREE.Vector3(0, 0, 0.25)); lo.rotation.z = side * (Math.PI - 0.75);
			root.add(lo);
		}
		// nav light + strobe at the tip
		const nl = navLight(side > 0 ? 0x00ff40 : 0xff1010, 12);
		nl.position.copy(wingPoint(w, 1, 0.05, true, side)).add(new THREE.Vector3(side * 0.05, -0.05, 0));
		root.add(nl);
		surfaces['nav' + k] = nl;
		const st = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), lights.strobe);
		st.position.copy(wingPoint(w, 1, 0.9, true, side));
		root.add(st);
		// engine: nacelle, fan, spinner, core, pylon
		const e = spec.eng;
		const wingAt = (e.x - w.x) / w.span;
		const zLEe = w.z + (e.x - w.x) * Math.tan(w.sweep * Math.PI / 180);
		const z0 = zLEe - e.ahead;
		const nac = new THREE.Mesh(loft([
			[0, e.r * 0.9, e.r * 0.9, e.r * 0.9, 0, 2], [0.3, e.r, e.r, e.r, 0, 2], [e.len * 0.5, e.r * 0.99, e.r * 0.99, e.r * 0.99, 0, 2],
			[e.len * 0.85, e.r * 0.8, e.r * 0.8, e.r * 0.8, 0, 2], [e.len, e.r * 0.62, e.r * 0.62, e.r * 0.62, 0, 2],
		], 40, 5, false), nacMat);
		nac.position.set(side * e.x, e.y, z0);
		root.add(nac);
		const lip = new THREE.Mesh(new THREE.TorusGeometry(e.r * 0.9, e.r * 0.07, 10, 40), metal);
		lip.position.set(side * e.x, e.y, z0);
		root.add(lip);
		const inlet = new THREE.Mesh(new THREE.CylinderGeometry(e.r * 0.86, e.r * 0.86, 0.7, 40, 1, true), dark);
		inlet.rotation.x = Math.PI / 2; inlet.position.set(side * e.x, e.y, z0 + 0.35);
		root.add(inlet);
		const fan = new THREE.Mesh(new THREE.CircleGeometry(e.r * 0.86, 40), new THREE.MeshStandardMaterial({ map: fanTexture(), roughness: 0.4, metalness: 0.7 }));
		fan.position.set(side * e.x, e.y, z0 + 0.7); fan.rotation.y = Math.PI;
		root.add(fan);
		surfaces['fan' + k] = fan;
		const spinner = new THREE.Mesh(new THREE.ConeGeometry(e.r * 0.26, e.r * 0.55, 24), new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.3, metalness: 0.6 }));
		spinner.rotation.x = -Math.PI / 2; spinner.position.set(side * e.x, e.y, z0 + 0.45);
		root.add(spinner);
		const core = new THREE.Mesh(new THREE.CylinderGeometry(e.r * 0.42, e.r * 0.55, 1.2, 28, 1, true), metal);
		core.rotation.x = Math.PI / 2; core.position.set(side * e.x, e.y, z0 + e.len + 0.55);
		const plug = new THREE.Mesh(new THREE.ConeGeometry(e.r * 0.28, 0.9, 20), dark);
		plug.rotation.x = Math.PI / 2; plug.position.set(side * e.x, e.y, z0 + e.len + 1.35);
		root.add(core, plug);
		if (e.chevrons) {
			const cg = new THREE.CylinderGeometry(e.r * 0.62, e.r * 0.64, 0.4, 28, 1, true);
			const cp = cg.attributes.position;
			for (let i = 0; i < cp.count; i++) {
				if (cp.getY(i) < 0) { const a = Math.atan2(cp.getZ(i), cp.getX(i)); const tooth = Math.round(a / (Math.PI * 2) * 28) % 2 === 0; cp.setY(i, tooth ? -0.45 : -0.2); cp.setX(i, cp.getX(i) * (tooth ? 0.9 : 1)); cp.setZ(i, cp.getZ(i) * (tooth ? 0.9 : 1)); }
			}
			cg.computeVertexNormals();
			const chev = new THREE.Mesh(cg, nacMat);
			chev.rotation.x = -Math.PI / 2; chev.position.set(side * e.x, e.y, z0 + e.len + 0.15);
			root.add(chev);
		}
		const wy = wingPoint(w, Math.max(0, wingAt), 0.3, false, side).y;
		const ph = Math.max(0.3, wy - (e.y + e.r * 0.8));
		const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.32, ph + 0.4, e.len * 0.95), stabMat);
		pylon.position.set(side * e.x, e.y + e.r * 0.8 + ph / 2 - 0.1, z0 + e.len * 0.55);
		root.add(pylon);
		// horizontal stabiliser + elevator
		root.add(new THREE.Mesh(wingPanel(spec.ht, 0, 1, 0, 0.7, side, 5, 10), stabMat));
		surfaces['elev' + k] = controlSurface(spec.ht, 0.05, 1, 0.7, 1, side, stabMat);
		root.add(surfaces['elev' + k]);
	}
	root.add(new THREE.Mesh(wingPanel(spec.vt, 0, 1, 0, 0.7, 1, 6, 12), tailMat));
	root.add(new THREE.Mesh(wingPanel(spec.dorsal, 0, 1, 0, 1, 1, 2, 6), tailMat));
	surfaces.rudder = controlSurface(spec.vt, 0.03, 0.95, 0.7, 1, 1, tailMat);
	root.add(surfaces.rudder);
	// beacons (top and bottom) and tail strobe share materials so they flash together
	for (const [y, z] of [[spec.fus[5][3] + 0.05, -2], [-spec.fus[5][3] - 0.05, 0]]) {
		const b = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), lights.beacon); b.position.set(0, y, z); root.add(b);
	}
	const ts = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), lights.strobe); ts.position.set(0, spec.fus[9][4], zMax + 0.05); root.add(ts);
	surfaces.strobe = { material: lights.strobe };
	surfaces.beacon = { material: lights.beacon };

	// retractable twin-wheel gear
	const gear = [];
	cfg.gear.forEach((gd, i) => {
		const isNose = i === 0;
		const t0 = isNose ? spec.gearTop.nose : [Math.sign(gd.p[0]) * spec.gearTop.main[0], spec.gearTop.main[1], spec.gearTop.main[2]];
		const top = new THREE.Vector3(...t0);
		const pivot = new THREE.Group();
		pivot.position.copy(top);
		const wc = new THREE.Vector3(gd.p[0], gd.p[1] + gd.r, gd.p[2]).sub(top);
		const strut = new THREE.Mesh(new THREE.CylinderGeometry(isNose ? 0.09 : 0.14, isNose ? 0.1 : 0.16, wc.length() + 0.2, 12), M.strutMat);
		strut.position.copy(wc).multiplyScalar(0.5); strut.lookAt(wc); strut.rotateX(Math.PI / 2);
		const wheels = new THREE.Group();
		for (const dx of [-1, 1]) { const wh = wheel(gd.r, isNose ? 0.22 : 0.33, M.tireMat, M.hubMat); wh.position.x = dx * (isNose ? 0.2 : 0.42); wheels.add(wh); }
		const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, isNose ? 0.45 : 0.9, 8), M.strutMat); axle.rotation.z = Math.PI / 2; wheels.add(axle);
		wheels.position.copy(wc);
		pivot.add(strut, wheels);
		root.add(pivot);
		gear.push({ grp: pivot, wheel: wheels, base: wheels.position.clone(), strut, retractAxis: isNose ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, gd.p[0] > 0 ? 1 : -1), retractAngle: isNose ? -1.6 : 1.55 });
	});

	const cockpit = buildCockpit(cfg.eye, 1.4, 0x2d3034);
	cockpit.position.x = cfg.eye[0];
	const shell = cockpitShell(cfg.eye);
	cockpit.add(shell);
	shell.position.x -= cfg.eye[0];
	const pilot = buildPilot(cfg.eye, 0x222a3a);
	root.add(cockpit, pilot);
	finalize(root);
	return { root, surfaces, gear, canopy: null, cockpit, pilot, type: 'airliner', shell };
}
