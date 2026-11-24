// STUB (owned by the missions agent). Story missions, side activities, save/load. See CONTRACT.md §Missions.
export class Missions {
	constructor(game) { this.game = game; this.active = null; }
	async init() {}
	/** Optional: where to spawn on New Game / Continue (POI-like {x,z,yaw}) or null. */
	spawnPoint() { return null; }
	start(id) { void id; }
	update(dt) { void dt; }
}
