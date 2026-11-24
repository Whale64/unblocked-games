// STUB (owned by the audio agent). WebAudio synthesis: engines, SFX, ambience. See CONTRACT.md §Audio.
export class AudioSystem {
	constructor(game) { this.game = game; this.ctx = null; this.started = false; }
	async init() {}
	/** Must be called from a user gesture. */
	start() {
		if (this.started) return;
		try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); this.started = true; } catch { /* no audio */ }
	}
	play(name, opts = {}) { void name; void opts; }
	setVolumes() {}
	update(dt) { void dt; }
}
