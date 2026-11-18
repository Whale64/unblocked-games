// Input handling: keyboard (with smoothed axes), mouse yoke, mouse look, touch and flight hardware.
import { DeviceManager, BUTTON_ACTIONS } from './devices.js';
export class Controls {
	constructor(dom) {
		this.keys = new Set();
		this.pressed = new Set();
		this.axes = { pitch: 0, roll: 0, yaw: 0 };
		this.throttle = 0;
		this.invertPitch = false;
		this.mouseYoke = false;
		this.mouse = { x: 0, y: 0, dx: 0, dy: 0, dragging: false, button: -1, wheel: 0 };
		this.devices = new DeviceManager();
		this.hwTouched = {};
		this.newDevices = [];
		this.look = { x: 0, y: 0 };
		this.brakeL = 0; this.brakeR = 0;
		this.flapsLever = this.trimLever = this.airbrakeLever = { value: 0, bound: false, changed: false };
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

		// flight hardware: joysticks, sidesticks, yokes, throttles, pedals, gamepads
		const dm = this.devices;
		this.newDevices = dm.poll();
		for (const [name, kb] of [['pitch', p], ['roll', r], ['yaw', y]]) {
			const a = dm.axis(name);
			if (!a.bound || kb || this.touch) continue;
			// ignore an idle device so the mouse yoke / keyboard keep control of the axis
			if (Math.abs(a.value) < 0.001 && !this.hwTouched[name]) continue;
			this.hwTouched[name] = true;
			this.axes[name] = name === 'pitch' && this.invertPitch ? -a.value : a.value;
		}
		const thr = dm.level('throttle');
		if (thr.changed) this.throttle = thr.value;
		const dThr = dm.hold('throttleUp') - dm.hold('throttleDown');
		if (dThr) this.throttle = Math.max(0, Math.min(1, this.throttle + dThr * dt * 0.6));
		this.brakeL = dm.level('brakeL').value;
		this.brakeR = dm.level('brakeR').value;
		this.flapsLever = dm.level('flaps');
		this.trimLever = dm.level('trim');
		this.airbrakeLever = dm.level('airbrake');
		for (const act of BUTTON_ACTIONS) {
			if (act.hold) {
				const code = 'Dev_' + act.id;
				if (dm.hold(act.id) > 0.5) this.keys.add(code); else this.keys.delete(code);
			} else if (act.key && dm.hit(act.id)) this.pressed.add(act.key);
		}
		this.look = dm.look();
	}
}
