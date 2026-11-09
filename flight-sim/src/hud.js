// Head-up display & instruments drawn on a 2D canvas overlay.
import { airports, toRunwayLocal } from './world.js';

const GREEN = '#86ffa8';
const AMBER = '#ffc048';
const RED = '#ff4b3e';
const D2R = Math.PI / 180;

export class HUD {
	constructor(canvas) {
		this.cv = canvas;
		this.g = canvas.getContext('2d');
		this.visible = true;
		this.toasts = [];
		this.fps = 60;
	}

	resize(w, h, dpr) {
		this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
		this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
		this.w = w; this.h = h; this.dpr = dpr;
	}

	toast(text, color = '#fff', dur = 2.5) {
		this.toasts.push({ text, color, t: dur, dur });
		if (this.toasts.length > 4) this.toasts.shift();
	}

	text(s, x, y, size = 14, color = GREEN, align = 'center', base = 'middle', weight = '600') {
		const g = this.g;
		g.font = `${weight} ${size}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
		g.textAlign = align; g.textBaseline = base;
		g.fillStyle = color;
		g.fillText(s, x, y);
	}

	line(x0, y0, x1, y1) { const g = this.g; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }

	draw(t, opts) {
		const g = this.g;
		const { w, h } = this;
		g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		g.clearRect(0, 0, w, h);
		// toasts always draw
		this.drawToasts(opts.dt);
		if (!this.visible || !t) return;
		const s = Math.min(1.25, Math.max(0.7, Math.min(w, h) / 820));
		g.save();
		g.shadowColor = 'rgba(0,0,0,0.75)';
		g.shadowBlur = 3;
		g.lineWidth = 1.6 * s;
		g.strokeStyle = GREEN;
		g.fillStyle = GREEN;
		const cx = w / 2, cy = h * 0.47;
		const pxPerDeg = (h / 2) / Math.tan(opts.fov * D2R / 2) * D2R;

		this.drawPitchLadder(t, cx, cy, pxPerDeg, s);
		this.drawFPV(t, opts, cx, cy, pxPerDeg, s);
		this.drawHeading(t, cx, 34 * s, s, opts);
		this.drawSpeedTape(t, cx - Math.min(w * 0.3, 330 * s), cy, s, opts);
		this.drawAltTape(t, cx + Math.min(w * 0.3, 330 * s), cy, s);
		this.drawBank(t, cx, cy, s);
		this.drawSystems(t, 18 * s, h - 18 * s, s, opts);
		this.drawWarnings(t, cx, cy + 150 * s, s, opts);
		this.drawApproach(t, opts, cx, cy, s);
		this.drawMap(t, opts, w - 110 * s, h - 110 * s, 92 * s, s);
		g.restore();
		// fps / clock
		this.text(`${Math.round(this.fps)} FPS  ${opts.clock}`, w - 10, 12, 11, 'rgba(255,255,255,0.65)', 'right', 'middle', '500');
	}

	drawToasts(dt) {
		let y = Math.max(96, this.h * 0.17);
		const g = this.g;
		for (const m of this.toasts) {
			m.t -= dt || 0;
			const a = Math.max(0, Math.min(1, m.t / 0.4, (m.dur - m.t) / 0.2 + 0.3));
			g.globalAlpha = a;
			g.font = '700 16px Inter, "Segoe UI", system-ui, sans-serif';
			const w = g.measureText(m.text).width + 28;
			g.fillStyle = 'rgba(6,12,20,0.62)';
			g.beginPath();
			if (g.roundRect) g.roundRect(this.w / 2 - w / 2, y - 14, w, 28, 14); else g.rect(this.w / 2 - w / 2, y - 14, w, 28);
			g.fill();
			g.fillStyle = m.color; g.textAlign = 'center'; g.textBaseline = 'middle';
			g.fillText(m.text, this.w / 2, y + 1);
			y += 34;
		}
		this.g.globalAlpha = 1;
		this.toasts = this.toasts.filter((m) => m.t > 0);
	}

	drawPitchLadder(t, cx, cy, ppd, s) {
		const g = this.g;
		g.save();
		g.beginPath();
		g.rect(cx - 230 * s, cy - 210 * s, 460 * s, 420 * s);
		g.clip();
		g.translate(cx, cy);
		g.rotate(-t.bank * D2R);
		const p = t.pitch;
		// horizon
		const hy = p * ppd;
		g.lineWidth = 2 * s;
		this.line(-420 * s, hy, -45 * s, hy); this.line(45 * s, hy, 420 * s, hy);
		g.lineWidth = 1.5 * s;
		for (let a = -90; a <= 90; a += 5) {
			if (a === 0) continue;
			const y = (p - a) * ppd;
			if (Math.abs(y) > 260 * s) continue;
			const half = (a % 10 === 0 ? 70 : 42) * s;
			const gap = 26 * s;
			if (a < 0) g.setLineDash([7 * s, 5 * s]); else g.setLineDash([]);
			const tick = (a > 0 ? 8 : -8) * s;
			g.beginPath();
			g.moveTo(-half, y + tick); g.lineTo(-half, y); g.lineTo(-gap, y);
			g.moveTo(gap, y); g.lineTo(half, y); g.lineTo(half, y + tick);
			g.stroke();
			if (a % 10 === 0) {
				this.text(String(Math.abs(a)), -half - 16 * s, y, 12 * s);
				this.text(String(Math.abs(a)), half + 16 * s, y, 12 * s);
			}
		}
		g.setLineDash([]);
		g.restore();
		// boresight "W"
		g.lineWidth = 2 * s;
		g.beginPath();
		g.moveTo(cx - 34 * s, cy); g.lineTo(cx - 16 * s, cy); g.lineTo(cx - 8 * s, cy + 9 * s); g.lineTo(cx, cy);
		g.lineTo(cx + 8 * s, cy + 9 * s); g.lineTo(cx + 16 * s, cy); g.lineTo(cx + 34 * s, cy);
		g.stroke();
	}

	drawFPV(t, opts, cx, cy, ppd, s) {
		const g = this.g;
		const v = opts.velBody;
		if (!v || t.gs < 20) return;
		const sp = Math.hypot(v.x, v.y, v.z);
		if (sp < 5) return;
		const ay = Math.atan2(-v.y, -v.z) / D2R; // degrees below boresight
		const bx = Math.atan2(v.x, -v.z) / D2R;
		const x = cx + Math.max(-20, Math.min(20, bx)) * ppd;
		const y = cy + Math.max(-20, Math.min(20, ay)) * ppd;
		const r = 8 * s;
		g.lineWidth = 2 * s;
		g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
		this.line(x - r - 12 * s, y, x - r, y); this.line(x + r, y, x + r + 12 * s, y); this.line(x, y - r, x, y - r - 9 * s);
		// energy caret (acceleration along the path)
		const acc = opts.accelAlong || 0;
		const ey = y - acc / 9.81 * 60 * s;
		g.beginPath(); g.moveTo(x - r - 20 * s, ey - 5 * s); g.lineTo(x - r - 14 * s, ey); g.lineTo(x - r - 20 * s, ey + 5 * s); g.stroke();
	}

	drawHeading(t, cx, y, s, opts) {
		const g = this.g;
		const width = 340 * s, ppd = 4.2 * s;
		g.save();
		g.beginPath(); g.rect(cx - width / 2, y - 22 * s, width, 50 * s); g.clip();
		const hd = t.heading;
		for (let a = Math.floor((hd - 45) / 5) * 5; a <= hd + 45; a += 5) {
			const x = cx + (a - hd) * ppd;
			const big = a % 10 === 0;
			this.line(x, y + 12 * s, x, y + (big ? 2 : 7) * s);
			if (big) {
				const aa = ((a % 360) + 360) % 360;
				const lbl = aa === 0 ? 'N' : aa === 90 ? 'E' : aa === 180 ? 'S' : aa === 270 ? 'W' : String(aa / 10).padStart(2, '0');
				this.text(lbl, x, y - 8 * s, 12 * s);
			}
		}
		// bearing bug to nearest airport
		if (opts.navBearing != null) {
			let d = ((opts.navBearing - hd + 540) % 360) - 180;
			d = Math.max(-40, Math.min(40, d));
			const x = cx + d * ppd;
			g.fillStyle = '#ff9df5';
			g.beginPath(); g.moveTo(x, y + 13 * s); g.lineTo(x - 6 * s, y + 21 * s); g.lineTo(x + 6 * s, y + 21 * s); g.fill();
		}
		g.restore();
		g.strokeRect(cx - 24 * s, y - 20 * s, 48 * s, 22 * s);
		g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(cx - 24 * s, y - 20 * s, 48 * s, 22 * s);
		this.text(String(Math.round(hd) % 360).padStart(3, '0'), cx, y - 9 * s, 14 * s);
		this.text(`TRK ${String(Math.round(t.track) % 360).padStart(3, '0')}`, cx, y + 34 * s, 11 * s);
	}

	drawSpeedTape(t, x, cy, s, opts) {
		const g = this.g;
		const hh = 170 * s, ppk = 2.4 * s;
		const v = t.ias;
		const cfg = opts.cfg;
		g.save();
		g.beginPath(); g.rect(x - 40 * s, cy - hh, 70 * s, hh * 2); g.clip();
		// colour bands
		const band = (a, b, col) => {
			const y0 = cy - (b - v) * ppk, y1 = cy - (a - v) * ppk;
			g.fillStyle = col; g.fillRect(x + 20 * s, y0, 5 * s, y1 - y0);
		};
		band(0, cfg.vs, 'rgba(255,75,62,0.85)');
		band(cfg.vs, cfg.vfe, 'rgba(255,255,255,0.8)');
		band(cfg.vfe, cfg.vno, 'rgba(134,255,168,0.8)');
		band(cfg.vno, cfg.vne, 'rgba(255,192,72,0.85)');
		band(cfg.vne, cfg.vne + 400, 'rgba(255,75,62,0.85)');
		g.fillStyle = GREEN;
		for (let k = Math.floor((v - 80) / 10) * 10; k <= v + 80; k += 10) {
			if (k < 0) continue;
			const y = cy - (k - v) * ppk;
			this.line(x + 8 * s, y, x + 18 * s, y);
			if (k % 20 === 0) this.text(String(k), x - 4 * s, y, 12 * s, GREEN, 'right');
		}
		// speed trend (10 s)
		const trend = (opts.accelAlong || 0) * 10 * 1.94384;
		if (Math.abs(trend) > 2) {
			g.strokeStyle = '#ff9df5';
			this.line(x + 13 * s, cy, x + 13 * s, cy - trend * ppk);
		}
		g.restore();
		g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x - 46 * s, cy - 13 * s, 52 * s, 26 * s);
		g.strokeRect(x - 46 * s, cy - 13 * s, 52 * s, 26 * s);
		const col = v < cfg.vs * 1.05 && !t.onGround ? RED : v > cfg.vne ? RED : GREEN;
		this.text(String(Math.round(v)), x - 4 * s, cy, 16 * s, col, 'right');
		this.text('KIAS', x - 10 * s, cy - hh - 12 * s, 11 * s);
		this.text(`GS ${Math.round(t.gs)}`, x - 10 * s, cy + hh + 14 * s, 12 * s);
		if (t.mach > 0.3 || opts.cfg.engine === 'jet') this.text(`M ${t.mach.toFixed(2)}`, x - 10 * s, cy + hh + 30 * s, 12 * s);
		this.text(`G ${t.nz.toFixed(1)}`, x - 10 * s, cy + hh + 46 * s, 12 * s, t.nz > opts.cfg.gLimit[0] * 0.9 ? RED : GREEN);
		this.text(`α ${(t.ias < 30 ? 0 : t.alpha).toFixed(1)}`, x - 10 * s, cy + hh + 62 * s, 12 * s, t.stall > 0.5 ? AMBER : GREEN);
	}

	drawAltTape(t, x, cy, s) {
		const g = this.g;
		const hh = 170 * s, ppf = 0.19 * s;
		const a = t.alt;
		g.save();
		g.beginPath(); g.rect(x - 30 * s, cy - hh, 90 * s, hh * 2); g.clip();
		for (let k = Math.floor((a - 1000) / 100) * 100; k <= a + 1000; k += 100) {
			const y = cy - (k - a) * ppf;
			this.line(x - 22 * s, y, x - (k % 500 === 0 ? 10 : 15) * s, y);
			if (k % 500 === 0) this.text(String(k), x - 6 * s, y, 12 * s, GREEN, 'left');
		}
		// ground marker
		const gy = cy - (a - t.agl - a) * ppf;
		if (gy < cy + hh) {
			g.fillStyle = 'rgba(160,100,40,0.55)';
			g.fillRect(x - 22 * s, gy, 60 * s, hh * 2);
		}
		g.restore();
		g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x - 8 * s, cy - 13 * s, 70 * s, 26 * s);
		g.strokeRect(x - 8 * s, cy - 13 * s, 70 * s, 26 * s);
		this.text(String(Math.round(a / 10) * 10), x + 56 * s, cy, 16 * s, GREEN, 'right');
		this.text('FT', x + 20 * s, cy - hh - 12 * s, 11 * s);
		// VSI
		const vs = t.vs;
		const vx = x + 74 * s;
		const vy = cy - Math.max(-1, Math.min(1, vs / 3000)) * 120 * s;
		this.line(vx, cy - 120 * s, vx, cy + 120 * s);
		for (const m of [-2000, -1000, 0, 1000, 2000]) { const yy = cy - m / 3000 * 120 * s; this.line(vx - 4 * s, yy, vx + 4 * s, yy); }
		g.lineWidth = 3 * s;
		this.line(vx, cy, vx + 9 * s, vy);
		g.lineWidth = 1.6 * s;
		this.text(`${vs > 0 ? '+' : ''}${Math.round(vs / 10) * 10}`, vx + 4 * s, cy + 136 * s, 12 * s, GREEN, 'center');
		if (t.agl < 2500) this.text(`R ${Math.round(t.agl)}`, x + 24 * s, cy + hh + 14 * s, 13 * s, t.agl < 200 ? AMBER : GREEN);
	}

	drawBank(t, cx, cy, s) {
		const g = this.g;
		const r = 150 * s;
		const top = cy - r;
		for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
			const ang = (a - 90) * D2R;
			const l = (a % 30 === 0 ? 12 : 7) * s;
			this.line(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, cx + Math.cos(ang) * (r + l), cy + Math.sin(ang) * (r + l));
		}
		const b = Math.max(-65, Math.min(65, t.bank));
		const ang = (-b - 90) * D2R;
		const px = cx + Math.cos(ang) * (r - 2 * s), py = cy + Math.sin(ang) * (r - 2 * s);
		g.save();
		g.translate(px, py); g.rotate(-b * D2R);
		g.beginPath(); g.moveTo(0, 0); g.lineTo(-7 * s, 11 * s); g.lineTo(7 * s, 11 * s); g.closePath(); g.stroke();
		// slip/skid
		const sk = Math.max(-1, Math.min(1, t.beta / 8)) * 12 * s;
		g.fillRect(-8 * s + sk, 14 * s, 16 * s, 3.5 * s);
		g.restore();
		void top;
	}

	drawSystems(t, x, y, s, opts) {
		const g = this.g;
		const L = 15 * s;
		let yy = y - L * 7.5;
		g.fillStyle = 'rgba(0,0,0,0.42)';
		g.fillRect(x - 8 * s, yy - 14 * s, 200 * s, L * 8.2);
		g.fillStyle = GREEN;
		const row = (label, val, col = GREEN) => { this.text(label, x, yy, 12 * s, 'rgba(200,255,215,0.8)', 'left'); this.text(val, x + 180 * s, yy, 12 * s, col, 'right'); yy += L; };
		// throttle bar
		this.text('THR', x, yy, 12 * s, 'rgba(200,255,215,0.8)', 'left');
		g.strokeRect(x + 40 * s, yy - 5 * s, 100 * s, 10 * s);
		g.fillRect(x + 40 * s, yy - 5 * s, 100 * s * opts.throttle, 10 * s);
		this.text(`${Math.round(opts.throttle * 100)}%`, x + 180 * s, yy, 12 * s, GREEN, 'right');
		yy += L;
		if (opts.cfg.engine === 'prop') row('RPM', String(Math.round(t.rpm)));
		else row('N1', `${t.rpm.toFixed(0)}%${t.ab > 0.3 ? '  A/B' : ''}`, t.ab > 0.3 ? AMBER : GREEN);
		row('THRUST', `${(t.thrust / 1000).toFixed(1)} kN`);
		const flapDeg = Math.round(t.flap * (opts.cfg.engine === 'prop' ? 30 : 20));
		row('FLAPS', `${flapDeg}°`, t.flap > 0.01 ? AMBER : GREEN);
		// gear
		this.text('GEAR', x, yy, 12 * s, 'rgba(200,255,215,0.8)', 'left');
		const gs = t.gearPos;
		const gc = gs > 0.99 ? '#3dff6e' : gs < 0.01 ? 'rgba(255,255,255,0.25)' : RED;
		for (let i = 0; i < 3; i++) { g.fillStyle = gc; g.fillRect(x + 128 * s + i * 18 * s, yy - 5 * s, 12 * s, 10 * s); }
		g.fillStyle = GREEN;
		yy += L;
		row('BRAKES', t.parkBrake ? 'PARK' : t.brake > 0.05 ? 'ON' : 'OFF', t.parkBrake || t.brake > 0.05 ? AMBER : GREEN);
		if (opts.cfg.engine === 'jet') row('SPD BRK', t.airbrake > 0.05 ? 'EXT' : 'RET', t.airbrake > 0.05 ? AMBER : GREEN);
		row('TRIM', `${t.trim >= 0 ? 'UP ' : 'DN '}${Math.abs(Math.round(t.trim * 100))}`);
	}

	drawWarnings(t, cx, y, s, opts) {
		const blink = (opts.time * 2.5) % 1 < 0.6;
		const list = [];
		if (t.stall > 0.6 && !t.onGround) list.push(['STALL', RED]);
		if (t.sinkWarning) list.push(['PULL UP', RED]);
		else if (t.terrainWarn) list.push(['TERRAIN', AMBER]);
		if (t.ias > opts.cfg.vne) list.push(['OVERSPEED', RED]);
		if (t.gearWarn) list.push(['GEAR', RED]);
		if (t.flap > 0.05 && t.ias > opts.cfg.vfe) list.push(['FLAP OVERSPEED', AMBER]);
		if (Math.abs(t.bank) > 50 && t.agl < 1500 && !t.onGround) list.push(['BANK ANGLE', AMBER]);
		if (opts.paused) list.push(['PAUSED', '#ffffff']);
		list.forEach(([txt, col], i) => {
			if (!blink && col === RED) return;
			const g = this.g;
			g.font = `800 ${20 * s}px ui-monospace, Menlo, monospace`;
			const w = g.measureText(txt).width + 22 * s;
			g.fillStyle = 'rgba(0,0,0,0.5)';
			g.fillRect(cx - w / 2, y + i * 32 * s - 14 * s, w, 28 * s);
			g.strokeStyle = col; g.strokeRect(cx - w / 2, y + i * 32 * s - 14 * s, w, 28 * s);
			this.text(txt, cx, y + i * 32 * s, 20 * s, col, 'center', 'middle', '800');
			g.strokeStyle = GREEN;
		});
	}

	drawApproach(t, opts, cx, cy, s) {
		const ap = opts.approach;
		if (!ap) return;
		const g = this.g;
		// localizer (horizontal) & glideslope (vertical) deviation scales
		const lx = cx, ly = cy + 205 * s;
		const sc = 60 * s;
		g.fillStyle = 'rgba(0,0,0,0.35)';
		g.fillRect(lx - sc * 2.4, ly - 10 * s, sc * 4.8, 20 * s);
		g.fillStyle = GREEN;
		for (let i = -2; i <= 2; i++) { g.beginPath(); g.arc(lx + i * sc, ly, 3 * s, 0, Math.PI * 2); g.stroke(); }
		const loc = Math.max(-2.3, Math.min(2.3, ap.loc / 1.25));
		g.fillStyle = '#ff9df5';
		g.beginPath(); g.moveTo(lx + loc * sc, ly - 8 * s); g.lineTo(lx + loc * sc + 7 * s, ly); g.lineTo(lx + loc * sc, ly + 8 * s); g.lineTo(lx + loc * sc - 7 * s, ly); g.fill();
		const gx = cx + 262 * s, gy = cy;
		g.fillStyle = 'rgba(0,0,0,0.35)';
		g.fillRect(gx - 10 * s, gy - sc * 2.4, 20 * s, sc * 4.8);
		for (let i = -2; i <= 2; i++) { g.beginPath(); g.arc(gx, gy + i * sc, 3 * s, 0, Math.PI * 2); g.stroke(); }
		const gsd = Math.max(-2.3, Math.min(2.3, ap.gs / 0.35));
		g.fillStyle = '#ff9df5';
		g.beginPath(); g.moveTo(gx - 8 * s, gy + gsd * sc); g.lineTo(gx, gy + gsd * sc - 7 * s); g.lineTo(gx + 8 * s, gy + gsd * sc); g.lineTo(gx, gy + gsd * sc + 7 * s); g.fill();
		this.text(`ILS ${ap.name}  ${ap.dme.toFixed(1)} NM`, lx, ly + 22 * s, 12 * s, '#ff9df5');
	}

	drawMap(t, opts, x, y, r, s) {
		const g = this.g;
		g.save();
		g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
		g.fillStyle = 'rgba(4,12,10,0.6)'; g.fill();
		g.stroke();
		g.clip();
		const range = opts.mapRange; // metres to edge
		const k = r / range;
		const hd = t.heading * D2R;
		const ox = opts.pos.x, oz = opts.pos.z;
		const toScreen = (wx, wz) => {
			const dx = wx - ox, dz = wz - oz;
			// heading-up: rotate world so heading points up
			const rx = dx * Math.cos(hd) + dz * Math.sin(hd);
			const ry = -dx * Math.sin(hd) + dz * Math.cos(hd);
			return [x + rx * k, y + ry * k];
		};
		g.strokeStyle = 'rgba(134,255,168,0.25)';
		g.beginPath(); g.arc(x, y, r * 0.5, 0, Math.PI * 2); g.stroke();
		// coastline sketch from the cached map image
		if (opts.mapImage) {
			g.save();
			g.globalAlpha = 0.55;
			g.translate(x, y);
			g.rotate(-hd);
			const im = opts.mapImage;
			const sc = k * im.metresPerPixel;
			g.drawImage(im.canvas, (im.x0 - ox) * k, (im.z0 - oz) * k, im.canvas.width * sc, im.canvas.height * sc);
			g.restore();
		}
		g.lineWidth = 3 * s;
		for (const ap of airports) {
			const a = toScreen(ap.x - ap.dir.x * ap.length / 2, ap.z - ap.dir.z * ap.length / 2);
			const b = toScreen(ap.x + ap.dir.x * ap.length / 2, ap.z + ap.dir.z * ap.length / 2);
			g.strokeStyle = '#ffffff';
			this.line(a[0], a[1], b[0], b[1]);
			const c = toScreen(ap.x, ap.z);
			this.text(ap.id, c[0], c[1] - 10 * s, 10 * s, '#ff9df5');
		}
		g.restore();
		// aircraft symbol
		g.fillStyle = '#ffd34e';
		g.beginPath(); g.moveTo(x, y - 8 * s); g.lineTo(x - 6 * s, y + 6 * s); g.lineTo(x, y + 3 * s); g.lineTo(x + 6 * s, y + 6 * s); g.fill();
		this.text('N', x + Math.sin(-hd) * (r - 9 * s), y - Math.cos(-hd) * (r - 9 * s), 11 * s, '#fff');
		this.text(`${(range / 1852).toFixed(0)} NM`, x, y + r + 10 * s, 10 * s, 'rgba(255,255,255,0.7)');
		if (opts.navText) this.text(opts.navText, x, y - r - 12 * s, 11 * s, '#ff9df5');
	}
}

// Find an ILS-like approach solution to the nearest runway end ahead of the aircraft.
export function computeApproach(pos, heading) {
	let best = null;
	for (const ap of airports) {
		for (const end of [-1, 1]) {
			const l = toRunwayLocal(ap, pos.x, pos.z);
			// for end -1 landing direction is +u, threshold at u=-L/2
			const along = end < 0 ? -(l.u + ap.length / 2) : (l.u - ap.length / 2); // distance before threshold (positive = on approach side)
			if (along < -ap.length * 0.8 || along > 30000) continue;
			const lateral = end < 0 ? l.v : -l.v;
			const crs = end < 0 ? ap.heading : (ap.heading + 180) % 360;
			let hdgDiff = ((heading - crs + 540) % 360) - 180;
			if (Math.abs(hdgDiff) > 70) continue;
			const distTD = along + 300;
			const locDeg = Math.atan2(lateral, Math.max(distTD, 50)) / D2R;
			if (Math.abs(locDeg) > 25) continue;
			const glide = Math.atan2(pos.y - ap.elev - 15, Math.max(distTD, 50)) / D2R;
			const cand = {
				name: `${ap.id} ${String(end < 0 ? ap.numA : ap.numB).padStart(2, '0')}`,
				loc: -locDeg, gs: glide - 3.0, dme: Math.max(0, distTD) / 1852, dist: Math.abs(along),
			};
			if (!best || cand.dist < best.dist) best = cand;
		}
	}
	return best;
}
