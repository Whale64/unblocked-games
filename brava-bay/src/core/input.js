// Unified input: keyboard + mouse (pointer lock) + gamepad + virtual (touch UI) -> named actions & axes.
// Call input.update() once at the start of every frame. See CONTRACT.md for the binding table.

const KEY_BINDINGS = {
	forward: ['KeyW', 'ArrowUp'],
	back: ['KeyS', 'ArrowDown'],
	left: ['KeyA', 'ArrowLeft'],
	right: ['KeyD', 'ArrowRight'],
	sprint: ['ShiftLeft', 'ShiftRight'],
	jump: ['Space'],          // on foot
	handbrake: ['Space'],     // in vehicle
	enter: ['KeyF'],          // enter / exit vehicle
	interact: ['KeyE'],       // start mission, talk, pick up
	reload: ['KeyR'],
	horn: ['KeyH'],
	lights: ['KeyL'],
	siren: ['KeyG'],
	lookBack: ['KeyC'],
	camera: ['KeyV'],
	radio: ['KeyQ'],          // next radio station (in vehicle)
	radioOff: ['KeyX'],
	weapon1: ['Digit1'],
	weapon2: ['Digit2'],
	weapon3: ['Digit3'],
	weapon4: ['Digit4'],
	map: ['KeyM'],
	pause: ['Escape', 'KeyP'],
	phone: ['KeyT'],
	crouch: ['ControlLeft'],
	debug: ['Backquote'],
};
const MOUSE_BINDINGS = { attack: 0, aim: 2 };

// Standard gamepad mapping indices.
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const PAD_BINDINGS = {
	jump: [PAD.A], handbrake: [PAD.A, PAD.RB], enter: [PAD.Y], interact: [PAD.RIGHT], reload: [PAD.X],
	horn: [PAD.LS], sprint: [PAD.B], lookBack: [PAD.RS], camera: [PAD.BACK], radio: [PAD.LEFT],
	map: [PAD.UP], pause: [PAD.START], lights: [PAD.DOWN],
};

const deadzone = (v, d = 0.15) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));

export class Input {
	constructor(canvas) {
		this.canvas = canvas;
		this.keys = new Set();
		this.mouseButtons = new Set();
		this.actions = new Map();     // action -> held
		this.prev = new Map();
		this.virtual = new Map();     // action -> bool (touch UI)
		this.virtualAxes = new Map(); // axis -> number (touch UI)
		this.axes = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, throttle: 0, brake: 0, steer: 0 };
		this.mouse = { dx: 0, dy: 0, wheel: 0, locked: false, x: 0, y: 0 };
		this._acc = { dx: 0, dy: 0, wheel: 0 };
		this.enabled = true;          // set false while menus are open (UI)
		this.lastDevice = 'keyboard';
		this.gamepad = null;
		this.sensitivity = 1;
		this.invertY = false;
		this._bind();
	}

	_bind() {
		const gameKeys = new Set(Object.values(KEY_BINDINGS).flat());
		window.addEventListener('keydown', (e) => {
			if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
			this.keys.add(e.code);
			this.lastDevice = 'keyboard';
			if (this.enabled && gameKeys.has(e.code) && e.code !== 'Escape') e.preventDefault();
			if (e.code === 'Tab') e.preventDefault();
		});
		window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
		window.addEventListener('blur', () => { this.keys.clear(); this.mouseButtons.clear(); });
		window.addEventListener('mousedown', (e) => {
			if (e.target !== this.canvas && !this.mouse.locked) return;
			this.mouseButtons.add(e.button);
			this.lastDevice = 'keyboard';
		});
		window.addEventListener('mouseup', (e) => { this.mouseButtons.delete(e.button); });
		window.addEventListener('contextmenu', (e) => { if (e.target === this.canvas) e.preventDefault(); });
		window.addEventListener('mousemove', (e) => {
			this.mouse.x = e.clientX; this.mouse.y = e.clientY;
			if (this.mouse.locked) { this._acc.dx += e.movementX; this._acc.dy += e.movementY; }
		});
		window.addEventListener('wheel', (e) => {
			if (e.target !== this.canvas && !this.mouse.locked) return;
			this._acc.wheel += Math.sign(e.deltaY);
		}, { passive: true });
		document.addEventListener('pointerlockchange', () => {
			this.mouse.locked = document.pointerLockElement === this.canvas;
		});
	}

	/** Request pointer lock (call from a user gesture, e.g. canvas click while playing). */
	lockPointer() {
		if (document.pointerLockElement !== this.canvas && this.canvas.requestPointerLock) {
			try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
		}
	}
	unlockPointer() { if (document.pointerLockElement) document.exitPointerLock(); }

	setVirtual(action, held) { this.virtual.set(action, !!held); this.lastDevice = 'touch'; }
	setVirtualAxis(axis, value) { this.virtualAxes.set(axis, value); this.lastDevice = 'touch'; }

	_pollGamepad() {
		const pads = navigator.getGamepads ? navigator.getGamepads() : [];
		let gp = null;
		for (const p of pads) if (p && p.connected && p.mapping === 'standard') { gp = p; break; }
		if (!gp) for (const p of pads) if (p && p.connected) { gp = p; break; }
		this.gamepad = gp;
		return gp;
	}

	update() {
		// swap previous states
		this.prev = new Map(this.actions);
		this.actions.clear();
		const gp = this._pollGamepad();
		const btn = (i) => !!(gp && gp.buttons[i] && gp.buttons[i].pressed);
		const btnVal = (i) => (gp && gp.buttons[i] ? gp.buttons[i].value : 0);

		const set = (a) => this.actions.set(a, true);
		if (this.enabled) {
			for (const [action, codes] of Object.entries(KEY_BINDINGS)) {
				for (const c of codes) if (this.keys.has(c)) { set(action); break; }
			}
			for (const [action, b] of Object.entries(MOUSE_BINDINGS)) if (this.mouseButtons.has(b)) set(action);
			if (gp) {
				for (const [action, list] of Object.entries(PAD_BINDINGS)) for (const i of list) if (btn(i)) { set(action); break; }
				if (btnVal(PAD.RT) > 0.35) set('attack');
				if (btnVal(PAD.LT) > 0.35) set('aim');
				if (gp.buttons.some((b) => b && b.pressed)) this.lastDevice = 'gamepad';
			}
			for (const [a, v] of this.virtual) if (v) set(a);
		}
		// pause must work even when input is disabled (menus)
		if (this.keys.has('Escape') || this.keys.has('KeyP') || btn(PAD.START)) set('pause');

		// axes
		const kb = (codes) => codes.some((c) => this.keys.has(c)) ? 1 : 0;
		let mx = 0, my = 0;
		if (this.enabled) {
			mx = kb(KEY_BINDINGS.right) - kb(KEY_BINDINGS.left);
			my = kb(KEY_BINDINGS.forward) - kb(KEY_BINDINGS.back);
		}
		let lx = 0, ly = 0, thr = Math.max(0, my), brk = Math.max(0, -my);
		if (gp && this.enabled) {
			const ax = deadzone(gp.axes[0] || 0), ay = deadzone(gp.axes[1] || 0);
			if (ax || ay) { mx = ax; my = -ay; this.lastDevice = 'gamepad'; }
			lx = deadzone(gp.axes[2] || 0) * 14;
			ly = deadzone(gp.axes[3] || 0) * 10;
			const rt = btnVal(PAD.RT), lt = btnVal(PAD.LT);
			if (rt > 0.02 || lt > 0.02) { thr = Math.max(thr, rt); brk = Math.max(brk, lt); }
		}
		if (this.enabled) {
			for (const [axis, v] of this.virtualAxes) {
				if (axis === 'moveX' && v) mx = v;
				if (axis === 'moveY' && v) { my = v; thr = Math.max(0, v); brk = Math.max(0, -v); }
				if (axis === 'lookX' && v) lx += v;
				if (axis === 'lookY' && v) ly += v;
			}
		}
		const len = Math.hypot(mx, my);
		if (len > 1) { mx /= len; my /= len; }
		const sens = this.sensitivity;
		this.mouse.dx = this.enabled ? this._acc.dx * sens : 0;
		this.mouse.dy = this.enabled ? this._acc.dy * sens * (this.invertY ? -1 : 1) : 0;
		this.mouse.wheel = this.enabled ? this._acc.wheel : 0;
		this._acc.dx = 0; this._acc.dy = 0; this._acc.wheel = 0;

		this.axes.moveX = mx;
		this.axes.moveY = my;
		this.axes.steer = mx;
		this.axes.throttle = thr;
		this.axes.brake = brk;
		// look axes in "mouse pixels" this frame (gamepad scaled to similar magnitude per frame)
		this.axes.lookX = this.mouse.dx + lx * sens;
		this.axes.lookY = this.mouse.dy + ly * sens * (this.invertY ? -1 : 1);
	}

	down(action) { return !!this.actions.get(action); }
	pressed(action) { return !!this.actions.get(action) && !this.prev.get(action); }
	released(action) { return !this.actions.get(action) && !!this.prev.get(action); }
	axis(name) { return this.axes[name] || 0; }

	rumble(strong = 0.5, weak = 0.5, ms = 120) {
		const gp = this.gamepad;
		const act = gp && gp.vibrationActuator;
		if (act && act.playEffect) {
			try { act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }); } catch { /* unsupported */ }
		}
	}
}
