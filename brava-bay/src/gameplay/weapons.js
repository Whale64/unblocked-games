// STUB (owned by the police/combat agent). Weapons, shooting, melee, pickups. See CONTRACT.md §Weapons.
export const WEAPONS = {
	fist: { id: 'fist', name: 'Fists', damage: 12, range: 1.6, rate: 2.5, clip: Infinity, auto: false },
	pistol: { id: 'pistol', name: 'Pistol', damage: 28, range: 80, rate: 4, clip: 12, auto: false },
};
export class Weapons {
	constructor(game) { this.game = game; this.current = 'fist'; this.inventory = { fist: { ammo: Infinity, clip: Infinity } }; }
	async init() {}
	give(id, ammo = 0) { void id; void ammo; }
	select(id) { if (this.inventory[id]) this.current = id; }
	/** Fire a weapon from origin in dir on behalf of shooter (player or ped). Returns hit info or null. */
	fire(shooter, origin, dir, weaponId) { void shooter; void origin; void dir; void weaponId; return null; }
	update(dt) { void dt; }
}
