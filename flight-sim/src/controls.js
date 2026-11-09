// Input handling: keyboard (with smoothed axes), mouse yoke, mouse look and gamepads.
export class Controls {
	constructor(dom) {
		this.keys = new Set();
		this.pressed = new Set();
		this.axes = { pitch: 0, roll: 0, yaw: 0 };
		this.throttle = 0;
		this.invertPitch = false;
		this.mouseYoke = false;
		this.mouse = { x: 0, y: 0, dx: 0, dy: 0, dragging: false, button: -1, wheel: 0 };
		this.gamepadActive = false;
		this.dom = dom;
		this.enabled = false;
		window.addEventListener('keydown', (e) => {
			if (!this.enabled) return;
			if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
			const k = e.code;
			if (!this.keys.has(k)) this.pressed.add(k);
			this.keys.add(k);
			if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown', 'Tab', 'Slash', 'Backspace', 'F1', 'F2', 'F3', 'F4', 'F5', 'Quote'].includes(k)) e.preventDefault();
		});
		window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
		window.addEventListener('blur', () => this.keys.clear());
		dom.addEventListener('mousedown', (e) => {
			this.mouse.dragging = true; this.mouse.button = e.button;
		});
		window.addEventListener('mouseup', () => { this.mouse.dragging = false; this.mouse.button = -1; });
		window.addEventListener('mousemove', (e) => {
			this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
			this.mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
			if (this.mouse.dragging) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
		});
		dom.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
		dom.addEventListener('contextmenu', (e) => e.preventDefault());
		// touch: drag to look / single-finger yoke on mobile
		this.touch = null;
		dom.addEventListener('touchstart', (e) => { const t = e.touches[0]; this.touch = { x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY }; }, { passive: true });
		dom.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (this.touch) { this.touch.x = t.clientX; this.touch.y = t.clientY; } }, { passive: true });
		dom.addEventListener('touchend', () => { this.touch = null; }, { passive: true });
	}

	down(...codes) { return codes.some((c) => this.keys.has(c)); }
	hit(code) { return this.pressed.has(code); }
	shift() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }

	consumeMouse() {
		const d = { dx: this.mouse.dx, dy: this.mouse.dy, wheel: this.mouse.wheel };
		this.mouse.dx = this.mouse.dy = this.mouse.wheel = 0;
		return d;
	}

	endFrame() { this.pressed.clear(); }

	update(dt) {
		const ramp = (cur, target, rateUp = 2.6, rateBack = 4.5) => {
			const r = Math.abs(target) > Math.abs(cur) || Math.sign(target) !== Math.sign(cur) ? rateUp : rateBack;
			const d = target - cur;
			return cur + Math.sign(d) * Math.min(Math.abs(d), r * dt);
		};
		let p = 0, r = 0, y = 0;
		// Flight-sim convention: Up arrow / W = nose down (push), Down arrow / S = nose up (pull)
		if (this.down('ArrowUp', 'KeyW')) p -= 1;
		if (this.down('ArrowDown', 'KeyS')) p += 1;
		if (this.down('ArrowLeft', 'KeyA')) r -= 1;
		if (this.down('ArrowRight', 'KeyD')) r += 1;
		if (this.down('KeyQ')) y -= 1;
		if (this.down('KeyE')) y += 1;
		if (this.invertPitch) p = -p;
		const fine = this.down('AltLeft', 'AltRight') ? 0.35 : 1;
		this.axes.pitch = ramp(this.axes.pitch, p * fine, 2.2, 3.5);
		this.axes.roll = ramp(this.axes.roll, r * fine, 3.2, 5);
		this.axes.yaw = ramp(this.axes.yaw, y, 2.5, 4);

		// throttle
		const thrUp = this.down('ShiftLeft', 'ShiftRight', 'PageUp', 'Equal', 'NumpadAdd', 'KeyR');
		const thrDn = this.down('PageDown', 'Minus', 'NumpadSubtract', 'KeyF');
		if (thrUp) this.throttle = Math.min(1, this.throttle + dt * 0.5);
		if (thrDn) this.throttle = Math.max(0, this.throttle - dt * 0.5);
		for (let i = 0; i <= 9; i++) if (this.hit('Digit' + i) && !this.shift()) this.throttle = i === 0 ? 1 : (i - 1) / 9 * 0.9 + (i === 1 ? 0 : 0.0);

		// mouse yoke
		if (this.mouseYoke && !this.mouse.dragging) {
			const dz = (v) => (Math.abs(v) < 0.04 ? 0 : (v - Math.sign(v) * 0.04) / 0.96);
			if (!p) this.axes.pitch = dz(this.mouse.y) * (this.invertPitch ? -1 : 1);
			if (!r) this.axes.roll = dz(this.mouse.x);
		}
		// touch yoke
		if (this.touch) {
			const tx = (this.touch.x - this.touch.x0) / 120, ty = (this.touch.y - this.touch.y0) / 120;
			this.axes.roll = Math.max(-1, Math.min(1, tx));
			this.axes.pitch = Math.max(-1, Math.min(1, ty));
		}

		// gamepad
		const pads = navigator.getGamepads ? navigator.getGamepads() : [];
		for (const gp of pads) {
			if (!gp) continue;
			const dz = (v) => (Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92);
			const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0), rx = dz(gp.axes[2] || 0);
			const used = Math.abs(lx) + Math.abs(ly) + Math.abs(rx) > 0 || gp.buttons.some((b) => b.pressed);
			if (used) this.gamepadActive = true;
			if (!this.gamepadActive) continue;
			const curve = (v) => Math.sign(v) * (0.4 * Math.abs(v) + 0.6 * v * v);
			if (!p && !this.touch) this.axes.pitch = curve(ly) * (this.invertPitch ? -1 : 1);
			if (!r && !this.touch) this.axes.roll = curve(lx);
			if (!y) this.axes.yaw = curve(rx);
			const rt = gp.buttons[7] ? gp.buttons[7].value : 0, lt = gp.buttons[6] ? gp.buttons[6].value : 0;
			this.throttle = Math.max(0, Math.min(1, this.throttle + (rt - lt) * dt * 0.6));
			this.padButtons = gp.buttons.map((b) => b.pressed);
			if (!this.prevPad) this.prevPad = this.padButtons.slice();
			const edge = (i) => this.padButtons[i] && !this.prevPad[i];
			if (edge(0)) this.pressed.add('KeyG');        // A: gear
			if (edge(1)) this.pressed.add('KeyC');        // B: camera
			if (edge(2)) this.pressed.add('BracketRight'); // X: flaps down
			if (edge(3)) this.pressed.add('BracketLeft');  // Y: flaps up
			if (edge(9)) this.pressed.add('Escape');       // start: pause
			if (this.padButtons[4] || this.padButtons[5]) this.keys.add('PadBrake'); else this.keys.delete('PadBrake');
			this.prevPad = this.padButtons.slice();
			break;
		}
	}
}
