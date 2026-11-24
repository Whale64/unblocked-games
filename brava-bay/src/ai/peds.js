// STUB (owned by the traffic/peds agent). Pedestrians. See CONTRACT.md §Peds.
export class Peds {
	constructor(game) { this.game = game; this.list = []; }
	async init() {}
	/** Spawn a ped. opts: { x, z, yaw, role: 'civilian'|'cop', brain, model opts } -> Ped */
	spawn(opts = {}) { void opts; return null; }
	remove(ped) { void ped; }
	/** Make peds within radius flee from (x,z). */
	panic(x, z, radius = 30, severity = 1) { void x; void z; void radius; void severity; }
	update(dt) { void dt; }
}
