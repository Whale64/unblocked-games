// STUB (owned by the UI agent). In-game HUD: minimap, wanted stars, health, money, speedometer, messages.
// See CONTRACT.md §HUD for the events it must listen to and the blip API.
export class HUD {
	constructor(game) { this.game = game; this.blips = []; }
	async init() {
		const el = document.createElement('div');
		el.id = 'hud-stub';
		el.style.cssText = 'position:fixed;left:16px;bottom:16px;font:600 14px system-ui;color:#fff;text-shadow:0 1px 3px #000;pointer-events:none;white-space:pre';
		el.classList.add('hidden');
		document.getElementById('ui').appendChild(el);
		this.el = el;
	}
	show() { this.el.classList.remove('hidden'); }
	hide() { this.el.classList.add('hidden'); }
	/** Add a map/radar blip. opts: { x, z, entity, icon, color, label, route, flash, scale } -> handle { remove(), set(opts) } */
	addBlip(opts = {}) {
		const b = { ...opts };
		b.remove = () => { const i = this.blips.indexOf(b); if (i >= 0) this.blips.splice(i, 1); };
		b.set = (o) => Object.assign(b, o);
		this.blips.push(b);
		return b;
	}
	update() {
		const g = this.game, p = g.player;
		if (!this.el || !p.active) return;
		const v = p.vehicle;
		const h = g.clock.hour;
		const hh = String(Math.floor(h)).padStart(2, '0'), mm = String(Math.floor((h % 1) * 60)).padStart(2, '0');
		this.el.textContent = `$${p.money}   HP ${Math.round(p.health)}   ${hh}:${mm}   ${v ? Math.round(Math.abs(v.speed) * 3.6) + ' km/h' : ''}   FPS ${g.stats.fps.toFixed(0)}`;
	}
}
