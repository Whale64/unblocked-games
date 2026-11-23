// Detailed procedural cockpit interiors (airliner flight decks, fighter, piston trainer) and an
// airliner passenger cabin. Everything is built from primitives plus canvas-painted panels:
// paint grain, engraved labels with integral (night) lighting, screws, pushbuttons and switches,
// with live avionics mounted into bezels.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createAvionics } from './instruments.js';

// Shared interior lighting: inside a cabin the sun is mostly blocked by the airframe, and the
// walls are lit by bounce light from the windows. Updated every frame by the game.
export const interiorLight = { uBounce: { value: 0.3 }, uSunK: { value: 0.5 } };

const FONT = 'Inter, "Segoe UI", Arial, sans-serif';

function imat(color, rough = 0.7, metal = 0, extra = {}) {
	const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
	m.onBeforeCompile = (sh) => {
		sh.uniforms.uBounce = interiorLight.uBounce;
		sh.uniforms.uSunK = interiorLight.uSunK;
		sh.fragmentShader = sh.fragmentShader
			.replace('#include <common>', '#include <common>\nuniform float uBounce;\nuniform float uSunK;')
			.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
				reflectedLight.directDiffuse *= uSunK;
				reflectedLight.directSpecular *= uSunK;
				reflectedLight.indirectDiffuse += diffuseColor.rgb * uBounce;`);
	};
	m.customProgramCacheKey = () => 'interior';
	m.userData.interior = true;
	return m;
}

function canvas(W, H) { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; }
function rnd(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

function bumpToNormal(bump, strength = 2) {
	const W = bump.width, H = bump.height;
	const src = bump.getContext('2d').getImageData(0, 0, W, H).data;
	const out = canvas(W, H), og = out.getContext('2d');
	const img = og.createImageData(W, H);
	const h = (x, y) => src[((Math.min(H - 1, Math.max(0, y))) * W + Math.min(W - 1, Math.max(0, x))) * 4] / 255;
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
		let nx = -dx * strength, ny = dy * strength;
		const l = Math.hypot(nx, ny, 1);
		const o = (y * W + x) * 4;
		img.data[o] = (nx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
	}
	og.putImageData(img, 0, 0);
	const t = new THREE.CanvasTexture(out); t.anisotropy = 8;
	return t;
}

// A painted panel: colour, emissive (backlit labels / captions) and bump canvases drawn together.
// draw(P) gets a painter with helpers that write to all three layers consistently.
function paintedPanel(W, H, base, draw, { seed = 1, rough = 0.62, metal = 0, bumpK = 2.2, glow, side } = {}) {
	const cc = canvas(W, H), ec = canvas(W, H), bc = canvas(W, H);
	const g = cc.getContext('2d'), e = ec.getContext('2d'), b = bc.getContext('2d');
	g.fillStyle = base; g.fillRect(0, 0, W, H);
	e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
	b.fillStyle = '#808080'; b.fillRect(0, 0, W, H);
	// paint grain + gentle wear
	const r = rnd(seed);
	for (let i = 0; i < W * H / 60; i++) {
		const x = r() * W, y = r() * H, a = r() * 0.05;
		g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
		g.fillRect(x, y, 1 + r() * 2, 1 + r() * 2);
	}
	const P = {
		g, e, b, W, H, r,
		// recess / raised area: dark fill + bevel in the bump map
		rect(x, y, w, h, col, depth = -1, rad = 4) {
			if (col) { g.fillStyle = col; rr(g, x, y, w, h, rad); g.fill(); }
			b.fillStyle = depth < 0 ? '#5a5a5a' : '#b0b0b0'; rr(b, x, y, w, h, rad); b.fill();
			b.strokeStyle = depth < 0 ? '#3a3a3a' : '#d8d8d8'; b.lineWidth = 2; rr(b, x, y, w, h, rad); b.stroke();
		},
		label(s, x, y, size = 14, col = '#eef2f4', align = 'center', weight = 700, lit = true) {
			for (const [ctx, c] of [[g, col], ...(lit ? [[e, '#fff6dc']] : [])]) {
				ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
				ctx.fillStyle = c; ctx.fillText(s, x, y);
			}
		},
		line(x0, y0, x1, y1, col = '#e9edf0', w = 2, lit = true) {
			for (const [ctx, c] of [[g, col], ...(lit ? [[e, '#fff6dc']] : [])]) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
		},
		screw(x, y, s = 5) {
			const gr = g.createRadialGradient(x - s * 0.3, y - s * 0.3, 0.5, x, y, s);
			gr.addColorStop(0, '#c9ced3'); gr.addColorStop(1, '#4c5157');
			g.fillStyle = gr; g.beginPath(); g.arc(x, y, s, 0, 7); g.fill();
			g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x - s * 0.7, y); g.lineTo(x + s * 0.7, y); g.stroke();
			b.fillStyle = '#b8b8b8'; b.beginPath(); b.arc(x, y, s, 0, 7); b.fill();
		},
		knob(x, y, s = 14, col = '#22262a') {
			g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(x + 2, y + 3, s * 1.05, 0, 7); g.fill();
			const gr = g.createRadialGradient(x - s * 0.35, y - s * 0.35, 1, x, y, s);
			gr.addColorStop(0, '#5f656c'); gr.addColorStop(1, col);
			g.fillStyle = gr; g.beginPath(); g.arc(x, y, s, 0, 7); g.fill();
			g.strokeStyle = '#eef2f4'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y - s * 0.2); g.lineTo(x, y - s * 0.85); g.stroke();
			b.fillStyle = '#e0e0e0'; b.beginPath(); b.arc(x, y, s, 0, 7); b.fill();
		},
		// Airbus-style square pushbutton: dark cap, captions lit at night, optional lit legend
		pb(x, y, w, h, top = '', bottom = 'ON', lit = null) {
			g.fillStyle = '#1b1f23'; rr(g, x, y, w, h, 3); g.fill();
			g.fillStyle = '#2d3338'; rr(g, x + 2, y + 2, w - 4, h * 0.45, 2); g.fill();
			b.fillStyle = '#c8c8c8'; rr(b, x, y, w, h, 3); b.fill();
			if (top) { g.font = `700 ${h * 0.24}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = lit === 'fault' ? '#ffb02e' : 'rgba(255,176,46,0.22)'; g.fillText(top, x + w / 2, y + h * 0.27); if (lit === 'fault') { e.font = g.font; e.textAlign = 'center'; e.fillStyle = '#ffb02e'; e.fillText(top, x + w / 2, y + h * 0.27); } }
			if (bottom) { g.font = `700 ${h * 0.24}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = lit === 'on' ? '#e8f4ff' : lit === 'blue' ? '#4fc3ff' : 'rgba(230,240,250,0.22)'; g.fillText(bottom, x + w / 2, y + h * 0.72); if (lit) { e.font = g.font; e.textAlign = 'center'; e.fillStyle = lit === 'blue' ? '#4fc3ff' : '#e8f4ff'; e.fillText(bottom, x + w / 2, y + h * 0.72); } }
		},
		// toggle switch seen from the front
		toggle(x, y, s = 8, up = true) {
			g.fillStyle = '#9da3a9'; g.beginPath(); g.arc(x, y, s, 0, 7); g.fill();
			g.fillStyle = '#2a2e33'; g.beginPath(); g.arc(x, y, s * 0.55, 0, 7); g.fill();
			const gr = g.createLinearGradient(x - 3, 0, x + 3, 0); gr.addColorStop(0, '#f0f2f4'); gr.addColorStop(1, '#8c9298');
			g.fillStyle = gr; rr(g, x - s * 0.35, up ? y - s * 1.9 : y, s * 0.7, s * 1.9, s * 0.3); g.fill();
			b.fillStyle = '#ffffff'; rr(b, x - s * 0.35, up ? y - s * 1.9 : y, s * 0.7, s * 1.9, s * 0.3); b.fill();
		},
		annun(x, y, w, h, s, col, on = false) {
			g.fillStyle = '#121416'; rr(g, x, y, w, h, 2); g.fill();
			g.font = `700 ${h * 0.42}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
			g.fillStyle = on ? col : 'rgba(120,120,120,0.35)'; g.fillText(s, x + w / 2, y + h / 2);
			if (on) { e.font = g.font; e.textAlign = 'center'; e.textBaseline = 'middle'; e.fillStyle = col; e.fillText(s, x + w / 2, y + h / 2); }
		},
	};
	draw(P);
	const map = new THREE.CanvasTexture(cc); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
	const emap = new THREE.CanvasTexture(ec); emap.colorSpace = THREE.SRGBColorSpace;
	const m = imat(0xffffff, rough, metal, { map, emissiveMap: emap, emissive: new THREE.Color(1, 0.93, 0.8), emissiveIntensity: 0, normalMap: bumpToNormal(bc, bumpK), side: side || THREE.FrontSide });
	if (glow) glow.push(m);
	return m;
}

function rr(ctx, x, y, w, h, r) {
	ctx.beginPath();
	if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}

const rbox = (w, h, d, r = 0.01, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * 0.99);

function add(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
	const m = new THREE.Mesh(geo, mat);
	m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
	parent.add(m);
	return m;
}

// Panel box whose +z face carries a painted texture (other faces use the plain material).
function facePanel(w, h, d, faceMat, sideMat, r = 0.006) {
	const grp = new THREE.Group();
	add(grp, rbox(w, h, d, r), sideMat);
	const face = add(grp, new THREE.PlaneGeometry(w - r * 1.2, h - r * 1.2), faceMat, 0, 0, d / 2 + 0.0008);
	grp.userData.face = face;
	return grp;
}

// Surface patch spanned by four corners (bilinear) with holes, extruded by `thick` along its normal.
// shape/holes are in normalized (u, v) space.
function patchFrame(c00, c10, c01, c11, holes, thick, mat, curveSegs = 10, inside = null) {
	const outer = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 1), new THREE.Vector2(0, 1)]);
	for (const h of holes) outer.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, v))));
	const geo = new THREE.ExtrudeGeometry(outer, { depth: 1, bevelEnabled: false, curveSegments: curveSegs });
	const p = geo.attributes.position;
	const A = new THREE.Vector3(), B = new THREE.Vector3(), n = new THREE.Vector3();
	n.subVectors(c10, c00).cross(new THREE.Vector3().subVectors(c01, c00)).normalize();
	// extrude away from `inside` (the depth of the frame goes out through the skin, not into the room)
	if (inside && n.dot(new THREE.Vector3().subVectors(inside, c00)) < 0) n.negate();
	for (let i = 0; i < p.count; i++) {
		const u = p.getX(i), v = p.getY(i), w = p.getZ(i);
		A.copy(c00).lerp(c10, u); B.copy(c01).lerp(c11, u);
		A.lerp(B, v).addScaledVector(n, -w * thick);
		p.setXYZ(i, A.x, A.y, A.z);
	}
	geo.computeVertexNormals();
	return new THREE.Mesh(geo, mat);
}

// Rounded window outline in (u, v): corners inset with radius r.
function winPath(u0, v0, u1, v1, r = 0.08, rTop = r) {
	const pts = [];
	const arc = (cx, cy, rad, a0, a1) => { for (let i = 0; i <= 5; i++) { const a = a0 + (a1 - a0) * i / 5; pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]); } };
	arc(u0 + r, v0 + r, r, Math.PI, Math.PI * 1.5);
	arc(u1 - r, v0 + r, r, Math.PI * 1.5, Math.PI * 2);
	arc(u1 - rTop, v1 - rTop, rTop, 0, Math.PI * 0.5);
	arc(u0 + rTop, v1 - rTop, rTop, Math.PI * 0.5, Math.PI);
	return pts;
}

function glassPatch(c00, c10, c01, c11) {
	const geo = new THREE.BufferGeometry().setFromPoints([c00, c10, c11, c00, c11, c01]);
	geo.computeVertexNormals();
	const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
		color: 0xbfd8e6, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false,
		clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.4,
	}));
	m.renderOrder = 3;
	return m;
}

// Seated human facing -z (first officer / passengers). Proportions for a seated adult.
function person(shirt, trousers, skin, hair, opts = {}) {
	const g = new THREE.Group();
	const sh = imat(shirt, 0.85), tr = imat(trousers, 0.85), sk = imat(skin, 0.55), hr = imat(hair, 0.9);
	const limb = (mat, r, a, b) => {
		// capsule between two points
		const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
		const len = A.distanceTo(B);
		const m = add(g, new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 2 + r), 4, 10), mat);
		m.position.copy(A).add(B).multiplyScalar(0.5);
		m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
		return m;
	};
	// torso (slightly reclined), shoulders, hips
	const torso = add(g, new THREE.CapsuleGeometry(0.15, 0.32, 6, 14), sh, 0, 0.44, 0.03, -0.1);
	torso.scale.set(1.05, 1, 0.68);
	add(g, rbox(0.38, 0.12, 0.22, 0.05, 3), sh, 0, 0.62, 0.04, -0.1);
	add(g, rbox(0.34, 0.14, 0.26, 0.06, 3), tr, 0, 0.12, 0.02);
	// neck, head, hair, ears, nose
	add(g, new THREE.CylinderGeometry(0.048, 0.055, 0.1, 12), sk, 0, 0.72, 0.03);
	const head = add(g, new THREE.SphereGeometry(0.1, 20, 16), sk, 0, 0.86, 0.01);
	head.scale.set(0.82, 1.1, 0.95);
	const hc = add(g, new THREE.SphereGeometry(0.104, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), hr, 0, 0.875, 0.025, -0.25);
	hc.scale.set(0.86, 1.08, 1.0);
	for (const s of [-1, 1]) add(g, new THREE.SphereGeometry(0.022, 8, 6), sk, s * 0.083, 0.855, 0.02).scale.set(0.5, 1, 0.8);
	add(g, new THREE.ConeGeometry(0.014, 0.035, 8), sk, 0, 0.855, -0.088, -Math.PI / 2);
	// collar and tie
	if (opts.tie) {
		add(g, new THREE.ConeGeometry(0.03, 0.26, 4), imat(opts.tie, 0.6), 0, 0.53, -0.075, Math.PI + 0.1).scale.set(1, 1, 0.3);
		for (const s of [-1, 1]) add(g, new THREE.BoxGeometry(0.05, 0.03, 0.01), sh, s * 0.03, 0.68, -0.055, 0.2, 0, s * 0.5);
	}
	// legs: thighs forward, shins down to the floor
	for (const s of [-1, 1]) {
		limb(tr, 0.072, [s * 0.1, 0.12, 0.0], [s * 0.11, 0.15, -0.42]);
		limb(tr, 0.058, [s * 0.11, 0.15, -0.42], [s * 0.12, -0.3, -0.5]);
		add(g, rbox(0.1, 0.07, 0.26, 0.03), imat(0x111111, 0.5), s * 0.12, -0.33, -0.58);
	}
	// arms: upper arms down the sides, forearms forward to the lap / controls, hands
	const pose = opts.pose || 'lap';
	for (const s of [-1, 1]) {
		const shoulder = [s * 0.19, 0.6, 0.05], elbow = [s * 0.22, 0.34, -0.02];
		const hand = pose === 'controls' ? [s * 0.2, 0.32, -0.36] : pose === 'armrest' ? [s * 0.24, 0.26, -0.3] : [s * 0.12, 0.2, -0.3];
		limb(sh, 0.052, shoulder, elbow);
		limb(opts.shortSleeve ? sk : sh, 0.044, elbow, hand);
		add(g, new THREE.SphereGeometry(0.038, 10, 8), sk, ...hand).scale.set(0.8, 0.6, 1.2);
	}
	if (opts.headset) {
		const hs = imat(0x1a1c1e, 0.5);
		add(g, new THREE.TorusGeometry(0.102, 0.011, 6, 20, Math.PI), hs, 0, 0.87, 0.01, 0, Math.PI / 2, 0);
		for (const s of [-1, 1]) add(g, new THREE.CylinderGeometry(0.042, 0.042, 0.03, 14), hs, s * 0.092, 0.85, 0.02, 0, 0, Math.PI / 2);
		add(g, new THREE.CylinderGeometry(0.004, 0.004, 0.12, 6), hs, -0.07, 0.82, -0.04, 0.3, 0, 1.1);
	}
	if (opts.epaulettes) {
		const ep = imat(0x111111, 0.6), gold = imat(0xc9a43a, 0.35, 0.8);
		for (const s of [-1, 1]) { add(g, new THREE.BoxGeometry(0.09, 0.012, 0.05), ep, s * 0.15, 0.685, 0.04); for (let k = 0; k < 3; k++) add(g, new THREE.BoxGeometry(0.012, 0.013, 0.048), gold, s * 0.15 + (k - 1) * 0.018, 0.686, 0.04); }
	}
	return g;
}

function seat(cushion, frame, opts = {}) {
	const g = new THREE.Group();
	const w = opts.w || 0.5;
	add(g, rbox(w, 0.12, 0.5, 0.05, 3), cushion, 0, 0, 0); // pan
	const back = add(g, rbox(w * 0.96, 0.75, 0.13, 0.05, 3), cushion, 0, 0.42, 0.24, -0.12);
	if (opts.headrest !== false) add(g, rbox(w * 0.6, 0.2, 0.12, 0.05, 3), cushion, 0, 0.9, 0.33, -0.12);
	if (opts.arms) for (const s of [-1, 1]) add(g, rbox(0.06, 0.06, 0.38, 0.02), frame, s * (w / 2 + 0.03), 0.2, 0.02);
	add(g, new THREE.CylinderGeometry(0.05, 0.07, 0.4, 10), frame, 0, -0.25, 0.05);
	g.userData.back = back;
	return g;
}

function quad(c00, c10, c01, c11, mat) {
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute([...c00.toArray(), ...c10.toArray(), ...c01.toArray(), ...c11.toArray()], 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
	geo.setIndex([0, 1, 3, 0, 3, 2]);
	geo.computeVertexNormals();
	return new THREE.Mesh(geo, mat);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const hex = (s) => new THREE.Color(s).getHex();

function lever(armLen, armMat, handleGeo, handleMat) {
	const g = new THREE.Group();
	add(g, new THREE.BoxGeometry(0.018, armLen, 0.018), armMat, 0, armLen / 2, 0);
	const h = add(g, handleGeo, handleMat, 0, armLen, 0);
	g.userData.handle = h;
	return g;
}

// ================================================================ airliner flight deck
export function buildAirlinerDeck(cfg, withAvionics = true) {
	const airbus = !!cfg.fbw;
	const E = cfg.eye, cx = -E[0];
	const root = new THREE.Group();
	root.position.set(E[0], E[1], E[2]);
	const glow = [];
	const C = airbus
		? { panel: '#5a6772', glare: '#2b3034', over: '#5f6b75', wall: '#7c868e', floor: '#2a2d32', seat: 0x2f343b, trim: '#3c434a', sheep: 0xbdb7aa }
		: { panel: '#5c6065', glare: '#28292c', over: '#61656a', wall: '#86847f', floor: '#2d2a28', seat: 0x3b3431, trim: '#45484c', sheep: 0x8a7a68 };
	const plainPanel = imat(hex(C.panel), 0.65);
	const plainGlare = imat(hex(C.glare), 0.9);
	const trimMat = imat(hex(C.trim), 0.6);
	const blackMat = imat(0x15171a, 0.55);
	const metalMat = imat(0xb5bac0, 0.3, 0.85);
	const wallMat = paintedPanel(256, 256, C.wall, (P) => {
		// fabric-like liner with faint quilting
		for (let i = 0; i < 1200; i++) { P.g.fillStyle = `rgba(0,0,0,${P.r() * 0.05})`; P.g.fillRect(P.r() * 256, P.r() * 256, 2, 2); }
	}, { rough: 0.95, side: THREE.DoubleSide });
	const frameMat = imat(new THREE.Color(C.wall).multiplyScalar(0.8).getHex(), 0.7, 0, { side: THREE.DoubleSide });
	const PX = 1004; // canvas pixels per metre on the main panel

	// ---------------------------------------------------------- main instrument panel
	const PW = 2.04, PH = 0.42;
	const dW = airbus ? 0.2 : 0.235, dH = airbus ? 0.2 : 0.19;
	const off = airbus ? [0.12, 0.13] : [0.14, 0.125];
	const D = { cpfd: -cx - off[0], cnd: -cx + off[1], ctr: 0, fnd: cx - off[1], fpfd: cx + off[0], isis: -0.21, gear: 0.21 };
	const X = (x) => (x + PW / 2) * PX, Y = (y) => (PH / 2 - y) * PX;
	const panelFace = paintedPanel(2048, 422, C.panel, (P) => {
		const recess = (x, y, w, h) => {
			P.rect(X(x - w / 2) - 14, Y(y + h / 2) - 14, (w * PX) + 28, (h * PX) + 28, '#1a1d20', -1, 10);
			// bezel push-buttons and brightness knob
			for (let k = 0; k < 2; k++) P.knob(X(x + w / 2) - 10 - k * 34, Y(y - h / 2) + 30, 10);
			P.label(airbus ? 'BRT' : 'DSPL', X(x - w / 2) + 20, Y(y - h / 2) + 30, 11);
		};
		for (const k of ['cpfd', 'cnd', 'ctr', 'fnd', 'fpfd']) recess(D[k], 0.025, dW, dH);
		// standby instrument
		P.rect(X(D.isis - 0.05), Y(0.075), 0.1 * PX, 0.1 * PX, '#141619', -1, 8);
		P.label(airbus ? 'ISIS' : 'ISFD', X(D.isis), Y(-0.045), 11);
		// landing gear panel
		P.rect(X(D.gear - 0.055), Y(0.12), 0.11 * PX, 0.27 * PX, '#40474e', 1, 6);
		P.label('LDG GEAR', X(D.gear), Y(0.105), 13);
		P.label('UP', X(D.gear) + 34, Y(0.07), 12); P.label('DOWN', X(D.gear) + 34, Y(-0.06), 12);
		for (let k = 0; k < 3; k++) P.annun(X(D.gear - 0.045) + k * 30, Y(-0.095), 26, 18, 'UNLK', '#ff3b30', false);
		// autobrake / chrono / clock
		if (airbus) { ['LO', 'MED', 'MAX'].forEach((s, k) => P.pb(X(D.gear - 0.05) + k * 37, Y(-0.165), 32, 28, 'DECEL', s)); P.label('AUTO/BRK', X(D.gear), Y(-0.13), 11); }
		else { P.knob(X(D.gear), Y(-0.16), 15); P.label('AUTO BRAKE', X(D.gear), Y(-0.125), 11); ['RTO', 'OFF', '1', '2', '3', 'MAX'].forEach((s, k) => P.label(s, X(D.gear) - 40 + k * 16, Y(-0.195), 9)); }
		P.knob(X(-0.1 - cx + 0.02), Y(-0.17), 12); P.label('CHRONO', X(-0.1 - cx + 0.02), Y(-0.14), 10);
		// clock
		const ckx = X(D.isis), cky = Y(-0.135);
		P.g.fillStyle = '#0d0f11'; P.g.beginPath(); P.g.arc(ckx, cky, 30, 0, 7); P.g.fill();
		P.g.strokeStyle = '#d8dde2'; P.g.lineWidth = 2; P.g.beginPath(); P.g.arc(ckx, cky, 26, 0, 7); P.g.stroke();
		for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; P.line(ckx + Math.sin(a) * 20, cky - Math.cos(a) * 20, ckx + Math.sin(a) * 25, cky - Math.cos(a) * 25, '#d8dde2', 2, false); }
		// panel joints and screws
		for (const xs of [-0.9, -0.29, 0.29, 0.9]) P.line(X(xs), 6, X(xs), 416, 'rgba(0,0,0,0.35)', 2, false);
		for (const xs of [-1.0, -0.94, -0.31, -0.27, 0.27, 0.31, 0.94, 1.0]) for (const ys of [0.19, -0.19]) P.screw(X(xs), Y(ys), 5);
		// placards
		P.label(airbus ? 'A320neo' : '737 MAX 8', X(cx + 0.33), Y(-0.17), 12, '#d8dde2');
		P.rect(X(-cx - 0.28), Y(-0.15), 120, 34, '#e9e4d2', 1, 2);
		P.label('MAX SPEED  VMO 350 / MMO .82', X(-cx - 0.28) + 60, Y(-0.15) + 17, 9, '#222', 'center', 700, false);
	}, { seed: 11, glow });
	const panel = facePanel(PW, PH, 0.06, panelFace, plainPanel);
	panel.position.set(cx, -0.48, -0.83);
	panel.rotation.x = -0.14;
	root.add(panel);
	// the lower lip of each display bezel casts a little depth
	for (const k of ['cpfd', 'cnd', 'ctr', 'fnd', 'fpfd']) {
		add(panel, rbox(dW + 0.03, 0.012, 0.02, 0.004), blackMat, D[k], 0.025 + dH / 2 + 0.012, 0.035);
	}
	// gear lever (wheel-shaped knob)
	const gearLever = new THREE.Group();
	gearLever.position.set(D.gear - 0.025, 0.02, 0.035);
	add(gearLever, new THREE.BoxGeometry(0.014, 0.09, 0.014), metalMat, 0, 0.045, 0);
	add(gearLever, new THREE.CylinderGeometry(0.022, 0.022, 0.018, 18), imat(0xe8e8e2, 0.5), 0, 0.09, 0, 0, 0, Math.PI / 2);
	panel.add(gearLever);

	// lower centre panel (lower ECAM / lower DU) sloping into the pedestal
	const lowerFace = paintedPanel(512, 256, C.panel, (P) => {
		P.rect(170, 26, 172, 172, '#16191c', -1, 8);
		P.label(airbus ? 'ECAM' : 'LOWER DU', 256, 220, 13);
		for (let k = 0; k < 5; k++) P.pb(30 + k * 0, 30 + k * 38, 60, 30, '', ['ENG', 'BLEED', 'HYD', 'ELEC', 'WHEEL'][k], k === 4 ? 'on' : null);
		for (let k = 0; k < 5; k++) P.pb(422, 30 + k * 38, 60, 30, '', ['APU', 'COND', 'DOOR', 'FUEL', 'STS'][k]);
	}, { seed: 12, glow });
	const lower = quad(V(cx - 0.19, -0.79, -0.6), V(cx + 0.19, -0.79, -0.6), V(cx - 0.19, -0.69, -0.79), V(cx + 0.19, -0.69, -0.79), lowerFace);
	root.add(lower);
	const lowerCentre = V(cx, -0.735, -0.69);
	const lowerTilt = Math.atan2(0.19, 0.1);

	// ---------------------------------------------------------- glareshield, FCU / MCP, EFIS panels
	add(root, rbox(2.18, 0.1, 0.36, 0.045, 3), plainGlare, cx, -0.23, -0.9);
	const fcuW = airbus ? 0.64 : 0.86;
	const fcu = new THREE.Group();
	add(fcu, rbox(fcuW + 0.02, 0.11, 0.08, 0.01), trimMat);
	fcu.position.set(cx, -0.262, -0.705);
	fcu.rotation.x = -0.32;
	root.add(fcu);
	const efisFace = paintedPanel(512, 192, C.trim, (P) => {
		P.label('QNH', 60, 22, 14); P.rect(20, 34, 80, 34, '#070808', -1, 3); P.label('1013', 60, 51, 22, '#ff9d2e', 'center', 700);
		P.knob(60, 120, 30);
		P.label(airbus ? 'LS' : 'MINS', 150, 30, 13); P.pb(125, 44, 50, 34, '', airbus ? 'LS' : 'RST');
		P.label('FD', 150, 108, 13); P.pb(125, 122, 50, 34, '', 'FD', 'on');
		['CSTR', 'WPT', 'VOR.D', 'NDB', 'ARPT'].forEach((s, k) => P.pb(200 + k * 58, 18, 50, 34, '', s, k === 1 ? 'on' : null));
		P.label('ROSE  ARC  NAV  PLAN', 300, 92, 12); P.knob(300, 140, 26);
		P.label('10 20 40 80 160 320', 430, 92, 11); P.knob(440, 140, 26);
	}, { seed: 13, glow });
	const efisW = 0.27, efisH = 0.1;
	for (const s of [-1, 1]) {
		const ef = facePanel(efisW, efisH, 0.07, efisFace, trimMat);
		ef.position.set(cx + s * (fcuW / 2 + efisW / 2 + 0.03), -0.262, -0.705);
		ef.rotation.x = -0.32;
		root.add(ef);
	}
	// master warning / caution and autoland lights at each glareshield end
	const warnFace = paintedPanel(256, 128, C.glare, (P) => {
		P.annun(12, 12, 108, 48, 'MASTER WARN', '#ff2d22', false); P.annun(136, 12, 108, 48, 'MASTER CAUT', '#ffb02e', false);
		P.annun(12, 70, 108, 46, airbus ? 'AUTO LAND' : 'A/P P/RST', '#ff2d22', false); P.pb(136, 70, 108, 46, '', airbus ? 'SIDE STICK' : 'A/T P/RST');
	}, { seed: 14, glow });
	for (const s of [-1, 1]) {
		const wf = facePanel(0.14, 0.07, 0.05, warnFace, plainGlare);
		wf.position.set(cx + s * 0.84, -0.255, -0.73);
		wf.rotation.x = -0.4;
		root.add(wf);
	}

	// ---------------------------------------------------------- windshield & side windows
	const yb = -0.175, yt = 0.36;
	const thick = 0.07;
	const frames = [];
	const front = (s) => {
		// s = -1 left pane, +1 right pane (corners in u-v order: outboard bottom, centre bottom, outboard top, centre top)
		const ob = V(cx + s * 0.98, yb, -0.84), cb = V(cx + s * 0.035, yb, -1.0), ot = V(cx + s * 0.84, yt, -0.5), ct = V(cx + s * 0.035, yt, -0.66);
		const m = patchFrame(ob, cb, ot, ct, [winPath(0.05, 0.07, 0.95, 0.92, 0.07)], thick, frameMat);
		root.add(m); frames.push(m);
		return { ob, cb, ot, ct };
	};
	const fl = front(-1), fr = front(1);
	// centre post
	root.add(patchFrame(V(cx - 0.035, yb, -1.0), V(cx + 0.035, yb, -1.0), V(cx - 0.035, yt, -0.66), V(cx + 0.035, yt, -0.66), [], thick, frameMat));
	const side = (s, f) => {
		const bf = f.ob, br = V(cx + s * 1.06, yb - 0.05, 0.52), tf = f.ot, tr = V(cx + s * 0.87, yt + 0.06, 0.52);
		root.add(patchFrame(bf, br, tf, tr, [winPath(0.04, 0.09, 0.47, 0.88, 0.07, 0.1), winPath(0.55, 0.2, 0.8, 0.8, 0.06)], thick, frameMat));
		// window crank / latch handle on the sliding window
		const hp = bf.clone().lerp(br, 0.42).lerp(tf.clone().lerp(tr, 0.42), 0.12).add(V(-s * 0.02, 0, 0));
		add(root, rbox(0.02, 0.07, 0.02, 0.008), blackMat, hp.x, hp.y, hp.z);
		// wall down to the floor
		root.add(quad(V(cx + s * 0.97, -1.22, -0.84), V(cx + s * 1.02, -1.22, 0.52), bf, br, wallMat));
		// ceiling strip to the overhead panel
		root.add(quad(tf, tr, V(cx + s * 0.49, yt + 0.01, -0.6), V(cx + s * 0.49, 0.66, 0.46), wallMat));
		return { bf, br, tf, tr };
	};
	const sl = side(-1, fl), sr = side(1, fr);
	// glass (slightly reflective, a touch of tint)
	for (const f of [fl, fr]) {
		const n = new THREE.Vector3().subVectors(f.cb, f.ob).cross(new THREE.Vector3().subVectors(f.ot, f.ob)).normalize().multiplyScalar(-thick * 0.85);
		root.add(glassPatch(f.ob.clone().add(n), f.cb.clone().add(n), f.ot.clone().add(n), f.ct.clone().add(n)));
	}
	for (const [s, f] of [[-1, sl], [1, sr]]) {
		const n = V(-s * thick * 0.8, 0, 0);
		root.add(glassPatch(f.bf.clone().add(n), f.br.clone().add(n), f.tf.clone().add(n), f.tr.clone().add(n)));
	}
	// sun visors (folded up) and the standby compass on the centre post
	const visorMat = imat(0x2a2d22, 0.4, 0, { transparent: true, opacity: 0.85 });
	for (const s of [-1, 1]) add(root, rbox(0.4, 0.16, 0.01, 0.005), visorMat, cx + s * 0.5, yt + 0.025, -0.5, -1.38);
	add(root, rbox(0.07, 0.06, 0.06, 0.01), blackMat, cx, yt - 0.05, -0.66);

	// ---------------------------------------------------------- overhead panel
	const overFace = paintedPanel(1024, 1152, C.over, (P) => {
		const sys = airbus
			? [['ADIRS', 3, 0.02], ['FLT CTL', 3, 0.02], ['EVAC', 2, 0.02], ['EMER ELEC PWR', 3, 0.02], ['GPWS', 4, 0.02], ['RCDR', 2, 0.02], ['OXYGEN', 3, 0.02],
				['ANTI ICE', 4, 0.2], ['CABIN PRESS', 3, 0.2], ['HYD', 5, 0.2], ['FUEL', 6, 0.2], ['ELEC', 7, 0.2], ['AIR COND', 6, 0.2], ['APU', 2, 0.2], ['EXT LT', 6, 0.2], ['INT LT', 4, 0.2], ['SIGNS', 3, 0.2]]
			: [['FLT CONTROL', 4, 0], ['NAV/DISPLAYS', 4, 0], ['FUEL', 6, 0], ['ELECTRICAL', 7, 0], ['APU', 3, 0], ['WIPERS', 2, 0], ['ANTI-ICE', 5, 0], ['HYDRAULICS', 4, 0], ['DOORS', 3, 0], ['AIR COND', 6, 0], ['BLEED', 5, 0], ['PRESSURIZATION', 4, 0], ['LIGHTING', 6, 0], ['ENG START', 4, 0]];
		let x = 18, y = 18, rowH = 150;
		for (const [name, n] of sys) {
			const w = 24 + n * 64;
			if (x + w > 1006) { x = 18; y += rowH + 10; }
			if (y + rowH > 1140) break;
			P.rect(x, y, w, rowH, null, 1, 6);
			P.line(x + 6, y + 18, x + w - 6, y + 18, '#e9edf0', 2);
			P.label(name, x + w / 2, y + 10, 13);
			for (let k = 0; k < n; k++) {
				const bx = x + 16 + k * 64;
				if (airbus) {
					const lit = P.r() < 0.12 ? (P.r() < 0.5 ? 'on' : 'blue') : null;
					P.pb(bx, y + 40, 50, 46, P.r() < 0.4 ? 'FAULT' : '', ['ON', 'OFF', 'AUTO', 'ALTN', 'OVRD'][Math.floor(P.r() * 5)], lit);
					P.label(['PUMP', 'GEN', 'BAT', 'XFR', 'ENG', 'BUS', 'PACK', 'BLEED'][Math.floor(P.r() * 8)] + ' ' + (k + 1), bx + 25, y + 104, 10);
					if (P.r() < 0.3) P.knob(bx + 25, y + 128, 11);
				} else {
					P.annun(bx, y + 30, 50, 22, ['LOW', 'OFF', 'VALVE', 'ON'][Math.floor(P.r() * 4)], ['#ffb02e', '#4fc3ff'][Math.floor(P.r() * 2)], P.r() < 0.15);
					P.toggle(bx + 25, y + 98, 8, P.r() < 0.6);
					P.label(['PUMP', 'GEN', 'BUS', 'ENG', 'PACK', 'BLEED'][Math.floor(P.r() * 6)] + ' ' + (k + 1), bx + 25, y + 128, 10);
				}
			}
			x += w + 10;
		}
		for (const xs of [6, 1018]) for (const ys of [6, 300, 600, 900, 1146]) P.screw(xs, ys, 4);
	}, { seed: 15, glow, side: THREE.DoubleSide });
	const over = quad(V(cx - 0.48, yt + 0.01, -0.6), V(cx + 0.48, yt + 0.01, -0.6), V(cx - 0.48, 0.66, 0.46), V(cx + 0.48, 0.66, 0.46), overFace);
	root.add(over);
	root.add(quad(V(cx - 0.9, 0.66, 0.46), V(cx + 0.9, 0.66, 0.46), V(cx - 0.9, 0.7, 0.62), V(cx + 0.9, 0.7, 0.62), wallMat));

	// ---------------------------------------------------------- pedestal
	const pedTop = -0.79;
	add(root, rbox(0.4, 0.44, 1.0, 0.02), plainPanel, cx, pedTop - 0.22, -0.1);
	const pedFace = paintedPanel(512, 1280, C.panel, (P) => {
		// MCDU keypads (two units side by side)
		for (const ux of [8, 260]) {
			P.rect(ux, 8, 244, 380, '#3a4148', 1, 8);
			P.rect(ux + 30, 18, 184, 150, '#0b0d0f', -1, 4);
			for (let k = 0; k < 6; k++) { P.pb(ux + 6, 22 + k * 24, 20, 18, '', ''); P.pb(ux + 218, 22 + k * 24, 20, 18, '', ''); }
			const keys = ['DIR', 'PROG', 'PERF', 'INIT', 'DATA', 'F-PLN', 'RAD', 'FUEL', 'SEC', 'ATC', 'MENU', 'AIRP'];
			keys.forEach((s, k) => P.pb(ux + 12 + (k % 6) * 38, 180 + Math.floor(k / 6) * 30, 34, 26, '', s));
			for (let k = 0; k < 26; k++) P.pb(ux + 12 + (k % 6) * 38, 248 + Math.floor(k / 6) * 26, 32, 22, '', String.fromCharCode(65 + k));
		}
		// thrust lever quadrant (slot + detents)
		P.rect(150, 420, 212, 360, '#2f3439', -1, 8);
		const dets = airbus ? ['TOGA', 'FLX/MCT', 'CL', 'IDLE', 'REV'] : ['TO/GA', '', 'CLB', '', 'IDLE'];
		dets.forEach((s, k) => { P.label(s, 256, 440 + k * 80, 13); P.line(160, 452 + k * 80, 352, 452 + k * 80, 'rgba(240,240,240,0.5)', 1); });
		// speed brake & flap gates
		P.rect(30, 440, 60, 330, '#2f3439', -1, 6);
		P.label('SPEED BRAKE', 60, 790, 11);
		['RET', '', '1/2', '', 'FULL'].forEach((s, k) => P.label(s, 105, 450 + k * 75, 10));
		P.rect(422, 440, 60, 330, '#2f3439', -1, 6);
		P.label('FLAPS', 452, 790, 12);
		(airbus ? ['0', '1', '2', '3', 'FULL'] : ['UP', '1', '5', '15', '30']).forEach((s, k) => P.label(s, 405, 450 + k * 75, 11));
		P.label('ENG 1        ENG 2', 256, 820, 13);
		for (const ex of [190, 322]) { P.rect(ex - 28, 840, 56, 60, '#22262a', 1, 6); P.label('MASTER', ex, 914, 10); }
		// radio management / comms panels
		for (let k = 0; k < 3; k++) {
			const y = 950 + k * 106;
			P.rect(20, y, 472, 96, '#3a4148', 1, 6);
			P.rect(50, y + 18, 150, 40, '#070808', -1, 3); P.label('118.700', 125, y + 38, 24, '#ff9d2e', 'center', 700, true);
			P.rect(312, y + 18, 150, 40, '#070808', -1, 3); P.label('121.500', 387, y + 38, 24, '#ff9d2e', 'center', 700, true);
			P.knob(256, y + 48, 18);
			P.label(['RMP 1', 'ACP', 'XPDR / TCAS'][k], 256, y + 84, 11);
		}
	}, { seed: 16, glow });
	const pedQ = add(root, new THREE.PlaneGeometry(0.38, 0.95), pedFace, cx, pedTop + 0.0015, -0.1, -Math.PI / 2);
	void pedQ;
	// throttle quadrant side plates
	for (const s of [-1, 1]) add(root, rbox(0.012, 0.06, 0.36, 0.004), trimMat, cx + s * 0.105, pedTop + 0.03, -0.02);
	// thrust levers
	const levers = [];
	const tlHandle = airbus ? rbox(0.07, 0.035, 0.05, 0.01) : new THREE.CylinderGeometry(0.022, 0.022, 0.07, 14);
	const tlMat = airbus ? imat(0x9aa2aa, 0.45, 0.3) : imat(0x161718, 0.4);
	for (let i = 0; i < (cfg.engines ? cfg.engines.length : 2); i++) {
		const lv = lever(0.17, metalMat, tlHandle.clone(), tlMat);
		if (!airbus) lv.userData.handle.rotation.z = Math.PI / 2;
		lv.position.set(cx + (i ? 0.045 : -0.045), pedTop, -0.02);
		root.add(lv); levers.push(lv);
		if (!airbus) { // reverse thrust lever piggy-backed on the thrust lever
			add(lv, new THREE.BoxGeometry(0.012, 0.08, 0.012), blackMat, 0, 0.13, -0.025, 0.3);
		}
	}
	const sbLever = lever(0.13, metalMat, rbox(0.03, 0.03, 0.05, 0.008), imat(0x2b2e33, 0.5));
	sbLever.position.set(cx - 0.15, pedTop, -0.02); root.add(sbLever);
	const flapLever = lever(0.13, metalMat, rbox(0.06, 0.03, 0.035, 0.008), imat(0xd8dade, 0.5));
	flapLever.position.set(cx + 0.15, pedTop, -0.02); root.add(flapLever);
	// pitch trim wheels either side of the pedestal
	const trimWheels = [];
	const twMat = imat(0x1a1b1d, 0.55);
	for (const s of [-1, 1]) {
		const tw = new THREE.Group();
		add(tw, new THREE.CylinderGeometry(0.11, 0.11, 0.035, 32), twMat, 0, 0, 0, 0, 0, Math.PI / 2);
		for (let k = 0; k < 8; k++) add(tw, new THREE.BoxGeometry(0.04, 0.012, 0.016), imat(0xf2f2f2, 0.6), 0, Math.cos(k / 8 * 6.283) * 0.1, Math.sin(k / 8 * 6.283) * 0.1, k / 8 * 6.283);
		add(tw, new THREE.CylinderGeometry(0.008, 0.008, 0.05, 8), metalMat, s * 0.04, 0.08, 0, 0, 0, Math.PI / 2);
		tw.position.set(cx + s * 0.215, pedTop - 0.06, 0.02);
		root.add(tw); trimWheels.push(tw);
	}

	// ---------------------------------------------------------- side consoles, sticks / yokes, pedals
	const consoleFace = paintedPanel(256, 1024, C.panel, (P) => {
		P.rect(30, 60, 196, 160, '#3a4148', 1, 8); P.label('STEERING', 128, 240, 12);
		P.rect(30, 300, 196, 280, '#30363c', -1, 8);
		P.rect(30, 640, 196, 140, '#e8c33a', 1, 6); P.label('OXY MASK', 128, 710, 14, '#222', 'center', 800, false);
		P.rect(30, 820, 196, 160, '#3a4148', 1, 6); P.label('PRESS TO TEST', 128, 900, 11);
		for (let k = 0; k < 6; k++) P.screw(14, 40 + k * 180, 4), P.screw(242, 40 + k * 180, 4);
	}, { seed: 17, glow });
	const sticks = [], yokes = [], pedals = [];
	for (const s of [-1, 1]) {
		const px = s < 0 ? 0 : 2 * cx;            // pilot position (captain / first officer)
		const conX = px + s * 0.34;
		add(root, rbox(0.22, 0.44, 1.2, 0.03), plainPanel, conX, -0.88, -0.2);
		add(root, new THREE.PlaneGeometry(0.2, 1.16), consoleFace, conX, -0.659, -0.2, -Math.PI / 2);
		// nose-wheel steering tiller
		const til = new THREE.Group();
		add(til, new THREE.CylinderGeometry(0.06, 0.06, 0.012, 24), imat(0x2a2d31, 0.5));
		add(til, new THREE.CylinderGeometry(0.009, 0.009, 0.05, 8), blackMat, 0.045, 0.03, 0);
		til.position.set(conX, -0.645, -0.6);
		root.add(til);
		if (airbus) {
			const st = new THREE.Group();
			add(st, new THREE.ConeGeometry(0.045, 0.05, 16), imat(0x111214, 0.9), 0, 0.02, 0); // boot
			const grip = new THREE.Group();
			add(grip, new THREE.CapsuleGeometry(0.022, 0.09, 4, 12), imat(0x1d1f22, 0.65), 0, 0.075, -0.01, -0.25);
			add(grip, new THREE.CylinderGeometry(0.008, 0.008, 0.012, 8), imat(0xc81e1e, 0.4), s * -0.01, 0.13, -0.035, 0.6); // takeover button
			add(grip, new THREE.BoxGeometry(0.01, 0.012, 0.03), imat(0x111214, 0.6), 0, 0.09, -0.04); // trigger
			st.add(grip);
			st.position.set(conX, -0.655, -0.24);
			root.add(st); sticks.push(grip);
		} else {
			const pivot = new THREE.Group();
			pivot.position.set(px, -1.2, -0.66);
			add(pivot, new THREE.CylinderGeometry(0.03, 0.04, 0.62, 12), imat(0x55595e, 0.5, 0.3), 0, 0.31, 0);
			const wheel = new THREE.Group();
			wheel.position.set(0, 0.64, 0.02);
			const yk = imat(0x1c1d1f, 0.5);
			add(wheel, rbox(0.16, 0.05, 0.05, 0.015), yk);
			for (const h of [-1, 1]) {
				add(wheel, new THREE.CapsuleGeometry(0.02, 0.1, 4, 10), yk, h * 0.115, 0.03, 0, 0, 0, h * 0.25);
				add(wheel, new THREE.SphereGeometry(0.022, 10, 8), yk, h * 0.13, 0.095, 0);
			}
			add(wheel, rbox(0.1, 0.06, 0.008, 0.004), imat(0xd8d4c8, 0.8), 0, 0.03, 0.03, -0.3); // chart clip
			pivot.add(wheel);
			root.add(pivot); yokes.push({ pivot, wheel });
		}
		for (const ps of [-1, 1]) {
			const pd = new THREE.Group();
			add(pd, rbox(0.09, 0.2, 0.025, 0.01), imat(0x2a2c30, 0.7), 0, 0.1, 0);
			add(pd, new THREE.BoxGeometry(0.02, 0.05, 0.12), metalMat, 0, 0, 0.05);
			pd.position.set(px + ps * 0.12, -1.18, -1.02);
			pd.rotation.x = -0.6;
			root.add(pd); pedals.push({ obj: pd, side: ps, base: pd.position.z });
		}
	}
	// floor, knee panel, rear bulkhead
	const carpet = paintedPanel(256, 256, C.floor, () => {}, { rough: 1, seed: 21 });
	root.add(quad(V(cx - 1.0, -1.22, 0.62), V(cx + 1.0, -1.22, 0.62), V(cx - 1.0, -1.22, -1.05), V(cx + 1.0, -1.22, -1.05), carpet));
	root.add(quad(V(cx - 1.0, -1.22, -0.93), V(cx + 1.0, -1.22, -0.93), V(cx - 1.0, -0.69, -0.8), V(cx + 1.0, -0.69, -0.8), imat(0x202326, 0.9, 0, { side: THREE.DoubleSide })));
	const doorFace = paintedPanel(512, 512, C.wall, (P) => {
		P.rect(176, 40, 160, 440, '#8c9399', -1, 10); P.knob(310, 260, 10); P.rect(220, 120, 72, 50, '#222', -1, 4);
		P.label('FLIGHT DECK DOOR', 256, 30, 14, '#333', 'center', 700, false);
	}, { seed: 22, side: THREE.DoubleSide });
	root.add(quad(V(cx + 1.0, -1.22, 0.62), V(cx - 1.0, -1.22, 0.62), V(cx + 0.95, 0.7, 0.62), V(cx - 0.95, 0.7, 0.62), doorFace));

	// ---------------------------------------------------------- seats and first officer
	const cush = imat(C.seat, 0.85), sheep = imat(C.sheep, 1.0), seatFrame = imat(0x2a2c2f, 0.5, 0.4);
	for (const px of [0, 2 * cx]) {
		const st = seat(cush, seatFrame, { arms: true, w: 0.52 });
		st.position.set(px, -0.86, 0.22);
		add(st, rbox(0.46, 0.6, 0.03, 0.03, 2), sheep, 0, 0.42, 0.17, -0.12);
		root.add(st);
	}
	const fo = person(0xb9c6d4, 0x1b2230, 0xd9a888, 0x3a2a1e, { headset: true, epaulettes: true, tie: 0x1a2440, pose: 'armrest' });
	fo.position.set(2 * cx, -0.86, 0.12);
	root.add(fo);

	// ---------------------------------------------------------- live avionics
	let instruments = null;
	if (withAvionics) {
		const pz = 0.0322, yD = 0.025;
		const m = (k) => ({ parent: panel, x: D[k], y: yD, z: pz, w: dW, h: dH });
		const lowerMount = { parent: root, x: lowerCentre.x, y: lowerCentre.y + 0.002, z: lowerCentre.z, w: 0.155, h: 0.155, rx: -(Math.PI / 2 - lowerTilt) };
		instruments = createAvionics(cfg, [
			{ type: 'pfd', res: [512, 512], hz: 30, mounts: [m('cpfd'), m('fpfd')] },
			{ type: 'nd', res: [512, 512], hz: 12, mounts: [m('cnd'), m('fnd')] },
			{ type: 'eng', res: [512, 512], hz: 8, mounts: [m('ctr')] },
			{ type: 'sd', res: [512, 512], hz: 4, mounts: [lowerMount] },
			{ type: 'pfd', res: [512, 512], hz: 10, mounts: [{ parent: panel, x: D.isis, y: 0.025, z: pz, w: 0.088, h: 0.088 }] },
			{ type: 'fcu', res: [1024, 160], hz: 6, mounts: [{ parent: fcu, x: 0, y: 0, z: 0.041, w: fcuW, h: 0.1 }] },
			{ type: 'mcdu', res: [512, 420], hz: 2, mounts: [-1, 1].map((s) => ({ parent: root, x: cx + s * 0.095, y: pedTop + 0.003, z: -0.1 - 0.95 / 2 + (18 + 75) / 1280 * 0.95, w: 0.088, h: 0.072, rx: -Math.PI / 2 })) },
		]);
	}

	finishInterior(root);
	root.userData = { instruments, levers, sticks, yokes, pedals, flapLever, sbLever, gearLever, trimWheels, glow, kind: 'airliner', airbus };
	return root;
}

function finishInterior(root) {
	root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.userData.noShadow = true; } });
}

// ================================================================ fighter cockpit (Kestrel)
export function buildJetCockpit(cfg, withAvionics = true) {
	const E = cfg.eye;
	const root = new THREE.Group();
	root.position.set(E[0], E[1], E[2]);
	const glow = [];
	const grey = '#2c3136', consoleGrey = '#33393f';
	const plain = imat(hex(grey), 0.75), consoleMat = imat(hex(consoleGrey), 0.7), black = imat(0x121416, 0.6), metal = imat(0x9ea4aa, 0.35, 0.8);
	const tubMat = imat(0x3a4046, 0.85, 0, { side: THREE.DoubleSide });

	// main panel with three MFDs framed by option-select buttons
	const PW = 0.7, PH = 0.32, PX = 1462;
	const X = (x) => (x + PW / 2) * PX, Y = (y) => (PH / 2 - y) * PX;
	const mfd = [[-0.215, -0.02, 0.13], [0, -0.02, 0.15], [0.215, -0.02, 0.13]];
	const face = paintedPanel(1024, 468, grey, (P) => {
		for (const [x, y, s] of mfd) {
			P.rect(X(x - s / 2) - 34, Y(y + s / 2) - 34, s * PX + 68, s * PX + 68, '#1c2024', 1, 12);
			for (let k = 0; k < 5; k++) {
				const t = (k + 0.5) / 5;
				P.pb(X(x - s / 2) + t * s * PX - 12, Y(y + s / 2) - 30, 24, 20, '', '');
				P.pb(X(x - s / 2) + t * s * PX - 12, Y(y - s / 2) + 10, 24, 20, '', '');
				P.pb(X(x - s / 2) - 30, Y(y + s / 2) + t * s * PX - 10, 20, 24, '', '');
				P.pb(X(x + s / 2) + 10, Y(y + s / 2) + t * s * PX - 10, 20, 24, '', '');
			}
			P.label('BRT', X(x - s / 2) - 20, Y(y - s / 2) + 44, 10); P.label('CON', X(x + s / 2) + 20, Y(y - s / 2) + 44, 10);
		}
		// warning / caution lights and switches
		['FIRE', 'ENG', 'HYD', 'OIL', 'CANOPY', 'TO/LDG'].forEach((s, k) => P.annun(16 + (k % 2) * 62, 20 + Math.floor(k / 2) * 34, 56, 26, s, k < 2 ? '#ff2d22' : '#ffb02e', false));
		P.label('MASTER ARM', 1024 - 70, 26, 12); P.toggle(1024 - 70, 64, 9, true);
		P.label('GEAR', 1024 - 70, 110, 12); P.rect(1024 - 104, 124, 68, 120, '#3a4046', 1, 6);
		for (let k = 0; k < 3; k++) P.annun(1024 - 100 + k * 22, 252, 18, 16, '', '#3dff6e', true);
		P.label('EMERG JETT', 70, 300, 11); P.pb(40, 312, 60, 34, 'JETT', '', null);
		for (const xs of [10, 1014]) for (const ys of [10, 230, 458]) P.screw(xs, ys, 5);
	}, { seed: 31, glow });
	const panel = facePanel(PW, PH, 0.05, face, plain);
	panel.position.set(0, -0.43, -0.7);
	panel.rotation.x = -0.28;
	root.add(panel);
	// glareshield coaming, HUD and up-front controller
	add(root, rbox(0.66, 0.06, 0.24, 0.03), imat(0x1a1d20, 0.95), 0, -0.25, -0.76);
	const ufcFace = paintedPanel(512, 256, '#2a2f34', (P) => {
		P.rect(130, 14, 252, 96, '#081208', -1, 4);
		const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', '0', 'ENT'];
		keys.forEach((s, k) => P.pb(150 + (k % 3) * 74, 122 + Math.floor(k / 3) * 32, 64, 28, '', s));
		['COM1', 'COM2', 'IFF', 'TCN'].forEach((s, k) => P.pb(14, 18 + k * 56, 100, 44, '', s));
		['ILS', 'D/L', 'BCN', 'ON/OFF'].forEach((s, k) => P.pb(398, 18 + k * 56, 100, 44, '', s));
	}, { seed: 32, glow });
	const ufc = facePanel(0.22, 0.11, 0.05, ufcFace, plain);
	ufc.position.set(0, -0.255, -0.64);
	ufc.rotation.x = -0.6;
	root.add(ufc);
	// HUD: projector box, frame and two combiner glasses
	add(root, rbox(0.16, 0.05, 0.12, 0.01), black, 0, -0.205, -0.7);
	for (const s of [-1, 1]) add(root, new THREE.BoxGeometry(0.008, 0.16, 0.008), black, s * 0.085, -0.12, -0.67, -0.35);
	const comb = new THREE.MeshPhysicalMaterial({ color: 0x9fffc0, roughness: 0.02, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, clearcoat: 1, envMapIntensity: 1.6 });
	for (const dz of [0, 0.02]) { const c = add(root, new THREE.PlaneGeometry(0.16, 0.14), comb, 0, -0.1, -0.665 + dz, -0.35); c.renderOrder = 3; }

	// tub walls, consoles, floor
	for (const s of [-1, 1]) {
		root.add(quad(V(s * 0.46, -0.8, -0.95), V(s * 0.46, -0.8, 0.5), V(s * 0.47, -0.3, -0.95), V(s * 0.47, -0.3, 0.5), tubMat));
		add(root, rbox(0.17, 0.3, 0.95, 0.02), consoleMat, s * 0.36, -0.6, -0.12);
		const cf = paintedPanel(256, 1024, consoleGrey, (P) => {
			const panels = s < 0 ? ['FUEL', 'COMM', 'AUDIO', 'ANTI-ICE', 'EXT LT'] : ['ELEC', 'ECS', 'AVIONICS', 'SNSR PWR', 'OXYGEN'];
			panels.forEach((n, k) => {
				const y = 20 + k * 200;
				P.rect(14, y, 228, 186, '#2a3035', 1, 6);
				P.label(n, 128, y + 16, 13);
				for (let j = 0; j < 4; j++) (j % 2 ? P.toggle(50 + j * 52, y + 110, 8, P.r() < 0.5) : P.knob(50 + j * 52, y + 100, 14));
				for (const xs of [22, 234]) for (const ys of [y + 8, y + 178]) P.screw(xs, ys, 3);
			});
		}, { seed: 33 + s, glow });
		add(root, new THREE.PlaneGeometry(0.16, 0.93), cf, s * 0.36, -0.449, -0.12, -Math.PI / 2);
	}
	root.add(quad(V(-0.46, -0.8, 0.5), V(0.46, -0.8, 0.5), V(-0.46, -0.8, -0.98), V(0.46, -0.8, -0.98), imat(0x1f2225, 0.95)));
	// throttle on the left console
	const thr = lever(0.1, metal, rbox(0.05, 0.08, 0.07, 0.015), imat(0x1b1d20, 0.6));
	thr.position.set(-0.36, -0.45, -0.1);
	root.add(thr);
	// centre stick with a detailed grip
	const stick = new THREE.Group();
	add(stick, new THREE.CylinderGeometry(0.012, 0.018, 0.34, 10), metal, 0, 0.17, 0);
	add(stick, new THREE.CapsuleGeometry(0.024, 0.08, 4, 12), imat(0x17191b, 0.7), 0, 0.38, -0.01, -0.15);
	add(stick, new THREE.BoxGeometry(0.012, 0.025, 0.02), imat(0x7a1414, 0.5), 0, 0.42, -0.03);
	add(stick, new THREE.BoxGeometry(0.01, 0.03, 0.02), imat(0x101112, 0.6), 0, 0.36, -0.04, 0.4);
	add(stick, new THREE.ConeGeometry(0.05, 0.06, 14), imat(0x101112, 0.95), 0, 0.02, 0);
	stick.position.set(0, -0.8, -0.34);
	root.add(stick);
	// ejection seat: handle between the knees, headbox behind
	add(root, rbox(0.4, 0.1, 0.42, 0.03), imat(0x2f3a2c, 0.9), 0, -0.68, 0.12);
	const ej = new THREE.Group();
	add(ej, new THREE.TorusGeometry(0.035, 0.008, 6, 16, Math.PI), imat(0xe8c21a, 0.5), 0, 0, 0);
	add(ej, new THREE.TorusGeometry(0.035, 0.0082, 6, 16, Math.PI), imat(0x111111, 0.5), 0, 0, 0.0005).scale.set(0.98, 0.98, 1);
	ej.position.set(0, -0.6, -0.12); ej.rotation.x = -0.4;
	root.add(ej);
	add(root, rbox(0.42, 0.75, 0.14, 0.04), imat(0x2f3a2c, 0.9), 0, -0.3, 0.32, -0.15);
	add(root, rbox(0.34, 0.24, 0.16, 0.04), imat(0x3b3f2e, 0.8), 0, 0.15, 0.4, -0.15);
	// rudder pedals
	const pedals = [];
	for (const s of [-1, 1]) {
		const pd = add(root, rbox(0.08, 0.16, 0.025, 0.01), imat(0x2a2c30, 0.6), s * 0.12, -0.72, -1.0, -0.5);
		pedals.push({ obj: pd, side: s, base: pd.position.z });
	}
	// canopy: front arch, bow with mirrors, faint inner glass
	const frameMat = imat(0x3a3f44, 0.6);
	const arch = (z, rx, ry, tube) => { const t = add(root, new THREE.TorusGeometry(1, tube, 8, 36, Math.PI), frameMat, 0, -0.28, z); t.scale.set(rx, ry, 1); return t; };
	arch(-0.78, 0.42, 0.5, 0.03);
	arch(0.55, 0.52, 0.62, 0.035);
	const mirMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ec, roughness: 0.02, metalness: 1 });
	for (const a of [-0.55, 0, 0.55]) {
		const mx = Math.sin(a) * 0.46, my = -0.28 + Math.cos(a) * 0.55;
		const m = add(root, new THREE.PlaneGeometry(0.14, 0.05), mirMat, mx, my - 0.04, 0.5, 0.25, 0, -a);
		add(m, new THREE.BoxGeometry(0.15, 0.06, 0.01), black, 0, 0, -0.006);
	}
	for (const s of [-1, 1]) add(root, rbox(0.04, 0.03, 1.4, 0.01), frameMat, s * 0.5, -0.29, -0.1);
	const cg = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xc8dbe8, roughness: 0.03, transparent: true, opacity: 0.05, side: THREE.BackSide, depthWrite: false, clearcoat: 1, envMapIntensity: 1.4 }));
	cg.scale.set(0.5, 0.6, 1.95); cg.position.set(0, -0.28, 0.4); cg.renderOrder = 3;
	root.add(cg);

	let instruments = null;
	if (withAvionics) {
		const z = 0.0265;
		instruments = createAvionics(cfg, [
			{ type: 'nd', res: [512, 512], hz: 12, mounts: [{ parent: panel, x: mfd[0][0], y: mfd[0][1], z, w: mfd[0][2], h: mfd[0][2] }] },
			{ type: 'pfd', res: [512, 512], hz: 30, mounts: [{ parent: panel, x: mfd[1][0], y: mfd[1][1], z, w: mfd[1][2], h: mfd[1][2] }] },
			{ type: 'eng', res: [512, 512], hz: 8, mounts: [{ parent: panel, x: mfd[2][0], y: mfd[2][1], z, w: mfd[2][2], h: mfd[2][2] }] },
			{ type: 'ufc', res: [512, 192], hz: 4, mounts: [{ parent: ufc, x: 0, y: 0.024, z: 0.0262, w: 0.108, h: 0.04 }] },
		]);
	}
	finishInterior(root);
	root.userData = { instruments, levers: [thr], stick, pedals, glow, kind: 'jet' };
	return root;
}

// ================================================================ piston trainer cockpit (Sparrow)
export function buildTrainerCockpit(cfg, withAvionics = true) {
	const E = cfg.eye;
	const root = new THREE.Group();
	root.position.set(E[0], E[1], E[2]);
	const glow = [];
	const panelCol = '#26292d';
	const plain = imat(hex(panelCol), 0.7), black = imat(0x111214, 0.55), metal = imat(0xb8bdc2, 0.3, 0.85), chrome = imat(0xd8dde2, 0.15, 1);
	const PW = 0.84, PH = 0.34, PX = 1219;
	const X = (x) => (x + PW / 2) * PX, Y = (y) => (PH / 2 - y) * PX;
	// gauge layout (panel coords) -> six-pack canvas regions
	const G = [
		{ x: -0.245, y: 0.06, cu: 0.17, cv: 0.27 }, { x: -0.15, y: 0.06, cu: 0.43, cv: 0.27 }, { x: -0.055, y: 0.06, cu: 0.69, cv: 0.27 },
		{ x: -0.245, y: -0.035, cu: 0.17, cv: 0.73 }, { x: -0.15, y: -0.035, cu: 0.43, cv: 0.73 }, { x: -0.055, y: -0.035, cu: 0.69, cv: 0.73 },
	];
	const gr = 0.041;
	const face = paintedPanel(1024, 414, panelCol, (P) => {
		for (const q of G) {
			P.rect(X(q.x) - gr * PX - 6, Y(q.y) - gr * PX - 6, gr * PX * 2 + 12, gr * PX * 2 + 12, '#0d0e10', -1, gr * PX + 6);
			for (const a of [0.8, 2.35, 3.9, 5.5]) P.screw(X(q.x) + Math.cos(a) * (gr * PX + 10), Y(q.y) + Math.sin(a) * (gr * PX + 10), 4);
		}
		P.rect(X(0.06) - 46, Y(0.065) - 46, 92, 92, '#0d0e10', -1, 46);
		P.rect(X(0.035) - 42, Y(-0.06) - 36, 104, 70, '#0d0e10', -1, 6);
		// radio stack recess
		P.rect(X(0.255) - 104, Y(0.08) - 6, 208, 0.16 * PX + 12, '#0b0c0d', -1, 6);
		// switch row
		['MASTER', 'ALT', 'FUEL PUMP', 'BCN', 'LAND', 'TAXI', 'NAV', 'STROBE', 'PITOT HT'].forEach((s, k) => {
			const x = X(-0.33) + k * 62;
			P.toggle(x, Y(-0.12), 9, k < 2 || k === 3 || k === 6);
			P.label(s, x, Y(-0.12) + 26, 10);
		});
		// circuit breakers
		for (let k = 0; k < 10; k++) { const x = X(0.16) + k * 24; P.g.fillStyle = '#d8d8d2'; P.g.beginPath(); P.g.arc(x, Y(-0.135), 7, 0, 7); P.g.fill(); P.label(['5', '10', '15', '5', '20', '5', '10', '5', '3', '15'][k], x, Y(-0.135) - 15, 8, '#e9edf0', 'center', 700, true); }
		P.label('CIRCUIT BREAKERS', X(0.27), Y(-0.16), 10);
		P.label('SK-201', X(-0.36), Y(0.15), 12, '#bfc5ca');
		for (const xs of [10, 1014]) for (const ys of [10, 207, 404]) P.screw(xs, ys, 5);
	}, { seed: 41, glow });
	const panel = facePanel(PW, PH, 0.05, face, plain);
	panel.position.set(0, -0.38, -0.62);
	panel.rotation.x = -0.12;
	root.add(panel);
	// 3D bezels + glass on every round gauge
	const bezMat = imat(0x0e0f10, 0.4);
	const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, transparent: true, opacity: 0.06, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2 });
	const ring = (x, y, r) => {
		add(panel, new THREE.TorusGeometry(r + 0.004, 0.0045, 8, 40), bezMat, x, y, 0.028);
		add(panel, new THREE.CircleGeometry(r + 0.002, 40), glassMat, x, y, 0.03).renderOrder = 3;
	};
	for (const q of G) ring(q.x, q.y, gr);
	ring(0.06, 0.065, 0.032);
	// glareshield with wet compass, side walls, floor
	add(root, rbox(0.86, 0.05, 0.2, 0.025), imat(0x16181a, 0.95), 0, -0.2, -0.68);
	const comp = add(root, rbox(0.07, 0.06, 0.06, 0.012), black, 0, -0.15, -0.7);
	add(comp, new THREE.PlaneGeometry(0.045, 0.025), imat(0xd8d2b8, 0.4), 0, 0.005, 0.031);
	const uph = paintedPanel(256, 512, '#7e7a72', (P) => {
		for (let y = 0; y < 512; y += 40) P.line(0, y, 256, y, 'rgba(0,0,0,0.25)', 3, false);
		for (let y = 0; y < 512; y += 40) for (let x = 20; x < 256; x += 60) { P.b.fillStyle = '#9a9a9a'; P.b.fillRect(x, y + 4, 40, 32); }
	}, { rough: 0.95, seed: 42, side: THREE.DoubleSide });
	for (const s of [-1, 1]) {
		root.add(quad(V(s * 0.46, -0.72, -0.8), V(s * 0.46, -0.72, 0.5), V(s * 0.48, -0.25, -0.8), V(s * 0.48, -0.25, 0.5), uph));
		add(root, rbox(0.07, 0.05, 0.4, 0.02), imat(0x3a3733, 0.9), s * 0.43, -0.34, 0.05);
	}
	root.add(quad(V(-0.46, -0.72, 0.5), V(0.46, -0.72, 0.5), V(-0.46, -0.72, -0.95), V(0.46, -0.72, -0.95), imat(0x2a2826, 1)));
	root.add(quad(V(-0.42, -0.72, -0.9), V(0.42, -0.72, -0.9), V(-0.42, -0.54, -0.66), V(0.42, -0.54, -0.66), imat(0x1b1d1f, 0.9, 0, { side: THREE.DoubleSide })));
	// throttle quadrant: throttle (black), propeller (blue), mixture (red)
	const quadBox = add(root, rbox(0.16, 0.07, 0.12, 0.015), plain, 0.0, -0.58, -0.5);
	void quadBox;
	const levers = [];
	[[0x161718, -0.045], [0x1d4fa8, 0], [0xb3171c, 0.045]].forEach(([col, dx], i) => {
		const lv = lever(0.09, metal, i === 0 ? rbox(0.035, 0.03, 0.03, 0.01) : new THREE.CylinderGeometry(0.016, 0.016, 0.025, 14), imat(col, 0.45));
		lv.position.set(dx, -0.55, -0.48);
		root.add(lv);
		if (i === 0) levers.push(lv); else lv.rotation.x = -0.3;
	});
	// ignition key, primer, fuel selector, trim wheel
	add(root, new THREE.CylinderGeometry(0.012, 0.012, 0.02, 12), chrome, -0.33, -0.48, -0.575, Math.PI / 2 - 0.12);
	const fsel = add(root, new THREE.CylinderGeometry(0.04, 0.04, 0.01, 20), imat(0x8a1c1c, 0.5), 0, -0.715, -0.3);
	add(fsel, new THREE.BoxGeometry(0.07, 0.015, 0.016), imat(0xe8e2d0, 0.5), 0, 0.01, 0);
	const tw = add(root, new THREE.CylinderGeometry(0.06, 0.06, 0.02, 24), black, 0.13, -0.62, -0.25, 0, 0, Math.PI / 2);
	// stick
	const stick = new THREE.Group();
	add(stick, new THREE.CylinderGeometry(0.011, 0.015, 0.42, 10), metal, 0, 0.21, 0);
	add(stick, new THREE.CapsuleGeometry(0.02, 0.07, 4, 12), imat(0x141516, 0.85), 0, 0.45, 0);
	add(stick, new THREE.CylinderGeometry(0.006, 0.006, 0.01, 8), imat(0xc81e1e, 0.4), 0, 0.5, -0.015, 0.6);
	add(stick, new THREE.ConeGeometry(0.06, 0.07, 14), imat(0x111111, 0.95), 0, 0.03, 0);
	stick.position.set(0, -0.74, -0.32);
	root.add(stick);
	// seat with harness
	const cush = imat(0x5a4636, 0.85);
	const st = seat(cush, imat(0x2a2c2f, 0.5, 0.4), { w: 0.46, headrest: false });
	st.position.set(0, -0.66, 0.18);
	root.add(st);
	const strap = imat(0x1e2a44, 0.8);
	for (const s of [-1, 1]) add(root, new THREE.BoxGeometry(0.045, 0.5, 0.008), strap, s * 0.09, -0.45, 0.0, 0.25, 0, s * 0.18);
	add(root, rbox(0.06, 0.06, 0.012, 0.01), chrome, 0, -0.62, -0.06);
	// rudder pedals
	const pedals = [];
	for (const s of [-1, 1]) {
		const pd = add(root, rbox(0.09, 0.14, 0.02, 0.008), imat(0x2a2c30, 0.6), s * 0.13, -0.66, -0.88, -0.6);
		pedals.push({ obj: pd, side: s, base: pd.position.z });
	}
	// canopy front arch and latch (visible from inside and outside)
	const fr = add(root, new THREE.TorusGeometry(1, 0.022, 8, 36, Math.PI), imat(0xe9e9e4, 0.4), 0, -0.24, -0.55);
	fr.scale.set(0.44, 0.44, 1);
	add(root, rbox(0.1, 0.02, 0.03, 0.008), black, 0, 0.2, -0.55);
	const cg = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xc8dbe8, roughness: 0.03, transparent: true, opacity: 0.05, side: THREE.BackSide, depthWrite: false, clearcoat: 1, envMapIntensity: 1.4 }));
	cg.scale.set(0.48, 0.48, 1.3); cg.position.set(0, -0.24, 0.07); cg.renderOrder = 3;
	root.add(cg);

	let instruments = null;
	if (withAvionics) {
		const z = 0.0262;
		const W = 1024, H = 512, rp = H * 0.21 * 1.1;
		const six = G.map((q) => ({ parent: panel, x: q.x, y: q.y, z, circle: gr, uv: [(q.cu * W - rp) / W, 1 - (q.cv * H + rp) / H, (q.cu * W + rp) / W, 1 - (q.cv * H - rp) / H] }));
		const tr = H * 0.21 * 0.75 * 1.1;
		six.push({ parent: panel, x: 0.06, y: 0.065, z, circle: 0.032, uv: [(0.9 * W - tr) / W, 1 - (0.3 * H + tr) / H, (0.9 * W + tr) / W, 1 - (0.3 * H - tr) / H] });
		six.push({ parent: panel, x: 0.06, y: -0.06, z, w: 0.08, h: 0.052, uv: [0.82, 0.08, 0.98, 0.4] });
		instruments = createAvionics(cfg, [
			{ type: 'six', res: [1024, 512], hz: 30, mounts: six },
			{ type: 'radio', res: [512, 512], hz: 3, mounts: [{ parent: panel, x: 0.255, y: 0.0, z, w: 0.16, h: 0.16 }] },
		]);
	}
	finishInterior(root);
	root.userData = { instruments, levers, stick, pedals, glow, kind: 'prop', trimWheels: [tw] };
	return root;
}

// ================================================================ airliner passenger cabin
// A cabin section around a left window seat over the wing. Returns the group plus the seat eye point.
export function buildCabin(cfg, fusR, withAvionics = true) {
	const root = new THREE.Group();
	const glow = [];
	const airbus = !!cfg.fbw;
	const floorY = -0.62, Ri = fusR - 0.14;
	const seatZ = -1.1, pitch = 0.79;
	const z0 = seatZ - 7.5, z1 = seatZ + 3.5;
	const wallCol = '#e9e7e2', binCol = '#f2f1ee';
	const wallMat = imat(hex(wallCol), 0.8, 0, { side: THREE.DoubleSide });
	// window-band lining: soft texture, panel seams at the edges, slightly darker reveal toward the window
	const liner = paintedPanel(256, 256, wallCol, (P) => {
		for (let i = 0; i < 900; i++) { P.g.fillStyle = `rgba(120,110,95,${P.r() * 0.05})`; P.g.fillRect(P.r() * 256, P.r() * 256, 2, 2); }
		P.line(2, 0, 2, 256, 'rgba(0,0,0,0.18)', 3, false); P.line(254, 0, 254, 256, 'rgba(0,0,0,0.18)', 3, false);
		const gr = P.g.createRadialGradient(128, 130, 40, 128, 130, 130); gr.addColorStop(0, 'rgba(0,0,0,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
		P.g.fillStyle = gr; P.g.fillRect(0, 0, 256, 256);
	}, { rough: 0.8, seed: 50, side: THREE.DoubleSide });
	const binMat = paintedPanel(512, 256, binCol, (P) => {
		P.line(0, 4, 512, 4, 'rgba(0,0,0,0.25)', 3, false);
		P.line(0, 250, 512, 250, 'rgba(0,0,0,0.3)', 3, false);
		P.rect(236, 196, 40, 24, '#cfcdc8', -1, 6);
		P.label(airbus ? '' : '', 256, 120, 12);
	}, { rough: 0.55, seed: 51 });
	const sideAt = (y) => Math.sqrt(Math.max(0.01, Ri * Ri - y * y));
	// window band: one panel per frame pitch, each with an oval window reveal
	const winPitch = airbus ? 0.533 : 0.508;
	const yw0 = floorY + 0.62, yw1 = floorY + 1.42;
	const shade = imat(0xf4f3ef, 0.7, 0, { side: THREE.DoubleSide });
	const glassPanes = [];
	for (const s of [-1, 1]) {
		for (let z = z0; z < z1; z += winPitch) {
			const xa = s * sideAt(yw0 - 0.05) * 0.985, xb = s * sideAt(yw1 + 0.05) * 0.985;
			const c00 = V(xa, yw0, z + winPitch), c10 = V(xa, yw0, z), c01 = V(xb, yw1, z + winPitch), c11 = V(xb, yw1, z);
			const pts = s < 0 ? [c10, c00, c11, c01] : [c00, c10, c01, c11];
			root.add(patchFrame(pts[0], pts[1], pts[2], pts[3], [winPath(0.31, 0.29, 0.69, 0.77, 0.18, 0.19)], 0.1, liner, 14, V(0, yw0 + 0.4, z + winPitch / 2)));
			// window shade, mostly raised
			const sh = add(root, new THREE.PlaneGeometry(winPitch * 0.4, 0.07), shade, (xa + xb) / 2 + s * 0.05, yw0 + 0.74 * (yw1 - yw0), z + winPitch / 2, 0, Math.PI / 2, 0);
			void sh;
			// outer pane
			const g0 = V(s * (Math.abs(xa) + 0.09), yw0 + 0.2, z + winPitch * 0.72), g1 = V(s * (Math.abs(xa) + 0.09), yw0 + 0.2, z + winPitch * 0.28);
			const g2 = V(s * (Math.abs(xb) + 0.09), yw1 - 0.17, z + winPitch * 0.72), g3 = V(s * (Math.abs(xb) + 0.09), yw1 - 0.17, z + winPitch * 0.28);
			const gp = glassPatch(g0, g1, g2, g3);
			gp.material.opacity = 0.1;
			root.add(gp); glassPanes.push(gp);
		}
		// dado panel below the windows and the sidewall above, up to the bins
		const xd = s * sideAt(floorY + 0.3) * 0.97;
		root.add(quad(V(s * sideAt(floorY + 0.05) * 0.95, floorY, z0), V(s * sideAt(floorY + 0.05) * 0.95, floorY, z1), V(s * sideAt(yw0 - 0.05) * 0.985, yw0, z0), V(s * sideAt(yw0 - 0.05) * 0.985, yw0, z1), wallMat));
		void xd;
		const xt = s * sideAt(yw1 + 0.05) * 0.985, xbin = s * (sideAt(floorY + 1.62) - 0.02);
		root.add(quad(V(xt, yw1, z0), V(xt, yw1, z1), V(xbin, floorY + 1.6, z0), V(xbin, floorY + 1.6, z1), wallMat));
		// overhead bins: underside with passenger service units, door face, top
		const binIn = s * 1.05, binBottom = floorY + 1.58, binTop = floorY + 2.0;
		const psu = paintedPanel(1024, 64, '#dcdad5', (P) => {
			for (let k = 0; k < 13; k++) {
				const x = 20 + k * 78;
				P.g.fillStyle = '#f4f2ec'; P.g.beginPath(); P.g.arc(x, 32, 10, 0, 7); P.g.fill();
				P.g.fillStyle = '#9c9a94'; P.g.beginPath(); P.g.arc(x + 26, 32, 8, 0, 7); P.g.fill();
				if (k % 3 === 0) { P.annun(x + 44, 18, 26, 28, '⧸⧹', '#e8f4ff', true); }
			}
		}, { seed: 52, glow });
		root.add(quad(V(xbin, binBottom, z1), V(xbin, binBottom, z0), V(binIn, binBottom, z1), V(binIn, binBottom, z0), psu));
		const door = quad(V(binIn, binBottom, s < 0 ? z0 : z1), V(binIn, binBottom, s < 0 ? z1 : z0), V(binIn - s * 0.06, binTop, s < 0 ? z0 : z1), V(binIn - s * 0.06, binTop, s < 0 ? z1 : z0), binMat);
		door.material.map.wrapS = THREE.RepeatWrapping; door.material.map.repeat.set((z1 - z0) / 1.6, 1);
		root.add(door);
		root.add(quad(V(binIn - s * 0.06, binTop, z0), V(binIn - s * 0.06, binTop, z1), V(s * 0.55, floorY + 2.12, z0), V(s * 0.55, floorY + 2.12, z1), wallMat));
	}
	// ceiling with a lighting strip, floor, carpet aisle
	root.add(quad(V(-0.55, floorY + 2.12, z0), V(0.55, floorY + 2.12, z0), V(-0.55, floorY + 2.12, z1), V(0.55, floorY + 2.12, z1), wallMat));
	const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.95, 0.88) });
	for (const s of [-1, 1]) add(root, new THREE.BoxGeometry(0.03, 0.01, z1 - z0), ledMat, s * 0.5, floorY + 2.1, (z0 + z1) / 2);
	const carpet = paintedPanel(256, 256, airbus ? '#3d4654' : '#3e3a4a', (P) => {
		for (let i = 0; i < 300; i++) { P.g.fillStyle = `rgba(255,255,255,${P.r() * 0.06})`; P.g.fillRect(P.r() * 256, P.r() * 256, 3, 3); }
	}, { rough: 1, seed: 53 });
	carpet.map.wrapS = carpet.map.wrapT = THREE.RepeatWrapping; carpet.map.repeat.set(4, 12);
	root.add(quad(V(-1.8, floorY, z1), V(1.8, floorY, z1), V(-1.8, floorY, z0), V(1.8, floorY, z0), carpet));
	// seats (3 + 3) and passengers
	const fabric = imat(airbus ? 0x24486b : 0x2b3350, 0.95), frame = imat(0x55595e, 0.4, 0.6), cover = imat(0xf3f1ea, 0.9);
	const plastic = imat(0x8c9096, 0.6);
	const r = rnd(7);
	const shirts = [0x2b4c7e, 0x7a2b2b, 0xc9c6bf, 0x3e5c3a, 0x111215, 0xb38b4a, 0x6a4a7a, 0xd4d0c6, 0x274a4a];
	const skins = [0xf1c8a6, 0xd9a888, 0xa86f4c, 0x6b4430, 0xe7b995];
	const hairs = [0x1a1410, 0x3a2a1e, 0x6b4a2a, 0xb9a27a, 0x9c9c9c, 0x2a1c14];
	const seatXs = [-1.32, -0.86, -0.4, 0.4, 0.86, 1.32];
	let ife = null;
	for (let z = seatZ - pitch * 9; z <= seatZ + pitch * 3; z += pitch) {
		const row = Math.round((z - seatZ) / pitch);
		for (const [k, sx] of seatXs.entries()) {
			const st = seat(fabric, frame, { w: 0.44, arms: k === 0 || k === 3 ? false : true });
			st.position.set(sx, floorY + 0.46, z);
			st.scale.set(1, 0.88, 1);
			// the side facing the passenger behind: headrest cover, IFE screen, tray table, seat pocket
			add(st.userData.back, rbox(0.3, 0.16, 0.012, 0.006), cover, 0, 0.27, 0.072);
			add(st.userData.back, rbox(0.2, 0.13, 0.012, 0.006), imat(0x101113, 0.4), 0, 0.12, 0.072);
			add(st.userData.back, rbox(0.34, 0.22, 0.014, 0.01), plastic, 0, -0.1, 0.072);
			add(st.userData.back, rbox(0.32, 0.12, 0.02, 0.01), imat(0x1a1c22, 0.9), 0, -0.3, 0.075);
			root.add(st);
			if (row === -1 && k === 0) ife = st.userData.back;
			const isMe = row === 0 && k === 0;
			if (!isMe && r() < 0.68) {
				const p = person(shirts[Math.floor(r() * shirts.length)], 0x2a2c33, skins[Math.floor(r() * skins.length)], hairs[Math.floor(r() * hairs.length)], { shortSleeve: r() < 0.4 });
				p.position.set(sx, floorY + 0.5, z + 0.06);
				p.rotation.y = (r() - 0.5) * 0.25;
				p.scale.setScalar(0.92 + r() * 0.12);
				root.add(p);
			}
		}
	}
	let instruments = null;
	if (withAvionics && ife) {
		instruments = createAvionics(cfg, [{ type: 'nd', res: [512, 512], hz: 4, mounts: [{ parent: ife, x: 0, y: 0.12, z: 0.0795, w: 0.185, h: 0.118 }] }]);
	}
	finishInterior(root);
	const eye = [seatXs[0] + 0.12, floorY + 1.15, seatZ + 0.2];
	root.userData = { instruments, glow, eye, kind: 'cabin' };
	return root;
}

// ================================================================ per-frame animation of controls
export function animateCockpit(grp, fm, ctl, throttle, dt) {
	const u = grp.userData;
	if (!u || !fm) return;
	const de = fm.de || 0, da = fm.da || 0, dr = fm.dr || 0;
	for (const l of u.levers || []) l.rotation.x = 0.35 - throttle * 0.9;
	if (u.stick) u.stick.rotation.set(-de * 0.3, 0, -da * 0.3);
	for (const g of u.sticks || []) g.rotation.set(-de * 0.35, 0, -da * 0.35);
	for (const y of u.yokes || []) { y.pivot.rotation.x = -de * 0.12; y.wheel.rotation.z = -da * 1.2; }
	for (const p of u.pedals || []) p.obj.position.z = p.base + p.side * dr * 0.05;
	if (u.flapLever) u.flapLever.rotation.x = 0.3 - (fm.flapTarget || 0) * 0.75;
	if (u.sbLever) u.sbLever.rotation.x = 0.3 - (fm.airbrake || 0) * 0.6;
	if (u.gearLever) u.gearLever.rotation.x = fm.gearDown ? 2.5 : 0.45;
	if (u.trimWheels) {
		const d = (fm.trim || 0) - (u._lastTrim ?? fm.trim ?? 0);
		u._lastTrim = fm.trim || 0;
		for (const w of u.trimWheels) w.rotation.x += d * 40;
	}
	void ctl; void dt;
}
