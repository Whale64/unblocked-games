// Quality presets and persisted user settings.

export const QUALITY = {
	// pixelRatio is multiplied by devicePixelRatio and clamped; renderScale is adjusted live by dynamic resolution.
	low: {
		name: 'Low', pixelRatio: 0.7, maxDpr: 1, msaa: 0, fxaa: true, shadows: 0, shadowDistance: 0, shadowCascades: 0,
		bloom: false, ssao: false, motionBlur: false, godRays: false, reflections: 'env', drawDistance: 700,
		buildingDetail: 0, propDistance: 120, vegetationDensity: 0.45, trafficCars: 14, pedestrians: 14, parkedCars: 16,
		waterQuality: 0, particles: 0.5, interiorWindows: false,
	},
	medium: {
		name: 'Medium', pixelRatio: 1, maxDpr: 1.25, msaa: 0, fxaa: true, shadows: 1024, shadowDistance: 120, shadowCascades: 1,
		bloom: true, ssao: false, motionBlur: false, godRays: false, reflections: 'env', drawDistance: 1100,
		buildingDetail: 1, propDistance: 220, vegetationDensity: 0.7, trafficCars: 24, pedestrians: 26, parkedCars: 26,
		waterQuality: 1, particles: 0.8, interiorWindows: true,
	},
	high: {
		name: 'High', pixelRatio: 1, maxDpr: 1.5, msaa: 4, fxaa: false, shadows: 2048, shadowDistance: 200, shadowCascades: 2,
		bloom: true, ssao: true, motionBlur: false, godRays: true, reflections: 'env', drawDistance: 1600,
		buildingDetail: 2, propDistance: 320, vegetationDensity: 1.0, trafficCars: 34, pedestrians: 40, parkedCars: 36,
		waterQuality: 2, particles: 1, interiorWindows: true,
	},
	ultra: {
		name: 'Ultra', pixelRatio: 1, maxDpr: 2, msaa: 4, fxaa: false, shadows: 4096, shadowDistance: 300, shadowCascades: 3,
		bloom: true, ssao: true, motionBlur: true, godRays: true, reflections: 'env', drawDistance: 2400,
		buildingDetail: 2, propDistance: 450, vegetationDensity: 1.3, trafficCars: 44, pedestrians: 56, parkedCars: 44,
		waterQuality: 2, particles: 1.25, interiorWindows: true,
	},
};

export function detectQuality() {
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

const KEY = 'bravabay-settings-v1';

export const DEFAULT_SETTINGS = {
	quality: null,          // 'low'|'medium'|'high'|'ultra' (null = auto-detect)
	resolution: 'auto',     // 'auto' (dynamic) | 'native' | '0.5'..'1.0'
	masterVolume: 0.8,
	musicVolume: 0.7,       // radio
	sfxVolume: 0.9,
	mouseSensitivity: 1.0,
	invertY: false,
	fov: 70,
	units: 'kmh',           // 'kmh' | 'mph'
	timeScale: 60,          // game seconds per real second (60 => 1 game hour per real minute)
	subtitles: true,
	cameraShake: true,
	showFps: false,
};

export function loadSettings() {
	let s = { ...DEFAULT_SETTINGS };
	try { s = { ...s, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* storage unavailable */ }
	if (!s.quality || !QUALITY[s.quality]) s.quality = detectQuality();
	return s;
}

export function saveSettings(s) {
	try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

/** Parse debug/test URL parameters (see CONTRACT.md "Debug URL parameters"). */
export function urlParams() {
	const p = new URLSearchParams(location.search);
	const num = (k) => (p.has(k) ? parseFloat(p.get(k)) : undefined);
	const list = (k) => (p.has(k) ? p.get(k).split(',').map(Number) : undefined);
	return {
		autostart: p.has('autostart'),
		quality: p.get('quality') || undefined,
		hour: num('hour'),
		freezeTime: p.has('freezetime'),
		spawn: list('spawn'),           // x,z[,yaw]
		vehicle: p.get('vehicle') || undefined, // spawn player in this vehicle type
		cam: list('cam'),               // debug camera: x,y,z,lookX,lookY,lookZ
		seed: num('seed'),
		noTraffic: p.has('notraffic'),
		noPeds: p.has('nopeds'),
		noAudio: p.has('noaudio'),
		wanted: num('wanted'),
		mission: p.get('mission') || undefined,
		fps: p.has('fps'),
		raw: p,
	};
}
