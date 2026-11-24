#!/usr/bin/env node
// Headless test harness: loads the built index.html in Chromium (SwiftShader WebGL2), runs scripted steps,
// takes screenshots, and reports console errors + FPS.
//
// Usage:
//   node tools/shot.cjs --query "autostart&quality=low&hour=17" --wait 6000 --out /path/a.png
//   node tools/shot.cjs --query "autostart" --steps steps.json
// steps.json: [ {"wait":2000}, {"eval":"game.player.teleport(0,0,0)"}, {"key":"KeyW","ms":1500},
//               {"keys":["KeyW","KeyA"],"ms":800}, {"shot":"/abs/path.png"}, {"log":"game.player.position"} ]
// Options: --width 1280 --height 720 --timeout 90000 --html <path to index.html> --quiet
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch {
	const { execSync } = require('child_process');
	const root = execSync('npm root -g').toString().trim();
	({ chromium } = require(path.join(root, 'playwright')));
}

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const has = (name) => args.includes(`--${name}`);

(async () => {
	const html = path.resolve(opt('html', path.join(__dirname, '..', 'index.html')));
	const query = opt('query', 'autostart&quality=low');
	const width = +opt('width', 1280), height = +opt('height', 720);
	const timeout = +opt('timeout', 120000);
	const quiet = has('quiet');
	let steps = [];
	if (opt('steps')) steps = JSON.parse(require('fs').readFileSync(opt('steps'), 'utf8'));
	if (opt('wait')) steps.push({ wait: +opt('wait') });
	if (opt('out')) steps.push({ shot: opt('out') });

	const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
	const page = await browser.newPage({ viewport: { width, height } });
	const errors = [];
	page.on('console', (m) => {
		const t = m.text();
		if (/GPU stall|GL Driver Message|WebGL: too many errors/.test(t)) return;
		if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${t.slice(0, 400)}`);
		if (!quiet && m.type() === 'log') console.log('[page]', t.slice(0, 300));
	});
	page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
	const url = `file://${html}?${query}`;
	const t0 = Date.now();
	await page.goto(url);
	try {
		await page.waitForFunction(() => window.__bb && window.__bb.ready, null, { timeout });
	} catch {
		console.log('TIMEOUT waiting for game ready. Load message:', await page.evaluate(() => (document.getElementById('load-msg') || {}).textContent));
	}
	console.log(`ready after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
	const timings = await page.evaluate(() => window.game && window.game.initTimings);
	if (timings && !quiet) console.log('init ms:', timings.map(([k, v]) => `${k}:${v}`).join(' '));

	for (const s of steps) {
		if (s.wait) await page.waitForTimeout(s.wait);
		if (s.eval) {
			try { const r = await page.evaluate(s.eval); if (r !== undefined) console.log('eval ->', JSON.stringify(r).slice(0, 800)); } catch (e) { console.log('eval error', e.message); }
		}
		if (s.log) {
			try { const r = await page.evaluate(`JSON.stringify(${s.log})`); console.log(`${s.log} =`, (r || '').slice(0, 800)); } catch (e) { console.log('log error', e.message); }
		}
		if (s.key || s.keys) {
			const keys = s.keys || [s.key];
			for (const k of keys) await page.keyboard.down(k);
			await page.waitForTimeout(s.ms || 100);
			for (const k of keys) await page.keyboard.up(k);
		}
		if (s.press) await page.keyboard.press(s.press);
		if (s.click) await page.mouse.click(s.click[0], s.click[1]);
		if (s.shot) { await page.screenshot({ path: s.shot }); console.log('shot ->', s.shot); }
	}
	const bb = await page.evaluate(() => ({ fps: window.__bb && window.__bb.fps, frames: window.__bb && window.__bb.frames, errors: (window.__bb && window.__bb.errors || []).slice(0, 10), calls: window.game && window.game.renderer && window.game.renderer.info.render.calls, tris: window.game && window.game.renderer && window.game.renderer.info.render.triangles }));
	console.log(`fps=${bb.fps} frames=${bb.frames} drawCalls=${bb.calls} triangles=${bb.tris}`);
	const all = errors.concat(bb.errors.map((e) => `[game] ${e}`));
	if (all.length) { console.log(`ERRORS (${all.length}):`); for (const e of all.slice(0, 25)) console.log('  ' + e); } else console.log('no errors');
	await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
