// STUB (owned by the police/combat agent). Wanted level & crime reporting. See CONTRACT.md §Wanted.
export class Wanted {
	constructor(game) {
		this.game = game;
		this.level = 0; this.heat = 0;
		this.lastSeen = { x: 0, z: 0 }; this.searchRadius = 0; this.seen = false; this.cooldown = 0;
	}
	async init() {}
	report(type, x, z, opts = {}) { void type; void x; void z; void opts; }
	setLevel(n) { const prev = this.level; this.level = Math.max(0, Math.min(5, n | 0)); if (prev !== this.level) this.game.events.emit('wantedChanged', { level: this.level, prev }); }
	clear() { this.setLevel(0); this.heat = 0; }
	update(dt) { void dt; }
}
