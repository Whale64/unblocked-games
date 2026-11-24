// STUB (owned by the rendering agent). Post-processing pipeline. See CONTRACT.md §Rendering.
export class PostFX {
	constructor(game) {
		this.game = game;
		this.effects = { damage: 0, death: 0, arrest: 0, slowmo: 0, speed: 0, flash: 0, underwater: 0, wanted: 0 };
	}
	async init() {}
	setSize(w, h) { this.game.renderer.setSize(w, h, false); }
	/** Set a screen effect strength 0..1 (see CONTRACT.md for names). */
	setEffect(name, value) { this.effects[name] = value; }
	render(dt) {
		void dt;
		this.game.renderer.render(this.game.scene, this.game.camera);
	}
}
