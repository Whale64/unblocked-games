// Bundles src/ into a single self-contained index.html (no network needed at runtime).
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');

async function buildOnce() {
	const result = await esbuild.build({
		entryPoints: ['src/main.js'],
		bundle: true,
		minify: true,
		format: 'iife',
		target: ['es2020'],
		write: false,
		legalComments: 'none',
	});
	const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
	const template = readFileSync('src/index.html', 'utf8');
	const html = template.replace('/*__BUNDLE__*/', () => js);
	writeFileSync('index.html', html);
	console.log(`index.html written (${(html.length / 1024).toFixed(0)} KB)`);
}

if (watch) {
	const { watch: fsWatch } = await import('node:fs');
	await buildOnce();
	let t = null;
	fsWatch('src', { recursive: true }, () => {
		clearTimeout(t);
		t = setTimeout(() => buildOnce().catch((e) => console.error(e.message)), 100);
	});
} else {
	await buildOnce();
}
