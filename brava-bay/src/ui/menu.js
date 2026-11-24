// STUB (owned by the UI agent). Title menu, pause menu (with map/settings/controls tabs).
export class Menu {
	constructor(game) { this.game = game; }
	async init() {
		const ui = document.getElementById('ui');
		const el = document.createElement('div');
		el.id = 'menu-stub';
		el.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:linear-gradient(90deg,rgba(0,0,0,.6),rgba(0,0,0,.1))';
		el.innerHTML = '<div style="font:900 64px system-ui;letter-spacing:.15em;color:#fff">BRAVA BAY</div><button id="menu-play" style="font:700 18px system-ui;padding:12px 40px;border-radius:10px;border:0;cursor:pointer">PLAY</button>';
		el.classList.add('hidden');
		ui.appendChild(el);
		el.querySelector('#menu-play').addEventListener('click', () => this.game.startGame());
		this.el = el;
		const p = document.createElement('div');
		p.id = 'pause-stub';
		p.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);font:800 40px system-ui;color:#fff';
		p.textContent = 'PAUSED (press Esc)';
		p.classList.add('hidden');
		ui.appendChild(p);
		this.pauseEl = p;
	}
	show() { this.el.classList.remove('hidden'); }
	hide() { this.el.classList.add('hidden'); }
	showPause(tab) { void tab; this.pauseEl.classList.remove('hidden'); }
	hidePause() { this.pauseEl.classList.add('hidden'); }
	/** Whether Esc should resume (false while e.g. a key-rebind field is focused). */
	canResumeWithKey() { return true; }
	update() {}
}
