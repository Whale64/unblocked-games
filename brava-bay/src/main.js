// Brava Bay: boot, game state machine and the per-frame system order. See CONTRACT.md.
import * as THREE from 'three';
import { Input } from './core/input.js';
import { Events } from './core/events.js';
import { QUALITY, loadSettings, saveSettings, urlParams } from './core/settings.js';
import { generateCity, WORLD } from './world/citygen.js';
import { Collision, DynamicGrid } from './world/collision.js';
import { Nav, GPS } from './world/nav.js';
import { createRenderer } from './render/renderer.js';
import { PostFX } from './render/postfx.js';
import { Sky } from './render/sky.js';
import { Lighting } from './render/lighting.js';
import { Water } from './world/water.js';
import { Nature } from './world/nature.js';
import { Streets } from './world/streets.js';
import { Buildings } from './world/buildings.js';
import { Effects } from './fx/effects.js';
import { VehicleManager } from './vehicles/vehicle.js';
import { Player } from './actors/player.js';
import { CameraRig } from './actors/camera.js';
import { Traffic } from './ai/traffic.js';
import { Peds } from './ai/peds.js';
import { Wanted } from './gameplay/wanted.js';
import { Police } from './gameplay/police.js';
import { Weapons } from './gameplay/weapons.js';
import { Missions } from './gameplay/missions.js';
import { AudioSystem } from './audio/audio.js';
import { Radio } from './audio/radio.js';
import { HUD } from './ui/hud.js';
import { Menu } from './ui/menu.js';

const $ = (id) => document.getElementById(id);

class Game {
	constructor() {
		this.THREE = THREE;
		this.WORLD = WORLD;
		this.state = 'boot';            // boot | menu | playing | paused | dead | arrested
		this.timeScale = 1;             // simulation speed multiplier (slow-mo on death)
		this.params = urlParams();
		this.settings = loadSettings();
		if (this.params.quality && QUALITY[this.params.quality]) this.settings.quality = this.params.quality;
		this.quality = { ...QUALITY[this.settings.quality], key: this.settings.quality };
		this.clock = {
			time: 0,            // simulation seconds since boot (pauses with the game)
			real: 0,            // real seconds since boot
			dt: 0,              // last simulation dt
			hour: this.params.hour !== undefined ? this.params.hour : 16.5, // world time of day 0..24
			timeScale: this.settings.timeScale,
			frozen: this.params.freezeTime,
			day: 1,
		};
		this.weather = { cloud: 0.25, rain: 0, wetness: 0, wind: 4, fog: 0 }; // owned/updated by Sky
		this.stats = { fps: 60, frameMs: 16, frames: 0 };
		this._deathTimer = 0;
		window.game = this;
		window.__bb = { ready: false, frames: 0, fps: 0, errors: [] };
		window.addEventListener('error', (e) => window.__bb.errors.push(String(e.message || e)));
		window.addEventListener('unhandledrejection', (e) => window.__bb.errors.push(String(e.reason && e.reason.message || e.reason)));
	}

	async boot() {
		const steps = [];
		const progress = (p, msg) => {
			const bar = $('load-bar'), m = $('load-msg');
			if (bar) bar.style.width = `${Math.round(p * 100)}%`;
			if (m) m.textContent = msg;
			return new Promise((r) => setTimeout(r, 0));
		};
		this.progress = progress;
		await progress(0.02, 'Starting renderer…');
		const canvas = $('gl');
		try {
			this.renderer = createRenderer(canvas, this);
		} catch (e) {
			await progress(0, 'WebGL 2 is required to play Brava Bay.');
			throw e;
		}
		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.1, Math.max(3000, this.quality.drawDistance * 2.2));
		this.scene.add(this.camera);
		this.events = new Events();
		this.input = new Input(canvas);
		this.input.sensitivity = this.settings.mouseSensitivity;
		this.input.invertY = this.settings.invertY;

		await progress(0.05, 'Surveying Brava Bay…');
		this.city = generateCity(this.params.seed || 20261123);
		this.collision = new Collision(this.city);
		this.nav = new Nav(this.city);
		this.dyn = new DynamicGrid(12);
		this.gps = new GPS(this);

		// construct systems (cheap), then init (may be async / heavy)
		this.sky = new Sky(this);
		this.lighting = new Lighting(this);
		this.post = new PostFX(this);
		this.water = new Water(this);
		this.nature = new Nature(this);
		this.streets = new Streets(this);
		this.buildings = new Buildings(this);
		this.effects = new Effects(this);
		this.vehicles = new VehicleManager(this);
		this.player = new Player(this);
		this.cameraRig = new CameraRig(this);
		this.traffic = new Traffic(this);
		this.peds = new Peds(this);
		this.wanted = new Wanted(this);
		this.police = new Police(this);
		this.weapons = new Weapons(this);
		this.missions = new Missions(this);
		this.audio = new AudioSystem(this);
		this.radio = new Radio(this);
		this.hud = new HUD(this);
		this.menu = new Menu(this);

		const initOrder = [
			['sky', 'Painting the sky…'], ['lighting', 'Setting up the sun…'], ['post', 'Calibrating the lens…'],
			['water', 'Filling the bay…'], ['nature', 'Planting palms…'], ['streets', 'Paving streets…'],
			['buildings', 'Raising the skyline…'], ['effects', 'Preparing effects…'], ['vehicles', 'Tuning engines…'],
			['player', 'Waking up…'], ['cameraRig', 'Framing the shot…'], ['traffic', 'Starting rush hour…'],
			['peds', 'Filling the sidewalks…'], ['wanted', 'Briefing dispatch…'], ['police', 'Fuelling cruisers…'],
			['weapons', 'Stocking up…'], ['missions', 'Making calls…'], ['audio', 'Tuning the radio…'], ['radio', 'Tuning the radio…'],
			['hud', 'Drawing the map…'], ['menu', 'Almost there…'],
		];
		for (let i = 0; i < initOrder.length; i++) {
			const [key, msg] = initOrder[i];
			await progress(0.08 + 0.82 * (i / initOrder.length), msg);
			const sys = this[key];
			const t0 = performance.now();
			if (sys && sys.init) await sys.init((p, m) => progress(0.08 + 0.82 * ((i + Math.min(1, p || 0)) / initOrder.length), m || msg));
			steps.push([key, Math.round(performance.now() - t0)]);
		}
		this.initTimings = steps;

		await progress(0.92, 'Compiling shaders…');
		this._onResize();
		window.addEventListener('resize', () => this._onResize());
		try { this.renderer.compile(this.scene, this.camera); } catch (e) { console.warn('compile failed', e); }

		// subscribe core flow events
		this.events.on('playerDied', (p) => this._onPlayerDown('dead', p));
		this.events.on('playerArrested', (p) => this._onPlayerDown('arrested', p));
		canvas.addEventListener('click', () => { if (this.state === 'playing') this.input.lockPointer(); });
		document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });

		await progress(1, 'Ready');
		const ld = $('loading');
		if (ld) ld.classList.add('hidden');
		this.state = 'menu';
		this.menu.show();
		this._last = performance.now();
		this.renderer.setAnimationLoop(() => this.frame());
		window.__bb.ready = true;
		if (this.params.autostart) this.startGame({ fromUrl: true });
	}

	/** Called by the menu's Play/Continue buttons (user gesture) or ?autostart. */
	startGame(opts = {}) {
		if (this.state === 'playing') return;
		try { if (!this.params.noAudio) this.audio.start(); } catch (e) { console.warn(e); }
		this.menu.hide();
		this.hud.show();
		this.input.enabled = true;
		let x, z, yaw;
		const sp = this.params.spawn;
		if (sp && sp.length >= 2) { x = sp[0]; z = sp[1]; yaw = sp[2] || 0; } else {
			const home = this.missions.spawnPoint ? this.missions.spawnPoint() : null;
			const poi = home || this.city.poi('safehouse');
			x = poi.x; z = poi.z; yaw = poi.yaw || 0;
		}
		this.player.spawn(x, z, yaw);
		if (this.params.vehicle) {
			const v = this.vehicles.spawn(this.params.vehicle, x, z, yaw, { persistent: true });
			if (v) this.player.enterVehicle(v, { instant: true });
		}
		this.state = 'playing';
		this.events.emit('gameStart', { continued: !!opts.continued });
		if (this.params.wanted) this.wanted.setLevel(this.params.wanted);
		if (this.params.mission) this.missions.start(this.params.mission);
		if (!opts.fromUrl) this.input.lockPointer();
	}

	pause(tab = null) {
		if (this.state !== 'playing') return;
		this.state = 'paused';
		this.input.enabled = false;
		this.input.unlockPointer();
		this.menu.showPause(tab);
		this.events.emit('paused', {});
	}
	resume() {
		if (this.state !== 'paused') return;
		this.state = 'playing';
		this.input.enabled = true;
		this.menu.hidePause();
		this.input.lockPointer();
		this.events.emit('resumed', {});
	}

	_onPlayerDown(kind, payload) {
		if (this.state !== 'playing') return;
		this.state = kind;
		this._deathTimer = kind === 'dead' ? 6 : 5;
		this.timeScale = kind === 'dead' ? 0.3 : 0.6;
		this.events.emit('bigMessage', { title: kind === 'dead' ? 'HOSPITALIZED' : 'ARRESTED', subtitle: kind === 'dead' ? 'Medical bills: $500' : 'Bail: $250', color: kind === 'dead' ? '#ff4d5e' : '#5cb8ff', duration: 5.5, style: 'down' });
		void payload;
	}
	_respawn() {
		const kind = this.state;
		const p = this.player.position;
		const pois = this.city.pois.filter((q) => q.type === (kind === 'dead' ? 'hospital' : 'police'));
		let best = pois[0], bd = 1e18;
		for (const q of pois) { const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2; if (d < bd) { bd = d; best = q; } }
		this.wanted.clear();
		this.player.respawn(best.x, best.z, best.yaw || 0);
		this.player.addMoney(-(kind === 'dead' ? 500 : 250), kind === 'dead' ? 'hospital' : 'bail');
		this.timeScale = 1;
		this.state = 'playing';
		this.events.emit('respawn', { reason: kind, poi: best.id });
	}

	_onResize() {
		const w = window.innerWidth, h = window.innerHeight;
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.post.setSize(w, h);
		this.events && this.events.emit('resize', { width: w, height: h });
	}

	frame() {
		const now = performance.now();
		let dt = (now - this._last) / 1000;
		this._last = now;
		if (!(dt > 0)) dt = 1 / 60;
		dt = Math.min(dt, 0.1);
		this.stats.frameMs = this.stats.frameMs * 0.95 + dt * 1000 * 0.05;
		this.stats.fps = 1000 / this.stats.frameMs;
		this.stats.frames++;
		window.__bb.frames = this.stats.frames;
		window.__bb.fps = Math.round(this.stats.fps * 10) / 10;

		const input = this.input;
		input.update();
		if (input.pressed('pause')) {
			if (this.state === 'playing') this.pause();
			else if (this.state === 'paused' && this.menu.canResumeWithKey()) this.resume();
		}
		if (this.state === 'playing' && input.pressed('map')) this.pause('map');

		const st = this.state;
		const simRunning = st === 'playing' || st === 'dead' || st === 'arrested' || st === 'menu';
		const simDt = simRunning ? dt * this.timeScale : 0;
		this.clock.dt = simDt;
		this.clock.real += dt;
		if (simDt > 0) {
			this.clock.time += simDt;
			if (!this.clock.frozen) {
				this.clock.hour += (simDt * this.clock.timeScale) / 3600;
				if (this.clock.hour >= 24) { this.clock.hour -= 24; this.clock.day++; }
			}
		}
		if (st === 'dead' || st === 'arrested') {
			this._deathTimer -= dt;
			if (this._deathTimer <= 0) this._respawn();
		}

		try {
			if (simDt > 0) {
				// dynamic broadphase
				this.dyn.clear();
				for (const v of this.vehicles.list) this.dyn.insert(v);
				for (const p of this.peds.list) if (p.alive !== false || p.ragdoll) this.dyn.insert(p);
				if (st !== 'menu' && this.player.active) this.dyn.insert(this.player);

				if (st !== 'menu') this.player.update(simDt);
				this.traffic.update(simDt);
				this.police.update(simDt);
				this.peds.update(simDt);
				this.vehicles.update(simDt);
				if (st !== 'menu') this.player.postUpdate(simDt);
				this.weapons.update(simDt);
				this.wanted.update(simDt);
				this.missions.update(simDt);
				this.gps.update(simDt);
			}
			this.cameraRig.update(dt);
			if (this.params.cam) this._debugCamera();
			this.sky.update(dt);
			this.lighting.update(dt);
			this.water.update(dt);
			this.nature.update(dt);
			this.streets.update(dt);
			this.buildings.update(dt);
			this.effects.update(simDt);
			this.audio.update(dt);
			this.radio.update(dt);
			this.hud.update(dt);
			this.menu.update(dt);
			this.post.render(dt);
		} catch (e) {
			if (!this._errShown || this._errShown < 5) { console.error(e); this._errShown = (this._errShown || 0) + 1; }
			window.__bb.errors.push(String(e && e.stack || e));
		}
	}

	_debugCamera() {
		const c = this.params.cam;
		this.camera.position.set(c[0], c[1], c[2]);
		if (c.length >= 6) this.camera.lookAt(c[3], c[4], c[5]);
		this.camera.updateMatrixWorld();
	}

	saveSettings() { saveSettings(this.settings); }
}

const game = new Game();
game.boot().catch((e) => {
	console.error(e);
	window.__bb.errors.push(String(e && e.stack || e));
	const m = $('load-msg');
	if (m) m.textContent = `Failed to start: ${e.message || e}`;
});
