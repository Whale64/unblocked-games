// Flight hardware support: joysticks / sidesticks, yokes ("flight wheels"), throttle quadrants,
// rudder pedals with toe brakes and standard gamepads. Every connected device gets its own binding
// profile (auto-generated from its name, user-editable, saved in localStorage); inputs from all
// devices are merged each frame.

const LS_KEY = 'skyward-devices-v1';
const CENTER = 'center', FULL = 'full';

export const AXIS_ACTIONS = [
	{ id: 'roll', label: 'Roll (ailerons)', range: CENTER, prompt: 'Roll the stick / turn the yoke fully RIGHT' },
	{ id: 'pitch', label: 'Pitch (elevator)', range: CENTER, prompt: 'PULL the stick / yoke fully back toward you' },
	{ id: 'yaw', label: 'Rudder (pedals / twist)', range: CENTER, prompt: 'Push the RIGHT rudder pedal (or twist the stick right)' },
	{ id: 'throttle', label: 'Throttle lever', range: FULL, prompt: 'Move the throttle lever to FULL power' },
	{ id: 'brakeL', label: 'Left toe brake', range: FULL, prompt: 'Press the LEFT toe brake fully' },
	{ id: 'brakeR', label: 'Right toe brake', range: FULL, prompt: 'Press the RIGHT toe brake fully' },
	{ id: 'flaps', label: 'Flaps lever', range: FULL, prompt: 'Move the flaps lever to FULL flaps' },
	{ id: 'trim', label: 'Pitch trim wheel / axis', range: CENTER, prompt: 'Roll the trim wheel NOSE UP' },
	{ id: 'airbrake', label: 'Speed brake lever', range: FULL, prompt: 'Move the speed brake lever to EXTENDED' },
	{ id: 'lookX', label: 'Look left / right (axis)', range: CENTER, prompt: 'Move the look axis to the RIGHT' },
	{ id: 'lookY', label: 'Look up / down (axis)', range: CENTER, prompt: 'Move the look axis UP' },
];
export const BUTTON_ACTIONS = [
	{ id: 'gear', label: 'Landing gear toggle', key: 'KeyG' },
	{ id: 'flapsDown', label: 'Flaps down (extend)', key: 'BracketRight' },
	{ id: 'flapsUp', label: 'Flaps up (retract)', key: 'BracketLeft' },
	{ id: 'brakes', label: 'Wheel brakes (hold)', hold: true },
	{ id: 'parkBrake', label: 'Parking brake toggle', key: 'DevPark' },
	{ id: 'reverse', label: 'Thrust reversers toggle', key: 'KeyJ' },
	{ id: 'airbrakeHold', label: 'Speed brake (hold)', hold: true },
	{ id: 'trimUp', label: 'Trim nose up (hold)', hold: true },
	{ id: 'trimDown', label: 'Trim nose down (hold)', hold: true },
	{ id: 'throttleUp', label: 'Throttle increase (hold)', hold: true },
	{ id: 'throttleDown', label: 'Throttle decrease (hold)', hold: true },
	{ id: 'lookHat', label: 'Look-around hat switch (POV)', hat: true },
	{ id: 'view', label: 'Cycle camera', key: 'KeyC' },
	{ id: 'cockpit', label: 'Cockpit / chase view', key: 'KeyV' },
	{ id: 'recenter', label: 'Recenter view', key: 'DevRecenter' },
	{ id: 'hud', label: 'HUD on / off', key: 'KeyI' },
	{ id: 'pause', label: 'Pause', key: 'Escape' },
];
export const ALL_ACTIONS = [...AXIS_ACTIONS, ...BUTTON_ACTIONS];
const ACTION = Object.fromEntries(ALL_ACTIONS.map((a) => [a.id, a]));

export function classifyDevice(id, mapping) {
	if (/rudder|pedal|TPR|TFRP|T-?Flight Rudder|MFG|Crosswind|Slaw/i.test(id)) return 'pedals';
	if (/throttle|TWCS|quadrant|Bravo|TCA Q|TQ|X-?5[256].*Throttle/i.test(id)) return 'throttle';
	if (/yoke|Alpha Flight|Honeycomb|Flight Yoke|TCA Yoke|Boeing/i.test(id)) return 'yoke';
	if (mapping === 'standard' && !/stick|joystick|HOTAS|T\.?16000|Extreme 3D|sidestick|Airbus|Gladiator|VKB|Virpil|Warthog/i.test(id)) return 'gamepad';
	return 'joystick';
}

export function shortName(id) {
	let n = id.replace(/\(.*?(Vendor|STANDARD GAMEPAD).*?\)/gi, '').replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '').trim();
	n = n.replace(/\s+/g, ' ');
	return n.length > 42 ? n.slice(0, 40) + '…' : (n || 'Controller');
}

const ax = (index, invert = false) => ({ kind: 'axis', index, invert });
const bt = (index) => ({ kind: 'button', index });

// Best-guess bindings from the device type; the setup wizard fixes anything that is off.
function defaultProfile(pad) {
	const n = pad.axes.length;
	const p = {};
	switch (pad.type) {
		case 'gamepad':
			Object.assign(p, {
				roll: ax(0), pitch: ax(1), yaw: ax(2), throttleUp: bt(7), throttleDown: bt(6),
				gear: bt(0), view: bt(1), flapsDown: bt(2), flapsUp: bt(3), brakes: bt(4), airbrakeHold: bt(5),
				cockpit: bt(8), pause: bt(9), recenter: bt(10), trimDown: bt(12), trimUp: bt(13), lookHat: { kind: 'dpad' },
			});
			break;
		case 'pedals':
			p.yaw = ax(n >= 6 ? 5 : Math.min(2, n - 1));
			if (n >= 2) { p.brakeL = ax(0); p.brakeR = ax(1); }
			break;
		case 'throttle':
			p.throttle = ax(n > 2 && !/Bravo|quadrant|TQ/i.test(pad.id) ? 2 : 0, true);
			if (pad.buttons.length > 1) { p.flapsDown = bt(0); p.flapsUp = bt(1); }
			break;
		case 'yoke':
			p.roll = ax(0); p.pitch = ax(1);
			if (n >= 3) p.throttle = ax(2, true);
			if (pad.buttons.length > 4) { p.trimDown = bt(2); p.trimUp = bt(3); }
			break;
		default: // joystick / sidestick
			p.roll = ax(0); p.pitch = ax(1);
			if (n >= 6) p.yaw = ax(5); else if (n >= 4) p.yaw = ax(3);
			if (n >= 3) p.throttle = ax(n > 6 ? 6 : 2, true);
			if (pad.buttons.length > 1) { p.view = bt(1); }
			if (pad.buttons.length > 3) { p.gear = bt(2); p.brakes = bt(0); }
			if (pad.hatAxis !== -1) p.lookHat = { kind: 'hat', index: pad.hatAxis };
	}
	return p;
}

function decodeHat(v) {
	if (!(Math.abs(v) <= 1.05)) return { x: 0, y: 0 };
	const i = Math.round((v + 1) * 3.5) % 8; // 0 up, 1 up-right, 2 right ... 7 up-left
	const dirs = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
	return { x: dirs[i][0], y: dirs[i][1] };
}

export class DeviceManager {
	constructor() {
		this.profiles = {};
		this.settings = { deadzone: 0.05, curve: 0.3, rumble: true };
		try {
			const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
			if (s.profiles) this.profiles = s.profiles;
			if (s.settings) Object.assign(this.settings, s.settings);
		} catch { /* storage unavailable */ }
		this.pads = [];
		this.prevButtons = new Map();
		this.prevAxes = new Map();
		this.latch = {};
		this.edges = new Set();
		this.capture = null;
		this.lastRumble = 0;
	}

	save() {
		try { localStorage.setItem(LS_KEY, JSON.stringify({ profiles: this.profiles, settings: this.settings })); } catch { /* storage unavailable */ }
	}

	resetProfiles() {
		for (const pad of this.pads) this.profiles[pad.key] = defaultProfile(pad);
		this.latch = {};
		this.save();
	}

	poll() {
		const raw = navigator.getGamepads ? [...navigator.getGamepads()] : [];
		const seen = {};
		const pads = [];
		const fresh = [];
		for (const gp of raw) {
			if (!gp || gp.connected === false) continue;
			seen[gp.id] = (seen[gp.id] || 0) + 1;
			const key = gp.id + (seen[gp.id] > 1 ? '#' + seen[gp.id] : '');
			const axes = Array.from(gp.axes);
			const pad = {
				key, id: gp.id, name: shortName(gp.id), mapping: gp.mapping, gp, axes,
				buttons: gp.buttons.map((b) => ({ pressed: !!(b.pressed || b.value > 0.5), value: b.value || (b.pressed ? 1 : 0) })),
				hatAxis: axes.findIndex((v) => Math.abs(v) > 1.05),
			};
			pad.type = classifyDevice(gp.id, gp.mapping);
			if (!this.profiles[key]) { this.profiles[key] = defaultProfile(pad); fresh.push(pad); this.save(); }
			pads.push(pad);
		}
		this.pads = pads;
		this.edges.clear();
		if (this.capture) this._checkCapture();
		else {
			for (const pad of pads) {
				const prof = this.profiles[pad.key];
				const prev = this.prevButtons.get(pad.key) || [];
				for (const act in prof) {
					const b = prof[act];
					if (b.kind === 'button' && pad.buttons[b.index] && pad.buttons[b.index].pressed && !prev[b.index]) this.edges.add(act);
				}
			}
		}
		for (const pad of pads) {
			this.prevButtons.set(pad.key, pad.buttons.map((b) => b.pressed));
			this.prevAxes.set(pad.key, pad.axes.slice());
		}
		return fresh;
	}

	_bindings(action) {
		const out = [];
		for (const pad of this.pads) {
			const b = this.profiles[pad.key] && this.profiles[pad.key][action];
			if (b) out.push({ pad, b });
		}
		return out;
	}

	isBound(action) { return this._bindings(action).length > 0; }

	_rawAxis(pad, b) { const v = pad.axes[b.index]; return typeof v === 'number' && Math.abs(v) <= 1.05 ? v : 0; }

	_shapeCenter(v) {
		const dz = this.settings.deadzone, k = this.settings.curve;
		const a = Math.abs(v);
		if (a <= dz) return 0;
		const x = Math.min(1, (a - dz) / (1 - dz));
		return Math.sign(v) * (x * (1 - k) + x * x * x * k);
	}

	// Self-centering axis (stick, yoke, pedals): the largest deflection among bound devices wins.
	axis(action) {
		let best = 0, bound = false;
		for (const { pad, b } of this._bindings(action)) {
			if (b.kind !== 'axis') continue;
			bound = true;
			let v = this._rawAxis(pad, b);
			if (b.invert) v = -v;
			v = this._shapeCenter(v);
			if (Math.abs(v) > Math.abs(best)) best = v;
		}
		return { value: best, bound };
	}

	// Absolute lever (throttle, brakes, flaps, trim): reports `changed` only when the lever moves,
	// so keyboard input keeps working until the hardware lever is touched.
	level(action, peek = false) {
		const def = ACTION[action];
		let value = 0, bound = false, changed = false;
		for (const { pad, b } of this._bindings(action)) {
			if (b.kind !== 'axis') continue;
			bound = true;
			let r = this._rawAxis(pad, b);
			if (b.invert) r = -r;
			let v = def.range === FULL ? Math.min(1, Math.max(0, ((r + 1) / 2 - 0.02) / 0.96)) : this._shapeCenter(r);
			const lk = pad.key + ':' + action;
			const last = this.latch[lk];
			if (!peek) {
				if (last === undefined) this.latch[lk] = r;
				else if (Math.abs(r - last) > 0.012) { this.latch[lk] = r; changed = true; }
			}
			if (Math.abs(v) >= Math.abs(value)) value = v;
		}
		return { value, bound, changed };
	}

	hold(action) {
		let v = 0;
		for (const { pad, b } of this._bindings(action)) {
			if (b.kind === 'button' && pad.buttons[b.index]) v = Math.max(v, pad.buttons[b.index].pressed ? Math.max(pad.buttons[b.index].value, 0.999) : pad.buttons[b.index].value > 0.08 ? pad.buttons[b.index].value : 0);
		}
		return this.capture ? 0 : v;
	}

	hit(action) { return this.edges.has(action); }

	look() {
		let x = 0, y = 0;
		for (const { pad, b } of this._bindings('lookHat')) {
			if (b.kind === 'hat') { const h = decodeHat(pad.axes[b.index]); x += h.x; y += h.y; }
			else if (b.kind === 'dpad') {
				const p = (i) => (pad.buttons[i] && pad.buttons[i].pressed ? 1 : 0);
				x += p(15) - p(14); y += p(12) - p(13);
			}
		}
		const lx = this.axis('lookX'), ly = this.axis('lookY');
		if (lx.bound) x += lx.value;
		if (ly.bound) y += ly.value;
		if (this.capture) return { x: 0, y: 0 };
		return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
	}

	rumble(strong, weak, ms) {
		if (!this.settings.rumble) return;
		const now = performance.now();
		if (now - this.lastRumble < ms * 0.7) return;
		this.lastRumble = now;
		for (const pad of this.pads) {
			const act = pad.gp.vibrationActuator;
			if (act && act.playEffect) {
				act.playEffect(act.type || 'dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
			}
		}
	}

	// ---- interactive binding: wait for the user to move an axis / press a button
	startCapture(actionId, done, exclude = []) {
		const def = ACTION[actionId];
		// settle first: wait until every control has been still for a moment (e.g. after the user
		// lets the previous control spring back to centre), then take the baseline and listen.
		this.capture = { def, base: null, last: this._snapshot(), stableSince: performance.now(), settling: true, done, t0: performance.now(), exclude };
	}

	cancelCapture() {
		if (!this.capture) return;
		const c = this.capture;
		this.capture = null;
		c.done(null);
	}

	_snapshot() {
		const m = new Map();
		for (const pad of this.pads) m.set(pad.key, { axes: pad.axes.slice(), buttons: pad.buttons.map((b) => b.pressed) });
		return m;
	}

	_checkCapture() {
		const c = this.capture;
		if (c.settling) {
			const now = performance.now();
			const snap = this._snapshot();
			let moving = false;
			for (const pad of this.pads) {
				const l = c.last.get(pad.key);
				if (!l) { moving = true; continue; }
				pad.axes.forEach((v, i) => { if (Math.abs(v - l.axes[i]) > 0.03) moving = true; });
				pad.buttons.forEach((b, i) => { if (b.pressed !== l.buttons[i]) moving = true; });
			}
			c.last = snap;
			if (moving) c.stableSince = now;
			if (now - c.stableSince > 600) { c.settling = false; c.base = snap; c.t0 = now; }
			return;
		}
		const isAxis = !!c.def.range;
		if (performance.now() - c.t0 > 20000) { this.cancelCapture(); return; }
		let best = null;
		for (const pad of this.pads) {
			const base = c.base.get(pad.key);
			if (!base) { c.base.set(pad.key, { axes: pad.axes.slice(), buttons: pad.buttons.map((b) => b.pressed) }); continue; }
			if (isAxis) {
				pad.axes.forEach((v, i) => {
					const b0 = base.axes[i];
					if (Math.abs(b0) > 1.05 || Math.abs(v) > 1.05) return; // hat switch encoded as an axis
					if (c.exclude.some((e) => e.key === pad.key && e.index === i)) return; // already assigned in this wizard run
					if (c.def.range === CENTER && Math.abs(b0) > 0.35) return; // a held, self-centring control springing back
					const d = v - b0;
					if (Math.abs(d) > 0.45 && (!best || Math.abs(d) > Math.abs(best.d))) best = { pad, i, d };
				});
			} else if (c.def.hat) {
				pad.axes.forEach((v, i) => {
					if (Math.abs(base.axes[i]) > 1.05 && Math.abs(v) <= 1.05) best = { pad, binding: { kind: 'hat', index: i } };
				});
				if (pad.mapping === 'standard' && [12, 13, 14, 15].some((i) => pad.buttons[i] && pad.buttons[i].pressed && !base.buttons[i])) best = { pad, binding: { kind: 'dpad' } };
			} else {
				pad.buttons.forEach((b, i) => { if (b.pressed && !base.buttons[i]) best = { pad, binding: bt(i) }; });
			}
		}
		if (!best) return;
		let binding = best.binding;
		if (isAxis) {
			// The prompt asks for the "positive" direction, so the sign of the motion tells us the inversion.
			binding = ax(best.i, best.d < 0);
		}
		// one hardware control per action: replace this action on every other connected device
		for (const pad of this.pads) if (this.profiles[pad.key]) delete this.profiles[pad.key][c.def.id];
		this.profiles[best.pad.key][c.def.id] = binding;
		for (const k of Object.keys(this.latch)) if (k.endsWith(':' + c.def.id)) delete this.latch[k];
		this.save();
		this.capture = null;
		c.done({ pad: best.pad, binding });
	}

	unbind(actionId, padKey) {
		if (this.profiles[padKey]) delete this.profiles[padKey][actionId];
		this.save();
	}

	toggleInvert(actionId, padKey) {
		const b = this.profiles[padKey] && this.profiles[padKey][actionId];
		if (b && b.kind === 'axis') { b.invert = !b.invert; this.save(); }
	}

	describe(b) {
		if (b.kind === 'axis') return `Axis ${b.index}${b.invert ? ' (inv)' : ''}`;
		if (b.kind === 'button') return `Button ${b.index + 1}`;
		if (b.kind === 'hat') return `Hat (axis ${b.index})`;
		if (b.kind === 'dpad') return 'D-pad';
		return '?';
	}

	// live value of an action for the settings UI, normalised to [-1, 1] or [0, 1]
	preview(actionId) {
		const def = ACTION[actionId];
		if (def.range === FULL || actionId === 'trim') return this.level(actionId, true).value;
		if (def.range) return this.axis(actionId).value;
		if (def.hat) { const l = this.look(); return Math.hypot(l.x, l.y) > 0 ? 1 : 0; }
		let v = 0;
		for (const { pad, b } of this._bindings(actionId)) if (b.kind === 'button' && pad.buttons[b.index]) v = Math.max(v, pad.buttons[b.index].value);
		return v;
	}
}
