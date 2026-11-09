// Procedural audio: piston/jet engine synthesis, wind, tyre roll, stall horn, one-shots and voice callouts.
export class Audio {
	constructor() {
		this.ctx = null;
		this.enabled = true;
		this.volume = 0.8;
		this.lastSpeak = {};
		this.calloutState = { last: Infinity };
	}

	init(type) {
		if (!this.ctx) {
			const AC = window.AudioContext || window.webkitAudioContext;
			if (!AC) return;
			this.ctx = new AC();
			const ctx = this.ctx;
			const len = ctx.sampleRate * 2;
			const buf = ctx.createBuffer(1, len, ctx.sampleRate);
			const d = buf.getChannelData(0);
			let b0 = 0, b1 = 0, b2 = 0;
			for (let i = 0; i < len; i++) {
				const w = Math.random() * 2 - 1;
				b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
				d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; // pink-ish noise
			}
			this.noiseBuf = buf;
			this.master = ctx.createGain();
			this.master.gain.value = this.volume;
			this.comp = ctx.createDynamicsCompressor();
			this.interior = ctx.createBiquadFilter();
			this.interior.type = 'lowpass';
			this.interior.frequency.value = 18000;
			this.interior.connect(this.comp);
			this.comp.connect(this.master);
			this.master.connect(ctx.destination);
		}
		if (this.ctx.state === 'suspended') this.ctx.resume();
		this.buildEngine(type);
	}

	noise() {
		const s = this.ctx.createBufferSource();
		s.buffer = this.noiseBuf; s.loop = true;
		s.loopStart = Math.random(); s.start(0, Math.random() * 1.5);
		return s;
	}

	gain(v = 0, dest = this.interior) { const g = this.ctx.createGain(); g.gain.value = v; g.connect(dest); return g; }
	filt(type, f, q = 1) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }

	buildEngine(type) {
		const ctx = this.ctx;
		if (this.nodes) {
			for (const n of this.nodes.stop) { try { n.stop(); } catch { /* already stopped */ } }
			for (const g of this.nodes.outs) g.disconnect();
		}
		const stop = [], outs = [];
		const N = { stop, outs, type };
		if (type === 'prop') {
			// firing pulses: sawtooth through waveshaper + lowpass, sub harmonic rumble, exhaust noise
			const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
			const o2 = ctx.createOscillator(); o2.type = 'square';
			const o3 = ctx.createOscillator(); o3.type = 'triangle';
			const shaper = ctx.createWaveShaper();
			const curve = new Float32Array(1024);
			for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3.5); }
			shaper.curve = curve;
			const lp = this.filt('lowpass', 700, 0.8);
			const g = this.gain(0); outs.push(g);
			o1.connect(shaper); o2.connect(shaper); shaper.connect(lp); lp.connect(g);
			const g3 = this.gain(0); outs.push(g3); o3.connect(g3);
			const nz = this.noise();
			const bp = this.filt('bandpass', 300, 0.9);
			const gn = this.gain(0); outs.push(gn);
			nz.connect(bp); bp.connect(gn);
			// amplitude flutter from the propeller blade pass
			const am = ctx.createOscillator(); am.type = 'sine';
			const amG = ctx.createGain(); amG.gain.value = 0.0;
			am.connect(amG); amG.connect(g.gain);
			[o1, o2, o3, am].forEach((o) => o.start()); stop.push(o1, o2, o3, am, nz);
			Object.assign(N, { o1, o2, o3, g, g3, gn, bp, lp, am, amG });
		} else {
			const nz = this.noise();
			const lp = this.filt('lowpass', 600, 0.7);
			const g = this.gain(0); outs.push(g);
			nz.connect(lp); lp.connect(g);
			const whine = ctx.createOscillator(); whine.type = 'sine';
			const w2 = ctx.createOscillator(); w2.type = 'sine';
			const gw = this.gain(0); outs.push(gw);
			whine.connect(gw); w2.connect(gw);
			const nz2 = this.noise();
			const abLp = this.filt('lowpass', 160, 0.6);
			const gab = this.gain(0); outs.push(gab);
			nz2.connect(abLp); abLp.connect(gab);
			const nz3 = this.noise();
			const hp = this.filt('bandpass', 2400, 0.6);
			const ghiss = this.gain(0); outs.push(ghiss);
			nz3.connect(hp); hp.connect(ghiss);
			[whine, w2].forEach((o) => o.start()); stop.push(nz, whine, w2, nz2, nz3);
			Object.assign(N, { g, lp, whine, w2, gw, gab, ghiss, hp });
		}
		// wind
		const wn = this.noise();
		const wbp = this.filt('bandpass', 400, 0.5);
		const wg = this.gain(0); outs.push(wg);
		wn.connect(wbp); wbp.connect(wg);
		// rolling rumble
		const rn = this.noise();
		const rlp = this.filt('lowpass', 140, 0.7);
		const rg = this.gain(0); outs.push(rg);
		rn.connect(rlp); rlp.connect(rg);
		// stall horn
		const so = ctx.createOscillator(); so.type = 'sawtooth'; so.frequency.value = 410;
		const sbp = this.filt('bandpass', 820, 3);
		const sg = this.gain(0); outs.push(sg);
		so.connect(sbp); sbp.connect(sg); so.start();
		stop.push(wn, rn, so);
		Object.assign(N, { wg, wbp, rg, rlp, sg });
		this.nodes = N;
	}

	oneShot(kind, strength = 1) {
		if (!this.ctx || !this.enabled) return;
		const ctx = this.ctx, t = ctx.currentTime;
		if (kind === 'chirp') {
			const n = this.noise(); const bp = this.filt('bandpass', 1600, 2); const g = this.gain(0);
			n.connect(bp); bp.connect(g);
			g.gain.setValueAtTime(0.0, t); g.gain.linearRampToValueAtTime(0.5 * strength, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
			n.stop(t + 0.4);
			const th = ctx.createOscillator(); th.frequency.value = 55; const tg = this.gain(0);
			th.connect(tg); tg.gain.setValueAtTime(0.6 * strength, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
			th.start(t); th.stop(t + 0.3);
		} else if (kind === 'thunk') {
			const th = ctx.createOscillator(); th.type = 'triangle'; th.frequency.setValueAtTime(90, t); th.frequency.exponentialRampToValueAtTime(40, t + 0.2);
			const tg = this.gain(0); th.connect(tg);
			tg.gain.setValueAtTime(0.5, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
			th.start(t); th.stop(t + 0.35);
		} else if (kind === 'click') {
			const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1800;
			const g = this.gain(0); o.connect(g);
			g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.04);
			o.start(t); o.stop(t + 0.05);
		} else if (kind === 'explosion') {
			const n = this.noise(); const lp = this.filt('lowpass', 2000, 0.5); const g = this.gain(0, this.comp);
			n.connect(lp); lp.connect(g);
			lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(60, t + 3.5);
			g.gain.setValueAtTime(1.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 4.5);
			n.stop(t + 4.6);
			const o = ctx.createOscillator(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(25, t + 1.5);
			const og = this.gain(0, this.comp); o.connect(og);
			og.gain.setValueAtTime(1.2, t); og.gain.exponentialRampToValueAtTime(0.001, t + 2);
			o.start(t); o.stop(t + 2.1);
		} else if (kind === 'splash') {
			const n = this.noise(); const bp = this.filt('bandpass', 900, 0.4); const g = this.gain(0, this.comp);
			n.connect(bp); bp.connect(g);
			g.gain.setValueAtTime(1.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
			n.stop(t + 2.6);
		}
	}

	speak(text, key = text, minGap = 4) {
		if (!this.enabled || !window.speechSynthesis) return;
		const now = performance.now() / 1000;
		if (this.lastSpeak[key] && now - this.lastSpeak[key] < minGap) return;
		this.lastSpeak[key] = now;
		try {
			const u = new SpeechSynthesisUtterance(text);
			u.rate = 1.15; u.pitch = 0.9; u.volume = Math.min(1, this.volume * 1.1);
			window.speechSynthesis.speak(u);
		} catch { /* speech not available */ }
	}

	update(t, view, paused) {
		if (!this.ctx || !this.nodes) return;
		const ctx = this.ctx, N = this.nodes, now = ctx.currentTime;
		const sm = (param, v, tc = 0.08) => param.setTargetAtTime(v, now, tc);
		const on = this.enabled && !paused && !t.crashed ? 1 : 0;
		const inside = view === 'cockpit';
		sm(this.interior.frequency, inside ? 1800 : 16000, 0.2);
		const extGain = inside ? 1 : 0.75;
		const V = t.tas / 1.94384;
		if (N.type === 'prop') {
			const f = t.rpm / 60 * 2; // 4-stroke 4-cyl firing frequency
			sm(N.o1.frequency, f); sm(N.o2.frequency, f * 0.5); sm(N.o3.frequency, t.rpm / 60 * 2 * 3);
			sm(N.am.frequency, t.rpm / 60 * 2);
			sm(N.amG.gain, 0.05 + 0.05 * t.engine);
			sm(N.lp.frequency, 380 + 1400 * t.engine);
			sm(N.g.gain, on * (0.12 + 0.22 * t.engine) * extGain);
			sm(N.g3.gain, on * 0.03 * (0.3 + t.engine));
			sm(N.bp.frequency, 200 + 900 * t.engine);
			sm(N.gn.gain, on * (0.04 + 0.16 * t.engine) * extGain);
		} else {
			const n1 = t.engine;
			sm(N.lp.frequency, 250 + 2600 * n1 * n1);
			sm(N.g.gain, on * (0.06 + 0.5 * n1 * n1) * extGain);
			sm(N.whine.frequency, 900 + 4200 * n1); sm(N.w2.frequency, 1800 + 7800 * n1);
			sm(N.gw.gain, on * (0.012 + 0.03 * n1) * (inside ? 0.5 : 1));
			sm(N.gab.gain, on * 1.1 * t.ab * extGain, 0.15);
			sm(N.hp.frequency, 1500 + 2000 * n1);
			sm(N.ghiss.gain, on * 0.06 * n1);
		}
		const q = Math.min(1, (V / 120) ** 2);
		sm(N.wbp.frequency, 250 + V * 9);
		sm(N.wg.gain, on * (0.02 + 0.5 * q) * (inside ? 0.6 : 1) * (1 + t.buffet * 1.5));
		sm(N.rg.gain, on * (t.onGround ? Math.min(0.7, V / 30) : 0));
		sm(N.rlp.frequency, 80 + V * 3);
		sm(N.sg.gain, on * (t.stall > 0.5 && !t.onGround ? 0.12 : 0), 0.03);

		// GPWS-style callouts
		if (!on) return;
		if (t.sinkWarning) this.speak('Pull up', 'pullup', 2.5);
		if (t.stall > 0.85 && !t.onGround && t.engineType === 'jet') this.speak('Stall', 'stall', 3);
		if (Math.abs(t.bank) > 50 && t.agl < 1500 && !t.onGround) this.speak('Bank angle', 'bank', 4);
		if (t.gearWarn) this.speak('Too low, gear', 'gear', 6);
		const c = this.calloutState;
		if (!t.onGround && t.vs < -100 && t.gearDown) {
			for (const lvl of [1000, 500, 100, 50, 40, 30, 20, 10]) {
				if (c.last > lvl && t.agl <= lvl) {
					const words = { 1000: 'one thousand', 500: 'five hundred', 100: 'one hundred', 50: 'fifty', 40: 'forty', 30: 'thirty', 20: 'twenty', 10: 'ten' };
					this.speak(words[lvl], 'alt' + lvl, 8);
					break;
				}
			}
		}
		c.last = t.agl;
	}

	setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
}
