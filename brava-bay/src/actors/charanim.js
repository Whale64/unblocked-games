// STUB (owned by the characters agent). Procedural animation. See CONTRACT.md §Characters for the state fields.
export class CharacterAnimator {
	constructor(model) { this.model = model; this.t = 0; }
	/**
	 * state: { speed, sprint, grounded, vy, aim, aimPitch, weapon, fire, punch, seated, steer, dead,
	 *          knockedDown, fleeing, handsUp, phone, sit, swim, lookYaw }
	 */
	update(dt, state = {}) {
		this.t += dt * (1 + (state.speed || 0));
		const b = this.model.bones;
		if (b.spine) b.spine.rotation.x = state.dead ? 0 : Math.sin(this.t * 6) * 0.02 * (state.speed || 0);
		this.model.root.rotation.x = state.dead || state.knockedDown ? -Math.PI / 2 : 0;
	}
}
