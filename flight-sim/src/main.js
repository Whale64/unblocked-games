// Skyward Flight Simulator - main game loop & orchestration.
import * as THREE from 'three';
import { initWorld, getHeight, airports, fromRunwayLocal, nearestAirport } from './world.js';
import { Atmosphere, SUN_INTENSITY } from './atmosphere.js';
import { createCloudTextures, sampleCoverageCPU } from './clouds.js';
import { PostFX } from './postfx.js';
import { Terrain } from './terrain.js';
import { Airports } from './airport.js';
import { AIRCRAFT } from './aircraft-configs.js';
import { buildAircraft, setSurface } from './aircraft-model.js';
import { FlightModel } from './physics.js';
import { Controls } from './controls.js';
import { HUD, computeApproach } from './hud.js';
import { Audio } from './audio.js';
import { Effects } from './effects.js';
import { spawnAircraft } from './spawn.js';

const QUALITY = {
	low: { pixelRatio: 0.75, msaa: 0, cloudScale: 0.33, cloudSteps: 28, bloom: false, shadows: 0, terrainN: 24, terrainSplit: 1.6, terrainMaxLevel: 6, treeRadius: 900, treeDensity: 0.45, treeShadows: false },
	medium: { pixelRatio: 1, msaa: 2, cloudScale: 0.4, cloudSteps: 40, bloom: true, shadows: 1024, terrainN: 32, terrainSplit: 1.9, terrainMaxLevel: 6, treeRadius: 1700, treeDensity: 0.7, treeShadows: false },
	high: { pixelRatio: 1.5, msaa: 4, cloudScale: 0.5, cloudSteps: 56, bloom: true, shadows: 2048, terrainN: 32, terrainSplit: 2.3, terrainMaxLevel: 7, treeRadius: 2500, treeDensity: 1.0, treeShadows: true },
	ultra: { pixelRatio: 2, msaa: 4, cloudScale: 0.6, cloudSteps: 84, bloom: true, shadows: 4096, terrainN: 48, terrainSplit: 2.7, terrainMaxLevel: 7, treeRadius: 3400, treeDensity: 1.3, treeShadows: true },
};
const WEATHER = {
	clear: { coverage: 0, base: 1500, top: 2600, density: 0.03, haze: 3.6e-5 },
	few: { coverage: 0.3, base: 1500, top: 2500, density: 0.035, haze: 4.8e-5 },
	scattered: { coverage: 0.44, base: 1300, top: 2900, density: 0.035, haze: 5.5e-5 },
	broken: { coverage: 0.6, base: 1100, top: 3000, density: 0.04, haze: 9e-5 },
	overcast: { coverage: 0.82, base: 900, top: 2700, density: 0.045, haze: 1.3e-4 },
};
const SPAWNS = {
	runway: { label: 'Runway 10 · Skyward Intl', kind: 'runway', ap: 0 },
	approach: { label: 'Final approach · ILS 10', kind: 'approach', ap: 0 },
	cruise: { label: 'In flight · inbound', kind: 'cruise', ap: 0 },
	mountain: { label: 'Ridgeback Valley (mountain strip)', kind: 'runway', ap: 1 },
	coast: { label: 'Cove Harbour (coastal)', kind: 'runway', ap: 2 },
	mountainApp: { label: 'Approach · Ridgeback Valley', kind: 'approach', ap: 1 },
};
const VIEWS = ['chase', 'cockpit', 'orbit', 'flyby', 'tower'];

const $ = (id) => document.getElementById(id);
const sstep = THREE.MathUtils.smoothstep;

// Pick a sensible default quality from the GPU name (first run only).
function detectQuality() {
	try {
		const c = document.createElement('canvas');
		const gl = c.getContext('webgl2');
		if (!gl) return 'low';
		const ext = gl.getExtension('WEBGL_debug_renderer_info');
		const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
		const mobile = /Android|iPhone|iPad|Mobile|CrOS/i.test(navigator.userAgent);
		if (/SwiftShader|llvmpipe|Software|Basic Render/i.test(name)) return 'low';
		if (mobile || /Mali|Adreno|PowerVR|Intel|UHD|Iris|HD Graphics|Vega [0-9] |Radeon\(TM\) Graphics/i.test(name)) return 'medium';
		if (/RTX [34]0[6-9]0|RTX [45]0[7-9]0|RX [67][89]00|Apple M[1-4] (Pro|Max|Ultra)/i.test(name)) return 'ultra';
		return 'high';
	} catch { return 'medium'; }
}

function loadSettings() {
	const def = { aircraft: 'sparrow', spawn: 'runway', time: 9.5, weather: 'scattered', windSpeed: 8, windDir: 120, turbulence: 0.3, quality: null, invert: false, assist: true, mouseYoke: false, timeFlow: false, volume: 0.8 };
	let s = def;
	try { s = { ...def, ...JSON.parse(localStorage.getItem('skyward-settings') || '{}') }; } catch { /* storage unavailable */ }
	if (!s.quality || !QUALITY[s.quality]) s.quality = detectQuality();
	return s;
}
function saveSettings(s) { try { localStorage.setItem('skyward-settings', JSON.stringify(s)); } catch { /* storage unavailable */ } }

class Game {
	constructor() {
		this.settings = loadSettings();
		this.state = 'boot';
		this.view = 'chase';
		this.time = 0;
		this.clockHour = this.settings.time;
	}

	async boot() {
		const progress = (p, msg) => { $('load-bar').style.width = `${Math.round(p * 100)}%`; $('load-msg').textContent = msg; return new Promise((r) => setTimeout(r, 0)); };
		await progress(0.02, 'Initialising renderer…');
		const canvas = $('gl');
		let renderer;
		try {
			renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance', stencil: false });
		} catch (e) {
			$('load-msg').textContent = 'WebGL 2 is required to run this simulator.';
			throw e;
		}
		this.renderer = renderer;
		renderer.toneMapping = THREE.NoToneMapping;
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		renderer.autoClear = false;

		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(60, 1, 0.25, 140000);
		this.scene.add(this.camera);

		await progress(0.08, 'Surveying terrain & placing airports…');
		initWorld();

		await progress(0.15, 'Generating 3D cloud noise (Perlin-Worley)…');
		this.cloudTex = createCloudTextures();

		await progress(0.35, 'Computing atmospheric scattering…');
		this.atm = new Atmosphere(renderer);
		this.atm.onEnv = (tex) => { this.scene.environment = tex; };
		this.atm.setTime(this.clockHour);

		const q = QUALITY[this.settings.quality] || QUALITY.high;
		this.quality = q;
		this.post = new PostFX(renderer, this.atm, this.cloudTex);
		this.post.setQuality(q);

		await progress(0.45, 'Planting forests & painting farmland…');
		this.terrain = new Terrain(this.scene, this.cloudTex, q);

		await progress(0.55, 'Building airports, lights & hangars…');
		const parkedCfg = AIRCRAFT.sparrow;
		this.airports = new Airports(this.scene, () => {
			const m = buildAircraft(parkedCfg);
			m.disc.visible = false; m.pilot.visible = false;
			return m.root;
		});

		this.sun = new THREE.DirectionalLight(0xffffff, 1);
		this.sun.castShadow = q.shadows > 0;
		this.sun.shadow.mapSize.set(q.shadows || 1024, q.shadows || 1024);
		this.sun.shadow.bias = -0.0004;
		this.sun.shadow.normalBias = 0.04;
		this.scene.add(this.sun, this.sun.target);
		this.landingLight = new THREE.SpotLight(0xfff4e0, 0, 1200, 0.32, 0.5, 1.4);
		this.scene.add(this.landingLight, this.landingLight.target);

		this.effects = new Effects(this.scene);
		this.controls = new Controls(canvas);
		this.hud = new HUD($('hud'));
		this.audio = new Audio();
		this.mapImage = this.buildMapImage();

		this.env = {
			coverage: 0, cloudBase: 1500, cloudTop: 2700, cloudDensity: 0.035, cloudOffset: new THREE.Vector2(),
			haze: 6e-5, hazeH: 1400, exposure: 0.2, time: 0,
		};
		this.applyWeather();
		this.exposure = 0.2;

		window.addEventListener('resize', () => this.resize());
		this.resize();

		await progress(0.65, 'Streaming terrain tiles…');
		// menu backdrop: orbit over the main airport
		this.menuCam = { a: 0 };
		this.camera.position.set(-2200, 420, 900);
		const ap = airports[0];
		this.camera.lookAt(ap.x, ap.elev, ap.z);
		this.atm.update(this.camera.position.y, 0, 1);
		for (let i = 0; i < 6; i++) {
			const left = this.terrain.update(this.camera.position, 1e9, true);
			await progress(0.65 + i * 0.05, `Streaming terrain tiles… (${left} queued)`);
			if (left === 0) break;
		}
		await progress(0.98, 'Compiling shaders…');
		this.cloudShadow = 1;
		this.updateLighting(0.016);
		this.renderFrame(0.016);
		await progress(1, 'Ready');
		$('loading').classList.add('hidden');
		this.setupMenu();
		this.state = 'menu';
		$('menu').classList.remove('hidden');
		this.last = performance.now();
		requestAnimationFrame((t) => this.loop(t));
	}

	buildMapImage() {
		const N = 220, R = 90000;
		const c = document.createElement('canvas');
		c.width = c.height = N;
		const g = c.getContext('2d');
		const img = g.createImageData(N, N);
		for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
			const x = -R + (i + 0.5) / N * 2 * R, z = -R + (j + 0.5) / N * 2 * R;
			const h = getHeight(x, z);
			const o = (j * N + i) * 4;
			if (h < 0) { img.data[o] = 10; img.data[o + 1] = 40; img.data[o + 2] = 80; }
			else { const k = Math.min(1, h / 2500); img.data[o] = 40 + k * 120; img.data[o + 1] = 70 + k * 80; img.data[o + 2] = 35 + k * 110; }
			img.data[o + 3] = 255;
		}
		g.putImageData(img, 0, 0);
		return { canvas: c, x0: -R, z0: -R, metresPerPixel: 2 * R / N };
	}

	applyWeather() {
		const w = WEATHER[this.settings.weather] || WEATHER.scattered;
		Object.assign(this.env, { coverage: w.coverage, cloudBase: w.base, cloudTop: w.top, cloudDensity: w.density, haze: w.haze });
	}

	resize() {
		const w = window.innerWidth, h = window.innerHeight;
		const pr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio) * (this.resScale || 1));
		this.renderer.setPixelRatio(pr);
		this.renderer.setSize(w, h, false);
		$('gl').style.width = w + 'px'; $('gl').style.height = h + 'px';
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.post.setSize(Math.round(w * pr), Math.round(h * pr));
		this.hud.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
		this.pxHeight = h * pr;
	}

	// ------------------------------------------------------------------ menu
	setupMenu() {
		const s = this.settings;
		const cards = $('aircraft-cards');
		cards.innerHTML = '';
		for (const id of Object.keys(AIRCRAFT)) {
			const a = AIRCRAFT[id];
			const el = document.createElement('button');
			el.className = 'card' + (s.aircraft === id ? ' sel' : '');
			el.innerHTML = `<div class="card-name">${a.name}</div><div class="card-role">${a.role}</div>
				<div class="card-stats"><span>Vs ${a.vs} kt</span><span>Vne ${a.vne} kt</span><span>${a.fbw ? 'Fly-by-wire' : 'Mechanical'}</span><span>${(a.mass / 1000).toFixed(1)} t</span></div>`;
			el.onclick = () => { s.aircraft = id; [...cards.children].forEach((c) => c.classList.remove('sel')); el.classList.add('sel'); };
			cards.appendChild(el);
		}
		const sp = $('spawn');
		sp.innerHTML = Object.entries(SPAWNS).filter(([, v]) => airports[v.ap]).map(([k, v]) => `<option value="${k}">${v.label.replace('10', String(airports[v.ap].numA).padStart(2, '0'))}</option>`).join('');
		const bind = (id, key, conv = (v) => v, live) => {
			const el = $(id);
			if (el.type === 'checkbox') el.checked = !!s[key]; else el.value = s[key];
			const on = () => { s[key] = el.type === 'checkbox' ? el.checked : conv(el.value); if (live) live(); this.updateMenuLabels(); };
			el.oninput = on; el.onchange = on;
		};
		bind('spawn', 'spawn');
		bind('time', 'time', parseFloat, () => { this.clockHour = s.time; this.atm.setTime(s.time); });
		bind('weather', 'weather', String, () => this.applyWeather());
		bind('wind-speed', 'windSpeed', parseFloat);
		bind('wind-dir', 'windDir', parseFloat);
		bind('turb', 'turbulence', parseFloat);
		bind('quality', 'quality');
		bind('invert', 'invert');
		bind('assist', 'assist');
		bind('mouse-yoke', 'mouseYoke');
		bind('time-flow', 'timeFlow');
		bind('volume', 'volume', parseFloat, () => this.audio.setVolume(s.volume));
		this.updateMenuLabels();
		$('fly').onclick = () => this.startFlight();
		$('resume').onclick = () => this.togglePause(false);
		$('restart').onclick = () => { this.togglePause(false); this.startFlight(); };
		$('to-menu').onclick = () => this.toMenu();
		$('crash-restart').onclick = () => this.startFlight();
		$('crash-menu').onclick = () => this.toMenu();
		$('help-btn').onclick = () => $('help').classList.toggle('hidden');
		$('help-close').onclick = () => $('help').classList.add('hidden');
	}

	updateMenuLabels() {
		const s = this.settings;
		const h = Math.floor(s.time), m = Math.round((s.time - h) * 60);
		$('time-label').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
		$('wind-label').textContent = `${String(Math.round(s.windDir)).padStart(3, '0')}° / ${Math.round(s.windSpeed)} kt`;
		$('turb-label').textContent = s.turbulence < 0.05 ? 'Smooth' : s.turbulence < 0.4 ? 'Light' : s.turbulence < 0.8 ? 'Moderate' : 'Severe';
	}

	startFlight() {
		const s = this.settings;
		saveSettings(s);
		const q = QUALITY[s.quality] || QUALITY.high;
		if (q !== this.quality) {
			this.quality = q;
			this.post.setQuality(q);
			this.terrain.setQuality(q);
			this.sun.castShadow = q.shadows > 0;
			if (q.shadows) { this.sun.shadow.mapSize.set(q.shadows, q.shadows); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
			this.resize();
		}
		this.applyWeather();
		this.clockHour = s.time;
		this.atm.setTime(s.time);
		const cfg = AIRCRAFT[s.aircraft] || AIRCRAFT.sparrow;
		this.cfg = cfg;
		if (this.model) { this.scene.remove(this.model.root); }
		this.model = buildAircraft(cfg);
		this.scene.add(this.model.root);
		this.fm = new FlightModel(cfg);
		const sp = SPAWNS[s.spawn] || SPAWNS.runway;
		const r = spawnAircraft(this.fm, cfg, sp.kind, sp.ap) || {};
		this.controls.throttle = r.throttle ?? 0;
		this.controls.invertPitch = s.invert;
		this.controls.mouseYoke = s.mouseYoke;
		this.controls.axes = { pitch: 0, roll: 0, yaw: 0 };
		const wd = s.windDir * Math.PI / 180;
		this.fm.windBase.set(-Math.sin(wd), 0, Math.cos(wd)).multiplyScalar(s.windSpeed / 1.94384);
		this.fm.turb = s.turbulence * 2.2;
		this.effects.clear();
		this.view = sp.kind === 'runway' ? 'chase' : 'chase';
		this.cam = { yaw: 0, pitch: 0, dist: cfg.chase.dist, orbitYaw: 0.6, orbitPitch: 0.2, headYaw: 0, headPitch: 0, q: this.fm.quat.clone(), idle: 0, flyby: null, shake: 0, fov: 60 };
		this.audio.init(cfg.engine);
		this.audio.setVolume(s.volume);
		this.controls.enabled = true;
		this.crashTimer = 0;
		this.fade = 1;
		this.landingInfo = null;
		this.accum = 0;
		this.prevVel = this.fm.vel.clone();
		$('menu').classList.add('hidden');
		$('pause').classList.add('hidden');
		$('crash').classList.add('hidden');
		$('help').classList.add('hidden');
		this.state = 'flying';
		this.paused = false;
		this.hud.toasts = [];
		this.hud.toast(`${cfg.name} · ${sp.label.replace('10', String(airports[sp.ap].numA).padStart(2, '0'))}`, '#cfe8ff', 4);
		if (sp.kind === 'runway') this.hud.toast('Throttle up (Shift / R), rotate at ' + cfg.vr + ' kt (S / ↓)', '#ffffff', 6);
		// pre-stream terrain at the spawn
		this.terrain.update(this.fm.pos, 1e9, true);
	}

	toMenu() {
		this.state = 'menu';
		this.paused = false;
		this.controls.enabled = false;
		$('pause').classList.add('hidden');
		$('crash').classList.add('hidden');
		$('menu').classList.remove('hidden');
		if (this.model) { this.scene.remove(this.model.root); this.model = null; }
		if (this.audio.ctx) this.audio.ctx.suspend();
	}

	togglePause(v = !this.paused) {
		if (this.state !== 'flying') return;
		this.paused = v;
		$('pause').classList.toggle('hidden', !v);
		if (this.audio.ctx) { if (v) this.audio.ctx.suspend(); else this.audio.ctx.resume(); }
	}

	// ------------------------------------------------------------------ input actions
	handleActions() {
		const c = this.controls, fm = this.fm, cfg = this.cfg;
		if (c.hit('Escape') || c.hit('KeyP')) { this.togglePause(); return; }
		if (c.hit('KeyH')) $('help').classList.toggle('hidden');
		if (this.paused) return;
		if (c.hit('Backspace')) { this.startFlight(); return; }
		if (c.hit('KeyC')) { this.view = VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length]; this.hud.toast(`View: ${this.view}`, '#ddd', 1.2); this.cam.flyby = null; }
		if (c.hit('KeyV')) { this.view = this.view === 'cockpit' ? 'chase' : 'cockpit'; }
		for (const [k, v] of [['F1', 'cockpit'], ['F2', 'chase'], ['F3', 'orbit'], ['F4', 'flyby'], ['F5', 'tower']]) if (c.hit(k)) { this.view = v; this.cam.flyby = null; }
		if (c.hit('KeyI')) this.hud.visible = !this.hud.visible;
		if (c.hit('KeyG') && cfg.retractable) {
			if (fm.onGround && fm.gearDown) this.hud.toast('Gear handle locked on the ground', '#ffc048');
			else { fm.gearDown = !fm.gearDown; this.hud.toast(fm.gearDown ? 'Gear DOWN' : 'Gear UP', '#fff'); this.audio.oneShot('thunk'); }
		}
		const det = cfg.flapDetents;
		const idx = det.reduce((bi, d, i) => (Math.abs(d - fm.flapTarget) < Math.abs(det[bi] - fm.flapTarget) ? i : bi), 0);
		if (c.hit('BracketRight') || c.hit('KeyX')) { fm.flapTarget = det[Math.min(det.length - 1, idx + 1)]; this.hud.toast(`Flaps ${Math.round(fm.flapTarget * (cfg.engine === 'prop' ? 30 : 20))}°`, '#fff', 1.4); this.audio.oneShot('click'); }
		if (c.hit('BracketLeft') || c.hit('KeyZ')) { fm.flapTarget = det[Math.max(0, idx - 1)]; this.hud.toast(`Flaps ${Math.round(fm.flapTarget * (cfg.engine === 'prop' ? 30 : 20))}°`, '#fff', 1.4); this.audio.oneShot('click'); }
		if (c.hit('KeyB') && c.shift()) { fm.parkBrake = !fm.parkBrake; this.hud.toast(fm.parkBrake ? 'Parking brake SET' : 'Parking brake released', '#ffc048'); }
		if (c.hit('KeyM')) { c.mouseYoke = !c.mouseYoke; this.settings.mouseYoke = c.mouseYoke; this.hud.toast(c.mouseYoke ? 'Mouse yoke ON' : 'Mouse yoke OFF', '#fff'); }
		if (c.hit('KeyT')) { this.clockHour = (this.clockHour + (c.shift() ? -0.5 : 0.5) + 24) % 24; this.atm.setTime(this.clockHour); }
		if (c.hit('KeyK')) { this.settings.assist = !this.settings.assist; this.hud.toast(this.settings.assist ? 'Flight assist ON (path & bank hold)' : 'Flight assist OFF (raw controls)', '#fff', 2); }
		if (c.hit('KeyN')) { this.audio.enabled = !this.audio.enabled; this.hud.toast(this.audio.enabled ? 'Sound on' : 'Sound muted', '#fff'); }
		const trimRate = 0.25;
		if (c.down('Comma', 'Home')) fm.trim = Math.max(-1, fm.trim - trimRate * this.dt);
		if (c.down('Period', 'End')) fm.trim = Math.min(1, fm.trim + trimRate * this.dt);
	}

	// ------------------------------------------------------------------ simulation
	simulate(dt) {
		const fm = this.fm, c = this.controls;
		c.update(dt);
		this.handleActions();
		if (this.paused || this.state !== 'flying') return;
		const ctl = {
			pitch: c.axes.pitch, roll: c.axes.roll, yaw: c.axes.yaw, throttle: c.throttle,
			brake: c.down('Space', 'KeyB', 'PadBrake') && !c.shift() ? 1 : 0,
			airbrake: c.down('KeyY', 'Slash'),
			assist: this.settings.assist,
		};
		this.ctl = ctl;
		const H = 1 / 240;
		this.accum = Math.min(this.accum + dt, 0.25);
		let steps = 0;
		while (this.accum >= H && steps < 60) {
			fm.step(H, ctl);
			this.accum -= H; steps++;
			if (fm.crashed) break;
		}
		this.accelAlong = this.prevVel ? fm.vel.clone().sub(this.prevVel).dot(fm.vel.clone().normalize()) / Math.max(dt, 1e-3) : 0;
		this.prevVel = fm.vel.clone();
		for (const e of fm.events.splice(0)) this.onEvent(e);
	}

	onEvent(e) {
		const fm = this.fm;
		if (e.type === 'touchdown') {
			const fpm = Math.round(-e.vs * 196.85);
			const rating = fpm < 120 ? ['Butter! Greaser landing', '#7dffb0'] : fpm < 300 ? ['Smooth landing', '#b6ffcf'] : fpm < 550 ? ['Firm landing', '#ffe08a'] : ['Hard landing!', '#ff8a6a'];
			this.hud.toast(`${rating[0]} · ${fpm} fpm`, rating[1], 4);
			this.audio.oneShot('chirp', Math.min(1.5, 0.4 + fpm / 400));
			for (const g of this.cfg.gear.slice(1)) {
				const p = new THREE.Vector3(...g.p).applyQuaternion(fm.quat).add(fm.pos);
				this.effects.tyreSmoke(p, 1 + fpm / 200);
			}
			this.cam.shake = Math.min(1, fpm / 700);
		} else if (e.type === 'crash') {
			const water = /water/i.test(e.reason);
			if (water) { this.effects.splash(fm.pos, fm.vel); this.audio.oneShot('splash'); }
			else { this.effects.explode(fm.pos.clone(), fm.vel.clone()); this.audio.oneShot('explosion'); this.flash = 1; }
			this.model.root.visible = false;
			this.crashTimer = 2.5;
			$('crash-reason').textContent = e.reason;
			const t = fm.telemetry();
			$('crash-stats').textContent = `${Math.round(t.ias)} kt · ${Math.round(t.vs)} fpm · max ${t.maxG.toFixed(1)} G`;
		} else if (e.type === 'scrape') {
			if (Math.random() < 0.3) this.effects.tyreSmoke(e.p, 0.6);
		}
	}

	// ------------------------------------------------------------------ visuals
	updateAircraftVisuals(dt) {
		const fm = this.fm, m = this.model, cfg = this.cfg, s = m.surfaces;
		if (!m) return;
		m.root.position.copy(fm.pos);
		m.root.quaternion.copy(fm.quat);
		setSurface(s.ailR, -fm.da * cfg.daMax);
		setSurface(s.ailL, fm.da * cfg.daMax);
		setSurface(s.elevR, -fm.de * cfg.deMax);
		setSurface(s.elevL, -fm.de * cfg.deMax);
		const flapA = fm.flap * (cfg.engine === 'prop' ? 30 : 20) * Math.PI / 180;
		setSurface(s.flapR, flapA); setSurface(s.flapL, flapA);
		setSurface(s.rudder, fm.dr * cfg.drMax);
		if (s.airbrake) s.airbrake.rotation.x = -fm.airbrake * 0.95;
		const t = this.time;
		// lights
		const strobe = (t % 1.3) < 0.06 || ((t - 0.15) % 1.3 + 1.3) % 1.3 < 0.05;
		s.strobe.material.color.setRGB(1, 1, 1).multiplyScalar(strobe ? 60 : 0);
		const beacon = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 0.9);
		s.beacon.material.color.setRGB(1, 0.08, 0.04).multiplyScalar(Math.pow(beacon, 6) * 30);
		// propeller / jet exhaust
		if (m.type === 'prop') {
			m.prop.rotation.z -= fm.rpm / 60 * Math.PI * 2 * dt;
			const blur = sstep(fm.rpm, 500, 1100);
			m.discMat.uniforms.uAlpha.value = blur * (this.view === 'cockpit' ? 0.35 : 1);
			m.discMat.uniforms.uLight.value.copy(this.smokeLight || new THREE.Color(1, 1, 1));
			m.prop.children.forEach((b) => { b.visible = blur < 0.85; });
			m.spinner.rotation.y = m.prop.rotation.z;
		} else {
			const ab = fm.ab, eng = fm.engine;
			m.flame.scale.set(1 + ab * 0.25, 1 + ab * 0.25, 0.6 + eng * 1.4 + ab * 5.5);
			m.flameMat.uniforms.uAB.value = ab;
			m.flameMat.uniforms.uPower.value = 0.25 + eng * 0.6 + ab;
			m.flameMat.uniforms.uTime.value = t;
		}
		// gear
		m.gear.forEach((g, i) => {
			const st = fm.gearState[i];
			if (cfg.retractable) {
				const a = (1 - fm.gearPos) * g.retractAngle;
				g.grp.quaternion.setFromAxisAngle(g.retractAxis, a);
				g.grp.visible = fm.gearPos > 0.02;
				g.wheel.position.copy(g.base).add(new THREE.Vector3(0, st.comp, 0));
			} else {
				g.wheel.position.copy(g.base).add(new THREE.Vector3(0, st.comp, 0));
			}
			g.wheel.rotation.x = -st.wheelRot;
			if (i === 0) g.wheel.rotation.y = this.ctl ? this.ctl.yaw * 0.5 * Math.max(0.15, 1 - fm.tel.gs / 90) : 0;
		});
		// cockpit stick
		if (m.cockpit.userData.stick) m.cockpit.userData.stick.rotation.set(fm.de * 0.3, 0, -fm.da * 0.3);
		const inside = this.view === 'cockpit';
		m.pilot.visible = !inside;
		m.canopy.visible = !inside;
	}

	updateEffects(dt, tel) {
		const fm = this.fm, cfg = this.cfg;
		if (fm.crashed) return;
		const R = fm.quat;
		const humid = 1 - sstep(fm.pos.y, 3000, 7000);
		const vortex = sstep(Math.abs(fm.nz), 2.8, 5.5) * sstep(tel.ias, 120, 220) * (0.4 + 0.6 * humid);
		const tipX = cfg.b / 2 - 0.1;
		if (vortex > 0.01) {
			const yTip = cfg.engine === 'prop' ? -0.05 : -0.2, zTip = cfg.engine === 'prop' ? -0.1 : 0.8;
			this.effects.vortexL.add(new THREE.Vector3(-tipX, yTip, zTip).applyQuaternion(R).add(fm.pos), 0.5 * vortex, 0.35, 1.2);
			this.effects.vortexR.add(new THREE.Vector3(tipX, yTip, zTip).applyQuaternion(R).add(fm.pos), 0.5 * vortex, 0.35, 1.2);
		}
		// wing condensation cloud at very high lift + humidity
		const vapor = sstep(fm.nz, 5, 8) * humid * sstep(tel.ias, 250, 380);
		if (vapor > 0.02 && Math.random() < vapor) {
			for (let i = 0; i < 3; i++) {
				const x = (Math.random() - 0.5) * cfg.b * 0.7, z = (Math.random() - 0.3) * 4;
				const p = new THREE.Vector3(x, 0.6, z).applyQuaternion(R).add(fm.pos);
				this.effects.smoke.spawn(p, fm.vel.clone().multiplyScalar(0.9), 0.25, 1.5, 3, [1, 1, 1], 0.35 * vapor, 3, 0);
			}
		}
		// contrail at high altitude for the jet
		if (cfg.engine === 'jet' && fm.pos.y > 7800) {
			const a = sstep(fm.pos.y, 7800, 9000) * (0.3 + fm.engine * 0.5);
			this.effects.contrail.add(new THREE.Vector3(0, 0.04, 14).applyQuaternion(R).add(fm.pos), a, 2.5, 50);
		}
		// dust/spray when rolling fast on grass or touching water spray
		if (fm.onGround && tel.gs > 25) {
			const p = fm.pos;
			const onPaved = airports.some((ap) => { const l = { u: (p.x - ap.x) * ap.dir.x + (p.z - ap.z) * ap.dir.z, v: (p.x - ap.x) * ap.right.x + (p.z - ap.z) * ap.right.z }; return Math.abs(l.u) < ap.length / 2 + 60 && Math.abs(l.v) < ap.width / 2 + 8; });
			if (!onPaved && Math.random() < 0.5) this.effects.smoke.spawn(p.clone().add(new THREE.Vector3(0, -1.2, 0)), new THREE.Vector3(0, 1, 0), 2, 1, 6, [0.32, 0.27, 0.2], 0.4, 1, 0.2);
		}
		// jet heat shimmer / AB smoke-free; prop: slight exhaust at startup
		if (cfg.engine === 'prop' && fm.engine > 0.6 && fm.pos.y - getHeight(fm.pos.x, fm.pos.z) < 3 && Math.random() < 0.15) {
			this.effects.smoke.spawn(new THREE.Vector3(0.35, -0.35, -2.4).applyQuaternion(R).add(fm.pos), fm.vel.clone().multiplyScalar(0.5).add(new THREE.Vector3(0, 0.3, 0)), 0.8, 0.2, 1.4, [0.4, 0.4, 0.42], 0.18, 2, 0.5);
		}
	}

	updateCamera(dt) {
		const cam = this.camera, fm = this.fm, cfg = this.cfg, c = this.cam;
		const md = this.controls.consumeMouse();
		const shake = (c.shake || 0) + this.effects.shake + (fm.tel.buffet || 0) * 0.35 + (fm.onGround ? Math.min(0.15, fm.tel.gs / 400) : 0);
		c.shake = Math.max(0, (c.shake || 0) - dt * 1.5);
		const sx = (Math.random() - 0.5) * shake * 0.04, sy = (Math.random() - 0.5) * shake * 0.04;
		let fov = 60;
		const pos = fm.pos;
		if (this.view === 'cockpit') {
			if (md.dx || md.dy) { c.headYaw -= md.dx * 0.004; c.headPitch -= md.dy * 0.004; c.idle = 0; } else c.idle += dt;
			c.headYaw = THREE.MathUtils.clamp(c.headYaw, -2.6, 2.6);
			c.headPitch = THREE.MathUtils.clamp(c.headPitch, -1.2, 1.3);
			if (c.idle > 1.5 && !this.controls.mouse.dragging) { c.headYaw *= Math.exp(-dt * 2); c.headPitch *= Math.exp(-dt * 2); }
			// G-induced head movement
			const accB = this.fm.accel.clone().applyQuaternion(fm.quat.clone().invert());
			const eye = new THREE.Vector3(...cfg.eye).add(new THREE.Vector3(-accB.x * 0.002, -THREE.MathUtils.clamp((fm.nz - 1) * 0.012, -0.05, 0.08), 0));
			cam.position.copy(eye.applyQuaternion(fm.quat).add(pos));
			cam.quaternion.copy(fm.quat).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(c.headPitch + sy, c.headYaw + sx, 0, 'YXZ')));
			fov = 72 - Math.min(10, md.wheel);
			cam.near = 0.08;
		} else {
			cam.near = 0.3;
			if (md.wheel) c.dist = THREE.MathUtils.clamp(c.dist * (1 + md.wheel * 0.1), cfg.chase.dist * 0.4, cfg.chase.dist * 6);
			if (this.view === 'chase') {
				if (md.dx || md.dy) { c.yaw -= md.dx * 0.005; c.pitch = THREE.MathUtils.clamp(c.pitch + md.dy * 0.004, -0.6, 1.2); c.idle = 0; } else c.idle += dt;
				if (c.idle > 2 && !this.controls.mouse.dragging) { c.yaw *= Math.exp(-dt * 1.5); c.pitch *= Math.exp(-dt * 1.5); }
				// lagged orientation (yaw/pitch follow, partial roll)
				c.q.slerp(fm.quat, 1 - Math.exp(-dt * 3.5));
				const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(c.q);
				const flatYaw = Math.atan2(-fwd.x, -fwd.z);
				const pitchA = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
				const yaw = flatYaw + c.yaw;
				const pt = pitchA * 0.85 - 0.12 - c.pitch;
				const off = new THREE.Vector3(0, 0, c.dist).applyEuler(new THREE.Euler(pt, yaw, 0, 'YXZ'));
				off.y += cfg.chase.height * 0.4;
				cam.position.copy(pos).add(off);
				const look = pos.clone().add(new THREE.Vector3(0, cfg.chase.height * 0.25, 0));
				cam.up.set(0, 1, 0);
				const upB = new THREE.Vector3(0, 1, 0).applyQuaternion(c.q);
				cam.up.lerp(upB, 0.25).normalize();
				cam.lookAt(look);
				fov = 58 + Math.min(12, fm.tel.ias / 60);
			} else if (this.view === 'orbit') {
				if (md.dx || md.dy) { c.orbitYaw -= md.dx * 0.006; c.orbitPitch = THREE.MathUtils.clamp(c.orbitPitch + md.dy * 0.005, -1.4, 1.45); }
				else c.orbitYaw += dt * 0.05;
				const off = new THREE.Vector3(0, 0, c.dist * 1.2).applyEuler(new THREE.Euler(-c.orbitPitch, c.orbitYaw, 0, 'YXZ'));
				cam.position.copy(pos).add(off);
				cam.up.set(0, 1, 0);
				cam.lookAt(pos);
			} else if (this.view === 'flyby') {
				const ahead = fm.vel.clone();
				if (!c.flyby || c.flyby.distanceTo(pos) > Math.max(600, fm.vel.length() * 6) || (ahead.lengthSq() > 1 && c.flyby.clone().sub(pos).dot(ahead) < -fm.vel.length() * 3)) {
					const sp = Math.max(fm.vel.length(), 10);
					const dir = ahead.lengthSq() > 1 ? ahead.normalize() : new THREE.Vector3(0, 0, -1).applyQuaternion(fm.quat);
					const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
					c.flyby = pos.clone().addScaledVector(dir, sp * 3.5).addScaledVector(side, 25 + Math.random() * 25).add(new THREE.Vector3(0, -6 + Math.random() * 14, 0));
				}
				cam.position.copy(c.flyby);
				cam.up.set(0, 1, 0);
				cam.lookAt(pos);
				const d = cam.position.distanceTo(pos);
				fov = THREE.MathUtils.clamp(2 * Math.atan(28 / d) * 180 / Math.PI, 8, 65);
			} else if (this.view === 'tower') {
				const { ap } = nearestAirport(pos.x, pos.z);
				const tp = ap.main ? fromRunwayLocal(ap, 150, 375) : fromRunwayLocal(ap, 0, 300);
				cam.position.set(tp.x, ap.elev + (ap.main ? 46 : 20), tp.z);
				cam.up.set(0, 1, 0);
				cam.lookAt(pos);
				const d = cam.position.distanceTo(pos);
				fov = THREE.MathUtils.clamp(2 * Math.atan(22 / d) * 180 / Math.PI, 1.5, 60);
			}
			cam.position.x += sx * 2; cam.position.y += sy * 2;
			const gh = Math.max(getHeight(cam.position.x, cam.position.z), 0) + 1.2;
			if (cam.position.y < gh) cam.position.y = gh;
		}
		c.fov += (fov - c.fov) * Math.min(1, dt * 4);
		cam.fov = c.fov;
		cam.updateProjectionMatrix();
	}

	updateMenuCamera(dt) {
		const ap = airports[0];
		this.menuCam.a += dt * 0.03;
		const a = this.menuCam.a;
		const p = fromRunwayLocal(ap, Math.cos(a) * 2600, 150 + Math.sin(a) * 2600);
		this.camera.position.set(p.x, ap.elev + 380 + Math.sin(a * 0.7) * 120, p.z);
		this.camera.up.set(0, 1, 0);
		this.camera.lookAt(ap.x, ap.elev + 30, ap.z);
		this.camera.fov = 55; this.camera.near = 0.5;
		this.camera.updateProjectionMatrix();
	}

	updateLighting(dt) {
		const atm = this.atm, cam = this.camera, env = this.env;
		atm.update(cam.position.y, dt, 1 + env.haze * 6000);
		// cloud motion with wind at cloud altitude
		const wind = this.fm ? this.fm.windBase : new THREE.Vector3(3, 0, 1);
		env.cloudOffset.x -= wind.x * 1.6 * dt;
		env.cloudOffset.y -= wind.z * 1.6 * dt;
		env.time = this.time;
		env.hazeH = 1400;
		const focus = this.fm && this.state !== 'menu' ? this.fm.pos : new THREE.Vector3(airports[0].x, airports[0].elev, airports[0].z);
		// cloud shadow at the focus point
		let cs = 1;
		if (env.coverage > 0.01) {
			const L = atm.lightDir;
			const mid = (env.cloudBase + env.cloudTop) / 2;
			const tt = Math.max(mid - focus.y, 0) / Math.max(L.y, 0.08);
			const cov = sampleCoverageCPU(this.cloudTex.weatherData, focus.x + L.x * tt, focus.z + L.z * tt, env.cloudOffset, env.coverage);
			cs = focus.y < env.cloudTop ? 1 - cov * 0.85 : 1;
		}
		this.cloudShadow = cs;
		this.sun.color.copy(atm.lightColor);
		this.sun.intensity = atm.lightIntensity * cs;
		const sr = this.cfg && this.cfg.engine === 'jet' ? 55 : 40;
		this.sun.shadow.camera.left = -sr; this.sun.shadow.camera.right = sr;
		this.sun.shadow.camera.top = sr; this.sun.shadow.camera.bottom = -sr;
		this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 1200;
		this.sun.shadow.camera.updateProjectionMatrix();
		this.sun.target.position.copy(focus);
		this.sun.position.copy(focus).addScaledVector(atm.lightDir, 600);
		this.sun.target.updateMatrixWorld();
		// cloud lighting inputs
		atm.cloudLight = (atm.cloudLight || new THREE.Color()).copy(atm.night > 0.5 ? atm.lightColor : atm.sunColorClouds).multiplyScalar(atm.night > 0.5 ? atm.lightIntensity : SUN_INTENSITY);
		const sunUp = Math.max(atm.sunDir.y, 0);
		atm.groundBounce = (atm.groundBounce || new THREE.Color()).copy(atm.sunColorT).multiplyScalar(SUN_INTENSITY * sunUp * 0.09 / Math.PI * (1 - env.coverage * 0.5));
		// exposure (simple eye adaptation)
		const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
		const sunE = SUN_INTENSITY * lum(atm.sunColorT) * Math.max(atm.sunDir.y, 0) * (1 - env.coverage * 0.55);
		const skyE = SUN_INTENSITY * 0.22 * sstep(atm.sunDir.y, -0.12, 0.35);
		const moonE = 0.05 * atm.night;
		const E = sunE + skyE + moonE + 0.02;
		// partial adaptation: the eye/camera does not fully compensate for dusk and night
		const target = THREE.MathUtils.clamp(Math.pow(Math.PI * 1.25 / E, 0.8) * 0.72, 0.08, 9);
		this.exposure = Math.exp(THREE.MathUtils.lerp(Math.log(this.exposure), Math.log(target), 1 - Math.exp(-dt * 1.2)));
		env.exposure = this.exposure;
		this.terrain.setEnv(env, atm.lightDir, this.time);
		// landing light at night
		if (this.fm && this.model && this.state !== 'menu') {
			const on = atm.night > 0.25 && !this.fm.crashed;
			this.landingLight.intensity = on ? 9000 : 0;
			const lp = new THREE.Vector3(0, -0.5, this.cfg.engine === 'jet' ? -5.5 : -2.6).applyQuaternion(this.fm.quat).add(this.fm.pos);
			this.landingLight.position.copy(lp);
			this.landingLight.target.position.copy(new THREE.Vector3(0, -0.12, -1).applyQuaternion(this.fm.quat).multiplyScalar(100).add(lp));
			this.landingLight.target.updateMatrixWorld();
		} else this.landingLight.intensity = 0;
	}

	// Dynamic resolution: keep the frame rate playable on weaker GPUs.
	adaptResolution(dt) {
		if (this.state !== 'flying' || this.paused) return;
		this.resScale = this.resScale || 1;
		this.resTimer = (this.resTimer || 0) + dt;
		if (this.resTimer < 2.5) return;
		const fps = this.hud.fps;
		let next = this.resScale;
		if (fps < 30 && this.resScale > 0.55) next = Math.max(0.55, this.resScale - 0.12);
		else if (fps > 57 && this.resScale < 1) next = Math.min(1, this.resScale + 0.08);
		if (next !== this.resScale) { this.resScale = next; this.resTimer = 0; this.resize(); }
		else this.resTimer = 1.5;
	}

	renderFrame(dt) {
		this.post.render(this.scene, this.camera, this.env);
		void dt;
	}

	telemetryExtras(t) {
		const fm = this.fm, cfg = this.cfg;
		// GPWS-like logic
		const agl = t.agl;
		const sink = -t.vs;
		t.sinkWarning = !t.onGround && agl < 2500 && sink > 1000 && sink > agl * 1.4 + 900 && !fm.crashed;
		const ahead = fm.pos.clone().addScaledVector(fm.vel, 6);
		const hAhead = Math.max(getHeight(ahead.x, ahead.z), 0);
		t.terrainWarn = !t.onGround && ahead.y < hAhead + 60 && fm.vel.length() > 30 && !t.sinkWarning && !(t.gearDown && t.flap > 0.3);
		if (t.terrainWarn && ahead.y < hAhead + 15) t.sinkWarning = true;
		t.gearWarn = cfg.retractable && !t.gearDown && !t.onGround && agl < 800 && sink > 300 && t.ias < cfg.vapp * 1.25;
		t.engineType = cfg.engine;
		t.crashed = fm.crashed;
		return t;
	}

	loop(now) {
		requestAnimationFrame((t) => this.loop(t));
		let dt = Math.min(0.1, (now - this.last) / 1000);
		this.last = now;
		this.dt = dt;
		this.hud.fps += ((1 / Math.max(dt, 1e-3)) - this.hud.fps) * 0.05;
		this.adaptResolution(dt);
		if (this.state === 'flying') {
			this.simulate(dt);
			if (this.paused) dt = 0;
		} else {
			this.controls.update(dt);
		}
		this.time += dt;
		if (this.settings.timeFlow && this.state === 'flying' && !this.paused) {
			this.clockHour = (this.clockHour + dt / 3600) % 24;
			this.atm.setTime(this.clockHour);
		}

		if (this.state === 'flying' && this.model) {
			const tel = this.telemetryExtras(this.fm.telemetry());
			this.updateAircraftVisuals(dt);
			this.updateEffects(dt, tel);
			this.updateCamera(dt);
			if (this.fm.crashed) {
				this.crashTimer -= dt;
				if (this.crashTimer <= 0 && $('crash').classList.contains('hidden')) $('crash').classList.remove('hidden');
			}
		} else {
			this.updateMenuCamera(dt);
		}
		this.flash = Math.max(0, (this.flash || 0) - dt * 1.5);
		this.fade = Math.max(0, (this.fade || 0) - dt * 1.2);
		this.updateLighting(dt);
		this.terrain.update(this.camera.position, 4);
		const windV = this.fm ? this.fm.windBase : new THREE.Vector3();
		const lightCol = new THREE.Color().copy(this.atm.lightColor).multiplyScalar(this.atm.lightIntensity * Math.max(this.atm.lightDir.y, 0.05) * 0.25 * this.cloudShadow).add(new THREE.Color(0.25, 0.3, 0.38).multiplyScalar(SUN_INTENSITY * 0.05 * sstep(this.atm.sunDir.y, -0.1, 0.3) + 0.01));
		this.smokeLight = lightCol;
		this.effects.update(dt, windV, this.camera, this.pxHeight, lightCol);
		if (this.model && this.model.cockpit.userData.glow) {
			const gi = Math.min(0.6, 0.05 / Math.max(this.exposure, 0.05));
			for (const mat of this.model.cockpit.userData.glow) mat.emissiveIntensity = gi;
		}
		const wdir = this.settings.windDir * Math.PI / 180;
		this.airports.update(this.time, this.atm.night, wdir, this.settings.windSpeed / 1.94384, this.camera, this.pxHeight);

		// G-effects & crash post-process
		if (this.fm && this.state === 'flying') {
			const nz = this.fm.nz;
			this.gray = THREE.MathUtils.lerp(this.gray || 0, sstep(nz, 5.5, 9.5), 1 - Math.exp(-dt * (nz > 5.5 ? 0.6 : 2)));
			this.red = THREE.MathUtils.lerp(this.red || 0, sstep(-nz, 2.2, 4), 1 - Math.exp(-dt * 1));
		} else { this.gray = 0; this.red = 0; }
		this.env.grayout = this.gray; this.env.redout = this.red;
		this.env.flash = this.flash; this.env.fade = this.fade;
		this.renderFrame(dt);

		// HUD
		const h = Math.floor(this.clockHour), m = Math.floor((this.clockHour - h) * 60);
		const clock = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
		if (this.state === 'flying' && this.fm) {
			const fm = this.fm, tel = fm.tel;
			const { ap, dist } = nearestAirport(fm.pos.x, fm.pos.z);
			const brg = (Math.atan2(ap.x - fm.pos.x, -(ap.z - fm.pos.z)) * 180 / Math.PI + 360) % 360;
			const velBody = fm.vel.clone().applyQuaternion(fm.quat.clone().invert());
			this.hud.draw(fm.crashed ? null : tel, {
				dt, fov: this.camera.fov, cfg: this.cfg, throttle: this.controls.throttle, time: this.time, paused: this.paused,
				velBody, accelAlong: this.accelAlong, pos: fm.pos, approach: computeApproach(fm.pos, tel.heading),
				navBearing: brg, navText: `${ap.id} ${String(Math.round(brg)).padStart(3, '0')}° ${(dist / 1852).toFixed(1)} NM`,
				mapRange: tel.agl > 8000 ? 40000 : 15000, mapImage: this.mapImage, clock,
			});
			this.audio.update({ ...tel, crashed: fm.crashed }, this.view, this.paused);
		} else {
			this.hud.draw(null, { dt, clock });
		}
		this.controls.endFrame();
	}
}

const game = new Game();
window.__game = game;
game.boot().catch((e) => {
	console.error(e);
	const m = document.getElementById('load-msg');
	if (m) m.textContent = 'Failed to start: ' + e.message;
});
