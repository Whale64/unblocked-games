// STUB (owned by the police/combat agent). Particles, decals, skid marks, explosions. See CONTRACT.md §Effects.
export class Effects {
	constructor(game) { this.game = game; }
	async init() {}
	/** One-shot or continuous effect. Returns a handle { stop() } for continuous types. */
	spawn(type, opts = {}) { void type; void opts; return { stop() {}, update() {} }; }
	/** Continuous skid mark per wheel: call every frame while skidding. key identifies the wheel. */
	skidMark(key, position, intensity = 1, width = 0.24) { void key; void position; void intensity; void width; }
	decal(type, position, normal) { void type; void position; void normal; }
	update(dt) { void dt; }
}
