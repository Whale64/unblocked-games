// STUB (owned by the rendering agent). Sky, sun/moon, time of day, fog, environment map, weather.
import * as THREE from 'three';

export class Sky {
	constructor(game) {
		this.game = game;
		this.sunDir = new THREE.Vector3(0.3, 0.8, 0.2).normalize(); // direction TO the sun
		this.moonDir = new THREE.Vector3(-0.3, 0.6, -0.2).normalize();
		this.sunColor = new THREE.Color(1, 0.95, 0.85);
		this.sunIntensity = 3;
		this.ambientColor = new THREE.Color(0.6, 0.7, 0.85);
		this.night = 0;       // 0 = full day, 1 = full night
		this.dusk = 0;        // 0..1 golden-hour amount
		this.fogColor = new THREE.Color(0.75, 0.82, 0.9);
		this.streetlightsOn = false;
		// Shared uniform objects: other modules may reference these directly in custom shaders
		// (e.g. material.uniforms.uSunDir = game.sky.uniforms.uSunDir). Sky updates .value every frame.
		this.uniforms = {
			uSunDir: { value: this.sunDir }, uSunColor: { value: this.sunColor }, uNight: { value: 0 },
			uTime: { value: 0 }, uWetness: { value: 0 }, uRain: { value: 0 }, uFogColor: { value: this.fogColor }, uWind: { value: 4 },
		};
	}
	async init() {
		this.game.scene.background = new THREE.Color(0x8fc4ec);
		this.game.scene.fog = new THREE.Fog(0xbcd8ee, 200, this.game.quality.drawDistance);
	}
	update() {
		const h = this.game.clock.hour;
		const ang = ((h - 6) / 12) * Math.PI;
		this.sunDir.set(Math.cos(ang) * 0.8, Math.sin(ang), 0.35).normalize();
		const el = this.sunDir.y;
		this.night = THREE.MathUtils.clamp((0.05 - el) / 0.15, 0, 1);
		this.dusk = THREE.MathUtils.clamp(1 - Math.abs(el - 0.08) / 0.2, 0, 1);
		this.streetlightsOn = el < 0.08;
		const day = 1 - this.night;
		this.game.scene.background.setRGB(0.05 + 0.5 * day, 0.07 + 0.66 * day, 0.15 + 0.78 * day);
		this.game.scene.fog.color.copy(this.game.scene.background);
		this.sunIntensity = 3 * day;
		this.fogColor.copy(this.game.scene.fog.color);
		const u = this.uniforms, w = this.game.weather;
		u.uNight.value = this.night; u.uTime.value = this.game.clock.real;
		u.uWetness.value = w.wetness; u.uRain.value = w.rain; u.uWind.value = w.wind;
	}
}
