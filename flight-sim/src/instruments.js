// Working cockpit avionics drawn into canvas textures: glass PFD / ND / engine displays for the
// jets and airliners, a classic analog six-pack for the piston trainer.
import * as THREE from 'three';
import { airports } from './world.js';
import { flapText } from './aircraft-configs.js';

const D2R = Math.PI / 180;
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const MAG = '#ff5cf0', GRN = '#4dff7a', CYAN = '#4fe3ff', AMB = '#ffb02e', WHT = '#f2f4f7';

function makeDisplay(w, h, px, py, sizeW, sizeH, parent, panelDepth) {
	const c = document.createElement('canvas');
	c.width = w; c.height = h;
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 8;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
	const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sizeW, sizeH), mat);
	mesh.position.set(px, py, panelDepth / 2 + 0.002);
	parent.add(mesh);
	// bezel
	const bez = new THREE.Mesh(new THREE.PlaneGeometry(sizeW * 1.08, sizeH * 1.08), new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.5 }));
	bez.position.set(px, py, panelDepth / 2 + 0.001);
	parent.add(bez);
	return { c, g: c.getContext('2d'), tex, mat, w, h, t: 0 };
}

const txt = (g, s, x, y, size, col = WHT, align = 'center', weight = '600') => {
	g.font = `${weight} ${size}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle'; g.fillStyle = col; g.fillText(s, x, y);
};

// ------------------------------------------------------------------ primary flight display
function drawPFD(d, t, x) {
	const { g, w: W, h: H } = d;
	g.fillStyle = '#05070a'; g.fillRect(0, 0, W, H);
	const cx = W * 0.47, cy = H * 0.5, R = W * 0.27, ppd = R / 22;
	// attitude
	g.save();
	g.beginPath(); g.roundRect ? g.roundRect(cx - R, cy - R, R * 2, R * 2, 18) : g.rect(cx - R, cy - R, R * 2, R * 2); g.clip();
	g.translate(cx, cy); g.rotate(-t.bank * D2R); g.translate(0, t.pitch * ppd);
	g.fillStyle = '#2f86d6'; g.fillRect(-W, -H * 2, W * 2, H * 2);
	g.fillStyle = '#8a5528'; g.fillRect(-W, 0, W * 2, H * 2);
	g.strokeStyle = WHT; g.lineWidth = 2;
	g.beginPath(); g.moveTo(-W, 0); g.lineTo(W, 0); g.stroke();
	for (let a = -30; a <= 30; a += 2.5) {
		if (!a) continue;
		const y = -a * ppd, half = a % 10 === 0 ? 46 : a % 5 === 0 ? 26 : 12;
		g.beginPath(); g.moveTo(-half, y); g.lineTo(half, y); g.stroke();
		if (a % 10 === 0) { txt(g, String(Math.abs(a)), -half - 18, y, 16); txt(g, String(Math.abs(a)), half + 18, y, 16); }
	}
	g.restore();
	// bank scale + pointer
	g.strokeStyle = WHT; g.lineWidth = 2;
	for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
		const an = (a - 90) * D2R, l = a % 30 === 0 ? 14 : 8;
		g.beginPath(); g.moveTo(cx + Math.cos(an) * R * 0.92, cy + Math.sin(an) * R * 0.92); g.lineTo(cx + Math.cos(an) * (R * 0.92 + l), cy + Math.sin(an) * (R * 0.92 + l)); g.stroke();
	}
	g.save(); g.translate(cx, cy); g.rotate(-t.bank * D2R);
	g.fillStyle = Math.abs(t.bank) > 35 ? AMB : WHT;
	g.beginPath(); g.moveTo(0, -R * 0.9); g.lineTo(-9, -R * 0.9 + 14); g.lineTo(9, -R * 0.9 + 14); g.fill();
	g.fillRect(-10 + Math.max(-1, Math.min(1, t.beta / 8)) * 14, -R * 0.9 + 17, 20, 5);
	g.restore();
	// aircraft symbol
	g.fillStyle = '#111'; g.strokeStyle = '#ffd400'; g.lineWidth = 5;
	g.beginPath(); g.moveTo(cx - R * 0.62, cy); g.lineTo(cx - R * 0.22, cy); g.lineTo(cx - R * 0.22, cy + 12); g.stroke();
	g.beginPath(); g.moveTo(cx + R * 0.62, cy); g.lineTo(cx + R * 0.22, cy); g.lineTo(cx + R * 0.22, cy + 12); g.stroke();
	g.fillStyle = '#ffd400'; g.fillRect(cx - 5, cy - 5, 10, 10);
	// flight director from the autopilot
	if (x.ap && x.ap.fd) {
		g.strokeStyle = MAG; g.lineWidth = 3;
		const fy = cy + Math.max(-R, Math.min(R, -x.ap.fdPitch * ppd)), fx = cx + Math.max(-R, Math.min(R, x.ap.fdRoll * 3));
		g.beginPath(); g.moveTo(cx - R * 0.55, fy); g.lineTo(cx + R * 0.55, fy); g.moveTo(fx, cy - R * 0.55); g.lineTo(fx, cy + R * 0.55); g.stroke();
	}
	// ILS deviation
	if (x.approach) {
		g.strokeStyle = WHT; g.lineWidth = 2;
		for (let i = -2; i <= 2; i++) { g.beginPath(); g.arc(cx + i * R * 0.35, cy + R + 22, 4, 0, 7); g.stroke(); g.beginPath(); g.arc(cx + R + 20, cy + i * R * 0.35, 4, 0, 7); g.stroke(); }
		g.fillStyle = MAG;
		const lx = cx + Math.max(-2.3, Math.min(2.3, x.approach.loc / 1.25)) * R * 0.35, gy = cy + Math.max(-2.3, Math.min(2.3, x.approach.gs / 0.35)) * R * 0.35;
		g.beginPath(); g.moveTo(lx, cy + R + 14); g.lineTo(lx + 8, cy + R + 22); g.lineTo(lx, cy + R + 30); g.lineTo(lx - 8, cy + R + 22); g.fill();
		g.beginPath(); g.moveTo(cx + R + 12, gy); g.lineTo(cx + R + 20, gy - 8); g.lineTo(cx + R + 28, gy); g.lineTo(cx + R + 20, gy + 8); g.fill();
		txt(g, x.approach.name, cx - R + 50, cy - R + 16, 15, MAG, 'center');
	}
	// speed tape
	const tw = W * 0.13, tx = W * 0.06, th = H * 0.62, ty = cy - th / 2, ppk = 4.2;
	g.fillStyle = '#2a2f36'; g.fillRect(tx, ty, tw, th);
	g.save(); g.beginPath(); g.rect(tx, ty, tw, th); g.clip();
	for (let k = Math.floor((t.ias - 45) / 10) * 10; k <= t.ias + 45; k += 10) {
		if (k < 0) continue;
		const y = cy - (k - t.ias) * ppk;
		g.strokeStyle = WHT; g.beginPath(); g.moveTo(tx + tw - 12, y); g.lineTo(tx + tw, y); g.stroke();
		if (k % 20 === 0) txt(g, String(k), tx + tw - 18, y, 17, WHT, 'right');
	}
	// stall band and Vne band
	const vy = (v) => cy - (v - t.ias) * ppk;
	g.fillStyle = '#e8202a'; g.fillRect(tx + tw - 6, vy(x.cfg.vs), 6, H);
	g.fillStyle = '#e8202a'; g.fillRect(tx + tw - 6, vy(x.cfg.vne + 300), 6, vy(x.cfg.vne) - vy(x.cfg.vne + 300));
	const trend = (x.accelAlong || 0) * 10 * 1.94384;
	if (Math.abs(trend) > 2) { g.strokeStyle = GRN; g.lineWidth = 3; g.beginPath(); g.moveTo(tx + tw - 3, cy); g.lineTo(tx + tw - 3, cy - trend * ppk); g.stroke(); }
	if (x.ap && x.ap.spd) { g.fillStyle = MAG; const y = vy(x.ap.spdTarget); g.beginPath(); g.moveTo(tx + tw, y); g.lineTo(tx + tw + 10, y - 7); g.lineTo(tx + tw + 10, y + 7); g.fill(); }
	g.restore();
	g.fillStyle = '#000'; g.fillRect(tx - 2, cy - 18, tw + 6, 36); g.strokeStyle = WHT; g.lineWidth = 2; g.strokeRect(tx - 2, cy - 18, tw + 6, 36);
	txt(g, String(Math.round(t.ias)), tx + tw - 6, cy, 24, t.ias < x.cfg.vs * 1.05 && !t.onGround ? AMB : WHT, 'right', '700');
	txt(g, t.mach >= 0.4 ? `.${Math.round(t.mach * 1000).toString().padStart(3, '0')}` : `GS ${Math.round(t.gs)}`, tx + tw / 2, ty + th + 18, 15, WHT);
	// altitude tape
	const ax = W * 0.79, aw = W * 0.14, ppf = 0.32;
	g.fillStyle = '#2a2f36'; g.fillRect(ax, ty, aw, th);
	g.save(); g.beginPath(); g.rect(ax, ty, aw, th); g.clip();
	for (let k = Math.floor((t.alt - 600) / 100) * 100; k <= t.alt + 600; k += 100) {
		const y = cy - (k - t.alt) * ppf;
		g.strokeStyle = WHT; g.lineWidth = 2; g.beginPath(); g.moveTo(ax, y); g.lineTo(ax + (k % 500 ? 8 : 14), y); g.stroke();
		if (k % 200 === 0) txt(g, String(k), ax + 18, y, 15, WHT, 'left');
	}
	const ground = cy + t.agl * ppf;
	if (ground < ty + th) { g.fillStyle = '#9a6a2a'; g.fillRect(ax, ground, aw, th); }
	if (x.ap && x.ap.alt) { g.fillStyle = CYAN; const y = cy - (x.ap.altTarget - t.alt) * ppf; g.fillRect(ax - 8, Math.max(ty, Math.min(ty + th, y)) - 5, 8, 10); }
	g.restore();
	g.fillStyle = '#000'; g.fillRect(ax - 4, cy - 18, aw + 8, 36); g.strokeStyle = WHT; g.strokeRect(ax - 4, cy - 18, aw + 8, 36);
	txt(g, String(Math.round(t.alt / 10) * 10), ax + aw - 2, cy, 22, WHT, 'right', '700');
	// VSI
	const vx = W * 0.955;
	g.strokeStyle = WHT; g.lineWidth = 2; g.beginPath(); g.moveTo(vx, cy - th * 0.4); g.lineTo(vx, cy + th * 0.4); g.stroke();
	const vsy = cy - Math.sign(t.vs) * Math.min(1, Math.sqrt(Math.abs(t.vs) / 6000)) * th * 0.4;
	g.strokeStyle = GRN; g.lineWidth = 4; g.beginPath(); g.moveTo(vx - 14, cy); g.lineTo(vx, vsy); g.stroke();
	if (Math.abs(t.vs) > 200) txt(g, String(Math.round(t.vs / 100) * 100), vx - 6, t.vs > 0 ? ty - 6 : ty + th + 10, 13, GRN, 'right');
	// heading
	g.fillStyle = '#2a2f36'; g.fillRect(cx - R, H - 46, R * 2, 40);
	g.save(); g.beginPath(); g.rect(cx - R, H - 46, R * 2, 40); g.clip();
	for (let a = Math.floor((t.heading - 30) / 5) * 5; a <= t.heading + 30; a += 5) {
		const xx = cx + (a - t.heading) * R / 30;
		g.strokeStyle = WHT; g.beginPath(); g.moveTo(xx, H - 46); g.lineTo(xx, H - (a % 10 ? 40 : 34)); g.stroke();
		if (a % 10 === 0) txt(g, String((((a % 360) + 360) % 360) / 10 | 0).padStart(2, '0'), xx, H - 20, 15);
	}
	g.restore();
	g.strokeStyle = '#ffd400'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, H - 50); g.lineTo(cx, H - 30); g.stroke();
	// radio altitude
	if (t.agl < 2500 && !t.onGround) txt(g, String(Math.round(t.agl)), cx, cy + R - 18, 22, t.agl < 200 ? AMB : GRN, 'center', '700');
	// flight mode annunciator
	g.fillStyle = '#000'; g.fillRect(0, 0, W, 40);
	const fma = x.ap ? x.ap.fma() : ['', '', '', 'FD OFF'];
	const cols = [W * 0.16, W * 0.4, W * 0.62, W * 0.86];
	fma.forEach((s, i) => { if (s) txt(g, s, cols[i], 20, 17, i === 3 ? CYAN : GRN, 'center', '700'); });
	g.strokeStyle = '#555'; g.lineWidth = 1;
	for (const c0 of [W * 0.28, W * 0.51, W * 0.74]) { g.beginPath(); g.moveTo(c0, 4); g.lineTo(c0, 36); g.stroke(); }
}

// ------------------------------------------------------------------ navigation display
function drawND(d, t, x) {
	const { g, w: W, h: H } = d;
	g.fillStyle = '#03050a'; g.fillRect(0, 0, W, H);
	const cx = W / 2, cy = H * 0.78, R = H * 0.66;
	const range = x.ndRange || 20000; // metres to the arc
	const k = R / range;
	const hd = t.heading * D2R;
	const toS = (wx, wz) => {
		const dx = wx - x.pos.x, dz = wz - x.pos.z;
		return [cx + (dx * Math.cos(hd) + dz * Math.sin(hd)) * k, cy + (-dx * Math.sin(hd) + dz * Math.cos(hd)) * k];
	};
	g.save();
	g.beginPath(); g.arc(cx, cy, R * 1.02, Math.PI, 2 * Math.PI); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.clip();
	if (x.mapImage) {
		const im = x.mapImage;
		g.globalAlpha = 0.5;
		g.save(); g.translate(cx, cy); g.rotate(-hd);
		const sc = k * im.metresPerPixel;
		g.drawImage(im.canvas, (im.x0 - x.pos.x) * k, (im.z0 - x.pos.z) * k, im.canvas.width * sc, im.canvas.height * sc);
		g.restore();
		g.globalAlpha = 1;
	}
	// range rings
	g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.5;
	g.setLineDash([6, 8]); g.beginPath(); g.arc(cx, cy, R / 2, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
	// airports + extended centre lines
	for (const ap of airports) {
		const a = toS(ap.x - ap.dir.x * ap.length / 2, ap.z - ap.dir.z * ap.length / 2), b = toS(ap.x + ap.dir.x * ap.length / 2, ap.z + ap.dir.z * ap.length / 2);
		g.strokeStyle = WHT; g.lineWidth = 4; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
		const ext = toS(ap.x - ap.dir.x * (ap.length / 2 + 18000), ap.z - ap.dir.z * (ap.length / 2 + 18000));
		g.strokeStyle = 'rgba(79,227,255,0.6)'; g.lineWidth = 1.5; g.setLineDash([10, 8]); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(ext[0], ext[1]); g.stroke(); g.setLineDash([]);
		const c = toS(ap.x, ap.z);
		txt(g, ap.id, c[0] + 16, c[1] - 14, 15, CYAN, 'left');
	}
	// track line
	const trk = (t.track - t.heading) * D2R;
	g.strokeStyle = GRN; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(trk) * R, cy - Math.cos(trk) * R); g.stroke();
	g.restore();
	// compass arc
	g.strokeStyle = WHT; g.lineWidth = 2;
	g.beginPath(); g.arc(cx, cy, R, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
	for (let a = 0; a < 360; a += 5) {
		const rel = ((a - t.heading + 540) % 360) - 180;
		if (Math.abs(rel) > 62) continue;
		const an = (rel - 90) * D2R, l = a % 10 ? 8 : 16;
		g.beginPath(); g.moveTo(cx + Math.cos(an) * R, cy + Math.sin(an) * R); g.lineTo(cx + Math.cos(an) * (R - l), cy + Math.sin(an) * (R - l)); g.stroke();
		if (a % 30 === 0) txt(g, String(a / 10), cx + Math.cos(an) * (R - 32), cy + Math.sin(an) * (R - 32), 18);
	}
	// heading bug from the autopilot
	if (x.ap && x.ap.hdgTarget != null) {
		const rel = ((x.ap.hdgTarget - t.heading + 540) % 360) - 180;
		if (Math.abs(rel) < 62) { const an = (rel - 90) * D2R; g.fillStyle = CYAN; g.save(); g.translate(cx + Math.cos(an) * R, cy + Math.sin(an) * R); g.rotate(an + Math.PI / 2); g.fillRect(-10, -6, 20, 12); g.restore(); }
	}
	g.fillStyle = '#000'; g.fillRect(cx - 34, cy - R - 42, 68, 30); g.strokeStyle = WHT; g.strokeRect(cx - 34, cy - R - 42, 68, 30);
	txt(g, String(Math.round(t.heading) % 360).padStart(3, '0'), cx, cy - R - 27, 20, WHT, 'center', '700');
	// own ship
	g.strokeStyle = '#ffd400'; g.lineWidth = 3;
	g.beginPath(); g.moveTo(cx, cy - 18); g.lineTo(cx - 12, cy + 14); g.moveTo(cx, cy - 18); g.lineTo(cx + 12, cy + 14); g.moveTo(cx - 14, cy + 2); g.lineTo(cx + 14, cy + 2); g.stroke();
	// data block
	txt(g, `GS ${Math.round(t.gs)}  TAS ${Math.round(t.tas)}`, 14, 22, 16, WHT, 'left');
	if (x.wind) {
		const wd = Math.round(x.wind.dir), ws = Math.round(x.wind.kt);
		txt(g, `${String(wd).padStart(3, '0')}°/${ws}`, 14, 46, 16, WHT, 'left');
		const rel = (wd + 180 - t.heading) * D2R;
		g.save(); g.translate(40, 82); g.rotate(rel); g.strokeStyle = WHT; g.lineWidth = 3;
		g.beginPath(); g.moveTo(0, -14); g.lineTo(0, 14); g.moveTo(-6, 6); g.lineTo(0, 14); g.lineTo(6, 6); g.stroke(); g.restore();
	}
	txt(g, `${Math.round(range / 1852)} NM`, cx + R * 0.5 + 10, cy - 10, 14, 'rgba(255,255,255,0.7)', 'left');
	if (x.navText) txt(g, x.navText, W - 14, 22, 16, MAG, 'right');
}

// ------------------------------------------------------------------ engine / systems display
function arcGauge(g, cx, cy, r, v, label, valueText, col) {
	g.strokeStyle = '#3a3f46'; g.lineWidth = 8;
	g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25); g.stroke();
	g.strokeStyle = col; g.lineWidth = 8;
	g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * Math.max(0, Math.min(1.05, v)))); g.stroke();
	const an = Math.PI * (0.75 + 1.5 * Math.max(0, Math.min(1.05, v)));
	g.strokeStyle = WHT; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(an) * r * 0.95, cy + Math.sin(an) * r * 0.95); g.stroke();
	txt(g, valueText, cx + r * 0.15, cy + r * 0.55, 20, WHT, 'center', '700');
	txt(g, label, cx, cy + r + 16, 14, CYAN);
}

function drawEng(d, t, x) {
	const { g, w: W, h: H } = d;
	g.fillStyle = '#04060a'; g.fillRect(0, 0, W, H);
	const n = x.cfg.engines ? x.cfg.engines.length : 1;
	const n1 = t.rpm;
	for (let i = 0; i < n; i++) {
		const cxg = W * (n === 1 ? 0.5 : 0.28 + i * 0.44);
		arcGauge(g, cxg, H * 0.2, W * 0.13, n1 / 104, 'N1', `${n1.toFixed(1)}`, n1 > 101 ? AMB : GRN);
		const egt = 380 + n1 * 5.2 + (t.ab || 0) * 180;
		arcGauge(g, cxg, H * 0.49, W * 0.1, egt / 1050, 'EGT', `${Math.round(egt)}`, egt > 950 ? AMB : GRN);
		const ff = (0.25 + 2.6 * Math.pow(n1 / 100, 3)) * (x.cfg.category === 'airliner' ? 1 : 1.6) * (1 + (t.ab || 0) * 3);
		txt(g, `FF ${(ff * 1000).toFixed(0)} kg/h`, cxg, H * 0.65, 15, WHT);
		if (t.reversing) txt(g, 'REV', cxg, H * 0.11, 18, AMB, 'center', '700');
		if (t.ab > 0.3) txt(g, 'A/B', cxg, H * 0.11, 18, AMB, 'center', '700');
	}
	// configuration block
	const y0 = H * 0.74;
	g.strokeStyle = '#333'; g.beginPath(); g.moveTo(10, y0 - 12); g.lineTo(W - 10, y0 - 12); g.stroke();
	txt(g, 'FLAPS', W * 0.14, y0 + 6, 15, CYAN);
	g.strokeStyle = WHT; g.lineWidth = 2; g.strokeRect(W * 0.06, y0 + 18, W * 0.3, 14);
	g.fillStyle = t.flap > 0.01 ? AMB : GRN; g.fillRect(W * 0.06, y0 + 18, W * 0.3 * t.flap, 14);
	txt(g, flapText(x.cfg, t.flap), W * 0.21, y0 + 48, 16, WHT);
	txt(g, 'GEAR', W * 0.5, y0 + 6, 15, CYAN);
	const gc = t.gearPos > 0.99 ? GRN : t.gearPos < 0.01 ? '#555' : '#e8202a';
	for (let i = 0; i < 3; i++) { g.fillStyle = gc; g.fillRect(W * 0.42 + i * 24, y0 + 18, 18, 18); }
	txt(g, t.gearPos > 0.99 ? 'DOWN' : t.gearPos < 0.01 ? 'UP' : 'TRANSIT', W * 0.5, y0 + 48, 15, gc === '#555' ? WHT : gc);
	txt(g, 'SPLR', W * 0.8, y0 + 6, 15, CYAN);
	txt(g, t.airbrake > 0.05 ? (t.groundSpoilers ? 'GND' : 'EXT') : 'RET', W * 0.8, y0 + 26, 16, t.airbrake > 0.05 ? AMB : GRN);
	txt(g, `TRIM ${t.trim >= 0 ? 'UP' : 'DN'} ${Math.abs(t.trim * 10).toFixed(1)}`, W * 0.8, y0 + 48, 15, WHT);
	txt(g, t.parkBrake ? 'PARK BRK' : t.brake > 0.05 ? 'BRAKES' : '', W * 0.5, H - 14, 15, AMB);
	if (t.engineFailed) txt(g, 'ENG FAIL', W * 0.5, H * 0.02 + 14, 18, '#ff4040', 'center', '700');
}

// ------------------------------------------------------------------ analog six-pack (trainer)
function dial(g, cx, cy, r) {
	const gr = g.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r * 1.05);
	gr.addColorStop(0, '#1e2125'); gr.addColorStop(1, '#0a0b0c');
	g.fillStyle = '#2a2c2f'; g.beginPath(); g.arc(cx, cy, r * 1.1, 0, 7); g.fill();
	g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
}
function needle(g, cx, cy, ang, len, wdt = 5, col = WHT) {
	g.save(); g.translate(cx, cy); g.rotate(ang);
	g.fillStyle = col; g.beginPath(); g.moveTo(-wdt / 2, len * 0.15); g.lineTo(0, -len); g.lineTo(wdt / 2, len * 0.15); g.fill();
	g.restore();
	g.fillStyle = '#555'; g.beginPath(); g.arc(cx, cy, 6, 0, 7); g.fill();
}
function ticks(g, cx, cy, r, from, to, n, major, labels) {
	for (let i = 0; i <= n; i++) {
		const a = from + (to - from) * i / n, big = i % major === 0;
		g.strokeStyle = WHT; g.lineWidth = big ? 3 : 1.5;
		g.beginPath(); g.moveTo(cx + Math.sin(a) * r * 0.95, cy - Math.cos(a) * r * 0.95); g.lineTo(cx + Math.sin(a) * r * (big ? 0.8 : 0.87), cy - Math.cos(a) * r * (big ? 0.8 : 0.87)); g.stroke();
		if (big && labels) txt(g, labels(i / n), cx + Math.sin(a) * r * 0.64, cy - Math.cos(a) * r * 0.64, r * 0.17, WHT);
	}
}

function drawSixPack(d, t, x) {
	const { g, w: W, h: H } = d;
	g.fillStyle = '#1b1d20'; g.fillRect(0, 0, W, H);
	const r = H * 0.21;
	const pos = [[W * 0.17, H * 0.27], [W * 0.43, H * 0.27], [W * 0.69, H * 0.27], [W * 0.17, H * 0.73], [W * 0.43, H * 0.73], [W * 0.69, H * 0.73]];
	// airspeed (0-200 kt over 330 deg)
	let [cx, cy] = pos[0]; dial(g, cx, cy, r);
	const asA = (v) => (-150 + Math.min(200, v) / 200 * 300) * D2R;
	const arc = (v0, v1, col, rr) => { g.strokeStyle = col; g.lineWidth = 7; g.beginPath(); g.arc(cx, cy, r * rr, asA(v0) - Math.PI / 2, asA(v1) - Math.PI / 2); g.stroke(); };
	arc(48, 110, WHT, 0.9); arc(x.cfg.vs, x.cfg.vno, '#2bd34a', 0.96); arc(x.cfg.vno, x.cfg.vne, '#f2c200', 0.96);
	ticks(g, cx, cy, r, asA(0), asA(200), 20, 2, (f) => String(Math.round(f * 200)));
	txt(g, 'KNOTS', cx, cy + r * 0.38, r * 0.13, WHT);
	needle(g, cx, cy, asA(t.ias), r * 0.85);
	// attitude indicator
	[cx, cy] = pos[1]; dial(g, cx, cy, r);
	g.save(); g.beginPath(); g.arc(cx, cy, r * 0.92, 0, 7); g.clip();
	g.translate(cx, cy); g.rotate(-t.bank * D2R); g.translate(0, t.pitch * r / 30);
	g.fillStyle = '#3a8ad8'; g.fillRect(-r * 2, -r * 2, r * 4, r * 2);
	g.fillStyle = '#7a4a22'; g.fillRect(-r * 2, 0, r * 4, r * 2);
	g.strokeStyle = WHT; g.lineWidth = 2;
	for (const a of [-20, -10, 10, 20]) { g.beginPath(); g.moveTo(-r * (a % 20 ? 0.15 : 0.3), -a * r / 30); g.lineTo(r * (a % 20 ? 0.15 : 0.3), -a * r / 30); g.stroke(); }
	g.beginPath(); g.moveTo(-r * 2, 0); g.lineTo(r * 2, 0); g.stroke();
	g.restore();
	g.strokeStyle = '#ff9a1a'; g.lineWidth = 5;
	g.beginPath(); g.moveTo(cx - r * 0.55, cy); g.lineTo(cx - r * 0.18, cy); g.lineTo(cx - r * 0.08, cy + r * 0.1); g.moveTo(cx + r * 0.55, cy); g.lineTo(cx + r * 0.18, cy); g.lineTo(cx + r * 0.08, cy + r * 0.1); g.stroke();
	// altimeter
	[cx, cy] = pos[2]; dial(g, cx, cy, r);
	ticks(g, cx, cy, r, 0, Math.PI * 2 * 0.98, 50, 5, (f) => (f < 0.99 ? String(Math.round(f * 10)) : ''));
	needle(g, cx, cy, (t.alt % 1000) / 1000 * Math.PI * 2, r * 0.85, 5);
	needle(g, cx, cy, (t.alt % 10000) / 10000 * Math.PI * 2, r * 0.55, 9);
	txt(g, 'ALT', cx, cy + r * 0.38, r * 0.13, WHT);
	// turn coordinator
	[cx, cy] = pos[3]; dial(g, cx, cy, r);
	const rate = Math.max(-1.6, Math.min(1.6, (x.turnRate || 0) / 3)); // standard rate = 3 deg/s
	g.save(); g.translate(cx, cy - r * 0.1); g.rotate(rate * 20 * D2R);
	g.strokeStyle = WHT; g.lineWidth = 5; g.beginPath(); g.moveTo(-r * 0.6, 0); g.lineTo(r * 0.6, 0); g.moveTo(0, 0); g.lineTo(0, -r * 0.15); g.stroke(); g.restore();
	for (const s of [-1, 1]) { g.fillStyle = WHT; g.fillRect(cx + s * r * 0.62 - 4, cy - r * 0.1 + 14, 8, 4); }
	g.fillStyle = '#e8e8e0'; g.fillRect(cx - r * 0.45, cy + r * 0.4, r * 0.9, r * 0.18);
	g.fillStyle = '#111'; g.beginPath(); g.arc(cx + Math.max(-1, Math.min(1, -t.beta / 6)) * r * 0.38, cy + r * 0.49, r * 0.08, 0, 7); g.fill();
	txt(g, 'TURN COORD', cx, cy + r * 0.78, r * 0.11, WHT);
	// heading indicator
	[cx, cy] = pos[4]; dial(g, cx, cy, r);
	for (let a = 0; a < 360; a += 5) {
		const an = (a - t.heading) * D2R, big = a % 30 === 0;
		g.strokeStyle = WHT; g.lineWidth = big ? 3 : 1.5;
		g.beginPath(); g.moveTo(cx + Math.sin(an) * r * 0.92, cy - Math.cos(an) * r * 0.92); g.lineTo(cx + Math.sin(an) * r * (a % 10 ? 0.84 : 0.78), cy - Math.cos(an) * r * (a % 10 ? 0.84 : 0.78)); g.stroke();
		if (big) txt(g, ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' })[a] || String(a / 10), cx + Math.sin(an) * r * 0.62, cy - Math.cos(an) * r * 0.62, r * 0.15, WHT);
	}
	g.strokeStyle = '#ff9a1a'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy - r * 0.35); g.lineTo(cx, cy + r * 0.25); g.moveTo(cx - r * 0.25, cy); g.lineTo(cx + r * 0.25, cy); g.stroke();
	// VSI (+-2000 fpm)
	[cx, cy] = pos[5]; dial(g, cx, cy, r);
	const vA = (v) => (-90 + Math.max(-2000, Math.min(2000, v)) / 2000 * 170) * D2R;
	ticks(g, cx, cy, r, vA(-2000), vA(2000), 20, 5, (f) => String(Math.abs(Math.round((f * 4 - 2)))));
	txt(g, 'VERT SPEED', cx + r * 0.25, cy + r * 0.36, r * 0.11, WHT);
	needle(g, cx, cy, vA(t.vs), r * 0.85);
	// tachometer
	const tx = W * 0.9, ty = H * 0.3, tr = r * 0.75;
	dial(g, tx, ty, tr);
	const tA = (v) => (-130 + Math.min(3000, v) / 3000 * 260) * D2R;
	g.strokeStyle = '#2bd34a'; g.lineWidth = 6; g.beginPath(); g.arc(tx, ty, tr * 0.92, tA(2100) - Math.PI / 2, tA(2700) - Math.PI / 2); g.stroke();
	ticks(g, tx, ty, tr, tA(0), tA(3000), 30, 5, (f) => String(Math.round(f * 30)));
	needle(g, tx, ty, tA(t.rpm), tr * 0.85);
	txt(g, 'RPM x100', tx, ty + tr * 0.45, tr * 0.14, WHT);
	// flaps + trim strip
	txt(g, `FLAPS ${flapText(x.cfg, t.flap)}`, W * 0.9, H * 0.66, r * 0.15, t.flap > 0.01 ? AMB : WHT);
	txt(g, `TRIM ${t.trim >= 0 ? '▲' : '▼'}${Math.abs(t.trim * 10).toFixed(1)}`, W * 0.9, H * 0.76, r * 0.15, WHT);
	if (t.engineFailed) txt(g, 'ENG OUT', W * 0.9, H * 0.88, r * 0.18, '#ff4040', 'center', '700');
}

// ------------------------------------------------------------------ panel assembly
export function createInstruments(cfg, panel, panelW, panelH, depth) {
	const displays = [];
	const kind = cfg.category === 'airliner' ? 'airliner' : cfg.engine === 'jet' ? 'jet' : 'prop';
	if (kind === 'airliner') {
		const s = 0.21;
		displays.push({ d: makeDisplay(512, 512, -0.15, 0.0, s, s, panel, depth), draw: drawPFD, hz: 30 });
		displays.push({ d: makeDisplay(512, 512, 0.085, 0.0, s, s, panel, depth), draw: drawND, hz: 12 });
		displays.push({ d: makeDisplay(512, 512, 0.44, 0.0, s * 0.95, s, panel, depth), draw: drawEng, hz: 8 });
	} else if (kind === 'jet') {
		const s = 0.13;
		displays.push({ d: makeDisplay(512, 512, -0.22, -0.02, s, s, panel, depth), draw: drawND, hz: 12 });
		displays.push({ d: makeDisplay(512, 512, 0.0, -0.02, s * 1.15, s * 1.15, panel, depth), draw: drawPFD, hz: 30 });
		displays.push({ d: makeDisplay(512, 512, 0.22, -0.02, s, s, panel, depth), draw: drawEng, hz: 8 });
	} else {
		displays.push({ d: makeDisplay(1024, 512, -0.03, -0.005, panelW * 0.78, panelW * 0.39, panel, depth), draw: drawSixPack, hz: 30 });
	}
	return {
		displays,
		kind,
		setGain(gain) { for (const x of displays) x.d.mat.color.setScalar(gain); },
		update(dt, t, extra, active) {
			for (const x of displays) {
				x.d.t += dt;
				const hz = active ? x.hz : 2;
				if (x.d.t < 1 / hz) continue;
				x.d.t = 0;
				x.draw(x.d, t, extra);
				x.d.tex.needsUpdate = true;
			}
		},
	};
}

// ------------------------------------------------------------------ autopilot control panel (A320 FCU / 737 MCP)
function seg(g, s, x, y, size, col = '#ff9d2e', align = 'center') {
	g.font = `700 ${size}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle';
	g.fillStyle = 'rgba(255,157,46,0.08)'; g.fillText(s.replace(/[0-9]/g, '8'), x, y);
	g.fillStyle = col; g.fillText(s, x, y);
}
function drawFCU(d, t, x) {
	const { g, w: W, h: H } = d;
	const ap = x.ap || {};
	const airbus = !!x.cfg.fbw;
	g.fillStyle = airbus ? '#56616b' : '#5d6267'; g.fillRect(0, 0, W, H);
	g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, H - 4, W, 4);
	const win = (cx, w, label, value, lit) => {
		txt(g, label, cx, H * 0.14, 15, '#e9edf0', 'center', '700');
		g.fillStyle = '#060707'; g.fillRect(cx - w / 2, H * 0.24, w, H * 0.32);
		seg(g, value, cx, H * 0.41, 34, lit === false ? '#5b3a17' : '#ff9d2e');
		// knob below the window
		const kr = H * 0.15;
		const gr = g.createRadialGradient(cx - kr * 0.3, H * 0.76 - kr * 0.3, 2, cx, H * 0.76, kr);
		gr.addColorStop(0, '#5a5f66'); gr.addColorStop(1, '#16181b');
		g.fillStyle = gr; g.beginPath(); g.arc(cx, H * 0.76, kr, 0, 7); g.fill();
		g.strokeStyle = '#0a0b0c'; g.lineWidth = 2; g.stroke();
	};
	const btn = (cx, cy, label, on, w = 70) => {
		g.fillStyle = '#2b3036'; g.fillRect(cx - w / 2, cy - 18, w, 36);
		g.strokeStyle = '#15181b'; g.lineWidth = 2; g.strokeRect(cx - w / 2, cy - 18, w, 36);
		txt(g, label, cx, cy + 5, 13, '#e9edf0', 'center', '700');
		g.fillStyle = on ? '#3dff6e' : '#1d2a20'; g.fillRect(cx - w * 0.3, cy - 13, w * 0.6, 5);
	};
	const spd = String(Math.round(ap.spdTarget || t.ias)).padStart(3, '0');
	const hdg = ap.locCap ? '---' : String(Math.round(ap.hdgTarget ?? t.heading) % 360).padStart(3, '0');
	const alt = String(Math.round(ap.altTarget ?? Math.round(t.alt / 100) * 100)).padStart(5, '0');
	const vsOn = ap.engaged && ap.vert === 'V/S';
	const vs = vsOn ? ((ap.altTarget * 0.3048 > (x.pos ? x.pos.y : 0) ? '+' : '-') + String(ap.vsSel).padStart(4, '0')) : '-----';
	if (airbus) {
		win(W * 0.1, 120, 'SPD', ap.athr ? spd : '---', true);
		btn(W * 0.21, H * 0.76, 'LOC', ap.appArmed && !ap.gsCap || ap.locCap);
		win(W * 0.32, 120, 'HDG', hdg);
		btn(W * 0.44, H * 0.45, 'AP1', ap.engaged); btn(W * 0.53, H * 0.45, 'AP2', false);
		btn(W * 0.485, H * 0.78, 'A/THR', ap.athr, 80);
		win(W * 0.66, 150, 'ALT', alt);
		btn(W * 0.66 + 105, H * 0.76, 'EXPED', false, 74);
		win(W * 0.88, 150, 'V/S', vs, vsOn);
		btn(W * 0.88 - 115, H * 0.78, 'APPR', ap.appArmed || ap.gsCap, 70);
	} else {
		btn(W * 0.05, H * 0.45, 'A/T ARM', ap.athr, 78);
		win(W * 0.16, 110, 'IAS/MACH', ap.athr ? spd : '   ', ap.athr);
		btn(W * 0.27, H * 0.3, 'SPEED', ap.athr && !ap.rollout, 70); btn(W * 0.27, H * 0.7, 'LVL CHG', false, 70);
		win(W * 0.38, 110, 'HEADING', hdg);
		btn(W * 0.48, H * 0.3, 'HDG SEL', ap.engaged && !ap.locCap, 70); btn(W * 0.48, H * 0.7, 'APP', ap.appArmed || ap.gsCap, 70);
		win(W * 0.6, 140, 'ALTITUDE', alt);
		btn(W * 0.705, H * 0.3, 'ALT HLD', ap.engaged && ap.vert === 'ALT', 70); btn(W * 0.705, H * 0.7, 'V/S', vsOn, 70);
		win(W * 0.82, 130, 'VERT SPEED', vs, vsOn);
		btn(W * 0.94, H * 0.3, 'CMD A', ap.engaged, 70); btn(W * 0.94, H * 0.7, 'CMD B', false, 70);
	}
}

// ------------------------------------------------------------------ lower ECAM / EICAS: wheel & gear page
function drawSD(d, t, x) {
	const { g, w: W, h: H } = d;
	g.fillStyle = '#04060a'; g.fillRect(0, 0, W, H);
	txt(g, x.cfg.fbw ? 'WHEEL' : 'GEAR / BRAKES', W * 0.5, 26, 22, WHT, 'center', '700');
	g.strokeStyle = WHT; g.lineWidth = 1.5; g.beginPath(); g.moveTo(W * 0.38, 40); g.lineTo(W * 0.62, 40); g.stroke();
	// spoilers
	for (let i = 0; i < 5; i++) for (const s of [-1, 1]) {
		const px = W * 0.5 + s * (40 + i * 26), py = 74;
		g.strokeStyle = t.airbrake > 0.05 ? GRN : '#2a6b3a'; g.lineWidth = 3;
		g.beginPath(); g.moveTo(px - 9, py + 6); g.lineTo(px + 9, py + 6); g.stroke();
		if (t.airbrake > 0.05) { g.beginPath(); g.moveTo(px, py + 4); g.lineTo(px, py - 14); g.moveTo(px - 6, py - 8); g.lineTo(px, py - 14); g.lineTo(px + 6, py - 8); g.stroke(); }
	}
	// gear triangles
	const gearCol = t.gearPos > 0.99 ? GRN : t.gearPos < 0.01 ? null : '#ff3b30';
	const tri = (cx, cy, lab) => {
		g.strokeStyle = gearCol || '#3a3f45'; g.fillStyle = gearCol || 'transparent'; g.lineWidth = 2;
		for (const o of [-14, 14]) { g.beginPath(); g.moveTo(cx + o - 11, cy - 9); g.lineTo(cx + o + 11, cy - 9); g.lineTo(cx + o, cy + 10); g.closePath(); if (gearCol) g.fill(); else g.stroke(); }
		txt(g, lab, cx, cy + 28, 14, CYAN);
	};
	tri(W * 0.5, H * 0.32, 'NOSE'); tri(W * 0.22, H * 0.5, 'L MAIN'); tri(W * 0.78, H * 0.5, 'R MAIN');
	txt(g, t.gearPos > 0.99 ? 'LDG GEAR DN' : t.gearPos < 0.01 ? 'LDG GEAR UP' : 'GEAR TRANSIT', W * 0.5, H * 0.5, 16, gearCol || WHT);
	// brake temperatures warm with braking
	d.bt = (d.bt ?? 60) + ((t.brake > 0.05 && t.gs > 5 ? 700 : 60) - (d.bt ?? 60)) * 0.004;
	const bt = Math.round(d.bt / 5) * 5;
	txt(g, 'BRAKES  °C', W * 0.5, H * 0.66, 15, WHT);
	[[0.12, 'REL'], [0.3, ''], [0.7, ''], [0.88, 'REL']].forEach(([fx], i) => {
		g.strokeStyle = '#555c66'; g.lineWidth = 1.5; g.strokeRect(W * fx - 34, H * 0.7, 68, 34);
		txt(g, String(bt + (i % 2) * 5), W * fx, H * 0.7 + 18, 20, bt > 300 ? AMB : GRN, 'center', '700');
	});
	if (t.parkBrake) txt(g, 'PARK BRK', W * 0.5, H * 0.79, 17, AMB, 'center', '700');
	// status strip
	g.strokeStyle = '#2b3036'; g.beginPath(); g.moveTo(0, H * 0.86); g.lineTo(W, H * 0.86); g.stroke();
	const sat = Math.round(15 - (x.pos ? x.pos.y : 0) * 0.0065);
	txt(g, `TAT ${sat + 2 >= 0 ? '+' : ''}${sat + 2} °C`, W * 0.16, H * 0.9, 14, WHT, 'center', '500');
	txt(g, `SAT ${sat >= 0 ? '+' : ''}${sat} °C`, W * 0.16, H * 0.96, 14, WHT, 'center', '500');
	const now = new Date();
	txt(g, `${String(now.getUTCHours()).padStart(2, '0')} H ${String(now.getUTCMinutes()).padStart(2, '0')}`, W * 0.5, H * 0.93, 17, GRN, 'center', '700');
	txt(g, `GW ${Math.round((x.cfg.mass || 60000) / 100) * 100} KG`, W * 0.84, H * 0.93, 14, GRN, 'center', '600');
}

// ------------------------------------------------------------------ MCDU / FMS CDU flight plan page
function drawMCDU(d, t, x) {
	const { g, w: W, h: H } = d;
	g.fillStyle = '#020403'; g.fillRect(0, 0, W, H);
	const lh = H / 14, cw = W / 24;
	const line = (r, s, col = WHT, align = 'left', size = lh * 0.78) => txt(g, s, align === 'left' ? cw * 0.5 : align === 'right' ? W - cw * 0.5 : W / 2, lh * (r + 0.6), size, col, align, '600');
	const ap = (x.navText || 'SKW 0.0NM').split(' ')[0];
	const nm = parseFloat((x.navText || '').split(' ')[1]) || 0;
	line(0, ' F-PLN', WHT, 'center');
	line(1, ` FROM`, WHT); line(1, `${ap}D`, WHT, 'right');
	line(2, ` ${ap}`, GRN); line(2, `${String(Math.round(t.ias)).padStart(3, ' ')}/ ${Math.round(t.alt / 100) * 100}`, GRN, 'right');
	const legs = [['CF10', 12], ['FF10', 8], [`RW10`, 0]];
	legs.forEach(([wp, off], i) => {
		const dist = Math.max(0, nm - off * 0.0).toFixed(0);
		line(3 + i * 2, `  C100°   ${i ? '' : dist + 'NM'}`, WHT, 'left', lh * 0.6);
		line(4 + i * 2, ` ${wp}`, i === 0 ? GRN : WHT);
		line(4 + i * 2, `${i === 2 ? '138' : '160'}/  ${i === 2 ? ' 100' : (2000 - i * 700)}`, CYAN, 'right');
	});
	line(10, ' ------END OF F-PLN------', WHT, 'left', lh * 0.62);
	line(11, ' DEST   TIME  DIST  EFOB', WHT, 'left', lh * 0.62);
	line(12, ` ${ap}10  ${String(Math.round(nm / Math.max(t.gs, 60) * 60)).padStart(4, '0')}  ${String(Math.round(nm)).padStart(4, ' ')}   4.8`, WHT, 'left', lh * 0.7);
	g.fillStyle = 'rgba(80,120,90,0.12)'; g.fillRect(0, lh * 13, W, lh);
}

// ------------------------------------------------------------------ general-aviation radio stack
function drawRadio(d, t, x) {
	const { g, w: W, h: H } = d;
	g.fillStyle = '#16181b'; g.fillRect(0, 0, W, H);
	const unit = (y, h) => { const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#2c3035'); gr.addColorStop(1, '#1d2024'); g.fillStyle = gr; g.fillRect(8, y + 4, W - 16, h - 8); g.strokeStyle = '#0c0d0f'; g.lineWidth = 3; g.strokeRect(8, y + 4, W - 16, h - 8); };
	const knob = (cx, cy, r) => { const gr = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r); gr.addColorStop(0, '#666b72'); gr.addColorStop(1, '#141518'); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill(); };
	const lcd = (cx, cy, s, size = 34, col = '#7dff8e') => { g.fillStyle = '#071008'; g.fillRect(cx - size * 2.1, cy - size * 0.62, size * 4.2, size * 1.24); txt(g, s, cx, cy, size, col, 'center', '700'); };
	// audio panel
	unit(0, H * 0.16);
	['COM1', 'COM2', 'NAV1', 'NAV2', 'MKR', 'SPKR'].forEach((s, i) => {
		const cx = 52 + i * 78;
		g.fillStyle = '#0f1113'; g.fillRect(cx - 30, H * 0.05, 60, H * 0.07);
		txt(g, s, cx, H * 0.085, 13, '#dfe3e7', 'center', '700');
		g.fillStyle = i === 0 || i === 2 || i === 5 ? '#55ff6a' : '#1d3320'; g.fillRect(cx - 12, H * 0.042, 24, 4);
	});
	// COM / NAV
	unit(H * 0.16, H * 0.3);
	txt(g, 'COM', 36, H * 0.24, 13, '#cfd5da', 'left', '700');
	lcd(W * 0.3, H * 0.25, '118.300', 30); lcd(W * 0.7, H * 0.25, '121.500', 30, '#5fcf70');
	txt(g, 'NAV', 36, H * 0.38, 13, '#cfd5da', 'left', '700');
	lcd(W * 0.3, H * 0.385, '110.30', 30); lcd(W * 0.7, H * 0.385, '113.90', 30, '#5fcf70');
	knob(W - 40, H * 0.31, 22);
	// GPS mini-map strip
	unit(H * 0.46, H * 0.32);
	g.fillStyle = '#0a1a12'; g.fillRect(30, H * 0.49, W - 120, H * 0.26);
	txt(g, (x.navText || ''), 40, H * 0.52, 16, MAG, 'left', '700');
	txt(g, `GS ${Math.round(t.gs)}KT   TRK ${String(Math.round(t.track ?? t.heading)).padStart(3, '0')}°`, 40, H * 0.58, 15, WHT, 'left', '600');
	g.strokeStyle = MAG; g.lineWidth = 3; g.beginPath(); g.moveTo(W * 0.42, H * 0.73); g.lineTo(W * 0.6, H * 0.63); g.stroke();
	g.fillStyle = WHT; g.beginPath(); g.moveTo(W * 0.42, H * 0.7); g.lineTo(W * 0.4, H * 0.74); g.lineTo(W * 0.44, H * 0.74); g.fill();
	knob(W - 52, H * 0.6, 26);
	// transponder
	unit(H * 0.78, H * 0.22);
	txt(g, 'XPDR', 36, H * 0.86, 13, '#cfd5da', 'left', '700');
	lcd(W * 0.4, H * 0.88, '7000', 30);
	txt(g, 'ALT', W * 0.62, H * 0.86, 15, '#7dff8e', 'left', '700');
	txt(g, `FL${String(Math.max(0, Math.round(t.alt / 100))).padStart(3, '0')}`, W * 0.62, H * 0.92, 15, '#7dff8e', 'left', '700');
	knob(W - 40, H * 0.89, 18);
}

// ------------------------------------------------------------------ fighter up-front controller scratchpad
function drawUFC(d, t, x) {
	const { g, w: W, h: H } = d;
	g.fillStyle = '#081208'; g.fillRect(0, 0, W, H);
	const ap = x.ap || {};
	const L = [
		`UHF 251.00   TCN 077X`,
		`STPT ${(x.navText || '').split(' ')[0] || 'SKW'}  ${(x.navText || '').split(' ')[1] || ''}`,
		`ALT ${String(Math.round(t.alt)).padStart(5, ' ')}  M${t.mach.toFixed(2)}`,
		`${ap.engaged ? 'A/P ' + (ap.vert || '') + ' ' + (ap.lat || '') : 'A/P OFF'}`,
	];
	L.forEach((s, i) => txt(g, s, 14, H * (0.15 + i * 0.23), H * 0.17, '#7dff6a', 'left', '700'));
}

// ------------------------------------------------------------------ flexible avionics layout
const DRAW = { pfd: drawPFD, nd: drawND, eng: drawEng, six: drawSixPack, fcu: drawFCU, sd: drawSD, mcdu: drawMCDU, radio: drawRadio, ufc: drawUFC };

// slots: [{ type, res: [W, H], hz, mounts: [{ parent, x, y, z, w, h, rx, ry, uv: [u0, v0, u1, v1], circle }] }]
// Every mount of a slot shows the same canvas (captain and first officer share one texture).
export function createAvionics(cfg, slots) {
	const displays = [];
	for (const s of slots) {
		const [W, H] = s.res || [512, 512];
		const c = document.createElement('canvas');
		c.width = W; c.height = H;
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.anisotropy = 8;
		const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
		for (const m of s.mounts) {
			const geo = m.circle ? new THREE.CircleGeometry(m.circle, 48) : new THREE.PlaneGeometry(m.w, m.h);
			if (m.uv) {
				const uv = geo.attributes.uv;
				for (let i = 0; i < uv.count; i++) uv.setXY(i, m.uv[0] + uv.getX(i) * (m.uv[2] - m.uv[0]), m.uv[1] + uv.getY(i) * (m.uv[3] - m.uv[1]));
			}
			const mesh = new THREE.Mesh(geo, mat);
			mesh.position.set(m.x || 0, m.y || 0, m.z || 0);
			mesh.rotation.set(m.rx || 0, m.ry || 0, 0);
			m.parent.add(mesh);
		}
		displays.push({ d: { c, g: c.getContext('2d'), tex, mat, w: W, h: H, t: Math.random() }, draw: DRAW[s.type], hz: s.hz || 10 });
	}
	return {
		displays,
		setGain(gain) { for (const x of displays) x.d.mat.color.setScalar(gain); },
		update(dt, t, extra, active) {
			for (const x of displays) {
				x.d.t += dt;
				const hz = active ? x.hz : Math.min(x.hz, 2);
				if (x.d.t < 1 / hz) continue;
				x.d.t = 0;
				x.draw(x.d, t, extra);
				x.d.tex.needsUpdate = true;
			}
		},
	};
}
