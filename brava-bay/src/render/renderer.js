// STUB (owned by the rendering agent). Creates the WebGLRenderer. See CONTRACT.md §Rendering.
import * as THREE from 'three';

export function createRenderer(canvas, game) {
	const q = game.quality;
	const r = new THREE.WebGLRenderer({ canvas, antialias: q.msaa > 0, powerPreference: 'high-performance', stencil: false });
	const dpr = Math.min(window.devicePixelRatio || 1, q.maxDpr) * q.pixelRatio;
	r.setPixelRatio(dpr);
	r.setSize(window.innerWidth, window.innerHeight, false);
	r.outputColorSpace = THREE.SRGBColorSpace;
	r.toneMapping = THREE.ACESFilmicToneMapping;
	r.toneMappingExposure = 1.0;
	r.shadowMap.enabled = q.shadows > 0;
	r.shadowMap.type = THREE.PCFSoftShadowMap;
	return r;
}
