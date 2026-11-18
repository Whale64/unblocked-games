// "Flight controllers" panel: live device monitor, per-action bindings, setup wizard.
import { AXIS_ACTIONS, BUTTON_ACTIONS } from './devices.js';

const TYPE_LABEL = { joystick: 'Joystick / sidestick', yoke: 'Yoke', throttle: 'Throttle', pedals: 'Rudder pedals', gamepad: 'Gamepad' };
const WIZARD = ['roll', 'pitch', 'yaw', 'throttle', 'brakeL', 'brakeR'];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class DevicesUI {
	constructor(dm, root) {
		this.dm = dm;
		this.root = root;
		this.list = root.querySelector('#dev-list');
		this.table = root.querySelector('#dev-bind');
		this.cap = root.querySelector('#dev-capture');
		this.isOpen = false;
		this.sig = '';
		root.querySelector('#dev-close').onclick = () => this.close();
		root.querySelector('#dev-reset').onclick = () => { this.dm.resetProfiles(); this.refresh(); };
		root.querySelector('#dev-wizard').onclick = () => this.runWizard();
		const dz = root.querySelector('#dev-dz'), cv = root.querySelector('#dev-curve'), rb = root.querySelector('#dev-rumble');
		dz.value = dm.settings.deadzone; cv.value = dm.settings.curve; rb.checked = dm.settings.rumble;
		dz.oninput = () => { dm.settings.deadzone = parseFloat(dz.value); dm.save(); };
		cv.oninput = () => { dm.settings.curve = parseFloat(cv.value); dm.save(); };
		rb.onchange = () => { dm.settings.rumble = rb.checked; dm.save(); if (rb.checked) dm.rumble(0.6, 0.6, 250); };
		this.table.addEventListener('click', (e) => this.onTableClick(e));
		window.addEventListener('keydown', (e) => { if (this.isOpen && e.code === 'Escape') { e.stopImmediatePropagation(); if (this.dm.capture) this.dm.cancelCapture(); else this.close(); } }, true);
	}

	open() { this.isOpen = true; this.root.classList.remove('hidden'); this.refresh(); }
	close() { this.dm.cancelCapture(); this.wizard = null; this.isOpen = false; this.root.classList.add('hidden'); }

	refresh() {
		if (!this.isOpen) return;
		const pads = this.dm.pads;
		this.sig = pads.map((p) => p.key).join('|');
		if (!pads.length) {
			this.list.innerHTML = '<div class="dev-empty">No controller detected yet. Plug in your joystick, sidestick, yoke, throttle or rudder pedals and <b>press any button on it</b> (browsers only reveal controllers after a button press).</div>';
		} else {
			this.list.innerHTML = pads.map((p, i) => `
				<div class="dev-card">
					<div class="dev-head"><span class="dev-badge">${TYPE_LABEL[p.type]}</span><span class="dev-name" title="${esc(p.id)}">${esc(p.name)}</span></div>
					<div class="dev-axes">${p.axes.map((_, a) => `<div class="dev-ax"><span>${a}</span><div class="bar"><i data-pad="${i}" data-ax="${a}"></i></div></div>`).join('')}</div>
					<div class="dev-btns">${p.buttons.map((_, b) => `<span class="dot" data-pad="${i}" data-bt="${b}">${b + 1}</span>`).join('')}</div>
				</div>`).join('');
		}
		const row = (a) => {
			const chips = [];
			for (const p of pads) {
				const b = this.dm.profiles[p.key] && this.dm.profiles[p.key][a.id];
				if (!b) continue;
				chips.push(`<span class="chip">${esc(p.name.split(' ').slice(0, 3).join(' '))} · ${this.dm.describe(b)}${b.kind === 'axis' ? `<button data-inv="${a.id}" data-key="${esc(p.key)}" title="Invert">⇅</button>` : ''}<button data-del="${a.id}" data-key="${esc(p.key)}" title="Remove">✕</button></span>`);
			}
			const centered = a.range === 'center';
			return `<tr><td>${a.label}</td><td class="chips">${chips.join('') || '<span class="none">—</span>'}</td>
				<td><div class="meter${centered ? ' c' : ''}"><i data-meter="${a.id}"></i></div></td>
				<td><button class="btn sm" data-bind="${a.id}">Bind</button></td></tr>`;
		};
		this.table.innerHTML = `<tr><th colspan="4">Axes &amp; levers</th></tr>${AXIS_ACTIONS.map(row).join('')}
			<tr><th colspan="4">Buttons &amp; hat switches</th></tr>${BUTTON_ACTIONS.map(row).join('')}`;
	}

	onTableClick(e) {
		const t = e.target.closest('button');
		if (!t) return;
		if (t.dataset.bind) this.capture(t.dataset.bind);
		else if (t.dataset.inv) { this.dm.toggleInvert(t.dataset.inv, t.dataset.key); this.refresh(); }
		else if (t.dataset.del) { this.dm.unbind(t.dataset.del, t.dataset.key); this.refresh(); }
	}

	capture(id, then, exclude = []) {
		const def = [...AXIS_ACTIONS, ...BUTTON_ACTIONS].find((a) => a.id === id);
		const prompt = def.prompt || (def.hat ? 'Push the hat switch in any direction' : `Press the button for “${def.label}”`);
		const step = this.wizard ? `<div class="cap-step">Step ${this.wizard.i + 1} of ${WIZARD.length}</div>` : '';
		this.cap.innerHTML = `${step}<div class="cap-title">${esc(def.label)}</div><div class="cap-state"></div><div class="cap-prompt">${esc(prompt)}</div>
			<div class="cap-hint">Start from the centre / idle position, then move the control all the way. Direction is detected automatically.</div>
			<div class="btns row"><button class="btn sm" id="cap-skip">${this.wizard ? 'Skip (not on my hardware)' : 'Cancel'}</button>${this.wizard ? '<button class="btn sm" id="cap-stop">Stop wizard</button>' : ''}</div>`;
		this.cap.classList.remove('hidden');
		this.cap.querySelector('#cap-skip').onclick = () => this.dm.cancelCapture();
		const stop = this.cap.querySelector('#cap-stop');
		if (stop) stop.onclick = () => { this.wizard = null; this.dm.cancelCapture(); };
		this.dm.startCapture(id, (res) => {
			this.cap.classList.add('hidden');
			this.refresh();
			if (res) this.flash(id);
			if (then) setTimeout(() => then(res), res ? 450 : 50);
		}, exclude);
	}

	runWizard() {
		if (!this.dm.pads.length) { this.refresh(); return; }
		this.wizard = { i: 0, used: [] };
		const next = () => {
			if (!this.wizard || this.wizard.i >= WIZARD.length) { this.wizard = null; return; }
			const id = WIZARD[this.wizard.i];
			this.capture(id, (res) => {
				if (!this.wizard) return;
				if (res && res.binding.kind === 'axis') this.wizard.used.push({ key: res.pad.key, index: res.binding.index });
				this.wizard.i++; next();
			}, this.wizard.used);
		};
		next();
	}

	flash(id) {
		const m = this.table.querySelector(`[data-meter="${id}"]`);
		const tr = m && m.closest('tr');
		if (tr) { tr.classList.add('ok'); setTimeout(() => tr.classList.remove('ok'), 900); }
	}

	// live values, called every frame while open
	update() {
		if (!this.isOpen) return;
		const st = this.cap.querySelector('.cap-state');
		if (st && this.dm.capture) {
			const settling = this.dm.capture.settling;
			st.textContent = settling ? 'Let go: centre the stick and pedals, idle the levers…' : 'Listening. Move the control now';
			st.className = 'cap-state' + (settling ? '' : ' go');
		}
		const pads = this.dm.pads;
		if (pads.map((p) => p.key).join('|') !== this.sig) this.refresh();
		for (const el of this.list.querySelectorAll('i[data-ax]')) {
			const p = pads[+el.dataset.pad];
			const v = p ? p.axes[+el.dataset.ax] : 0;
			const hat = Math.abs(v) > 1.05;
			el.style.left = hat ? '0%' : `${Math.min(50, 50 + v * 50)}%`;
			el.style.width = hat ? '0%' : `${Math.abs(v) * 50}%`;
		}
		for (const el of this.list.querySelectorAll('[data-bt]')) {
			const p = pads[+el.dataset.pad];
			el.classList.toggle('on', !!(p && p.buttons[+el.dataset.bt] && p.buttons[+el.dataset.bt].pressed));
		}
		for (const el of this.table.querySelectorAll('i[data-meter]')) {
			const id = el.dataset.meter;
			const v = this.dm.preview(id);
			if (el.parentElement.classList.contains('c')) { el.style.left = `${Math.min(50, 50 + v * 50)}%`; el.style.width = `${Math.abs(v) * 50}%`; }
			else { el.style.left = '0%'; el.style.width = `${Math.max(0, Math.min(1, v)) * 100}%`; }
		}
	}
}
