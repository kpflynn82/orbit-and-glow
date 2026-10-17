// Fold the dist-single/ build into self-contained HTML (game code inlined), so the game opens from
// a single link on a phone. Run via `npm run build:single`. Writes two files:
//   dist-single/orbit-and-glow.html  a complete web page (open it anywhere)
//   dist-single/artifact.html        the same page without <html>/<head>/<body> wrappers, for
//                                    hosts that add their own (a claude.ai artifact link)
// (We used to use vite-plugin-singlefile, but it pulled in a package with a known security
// advisory, so this small script does the same job.)

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'dist-single';
let html = readFileSync(join(DIR, 'index.html'), 'utf8');

const scriptTag = /<script type="module" crossorigin src="\.\/assets\/([^"]+\.js)"><\/script>/;
const m = html.match(scriptTag);
if (!m) throw new Error('could not find the module script tag in dist-single/index.html');
const js = readFileSync(join(DIR, 'assets', m[1]), 'utf8').replace(/<\/script/gi, '<\\/script');
const inlineScript = `<script type="module">\n${js}\n</script>`;
html = html.replace(scriptTag, () => '');

for (const f of readdirSync(join(DIR, 'assets')).filter((n) => n.endsWith('.css'))) {
  const linkTag = new RegExp(`<link rel="stylesheet" crossorigin href="\\./assets/${f.replace('.', '\\.')}">`);
  html = html.replace(linkTag, () => `<style>${readFileSync(join(DIR, 'assets', f), 'utf8')}</style>`);
}

// The game script goes at the end of <body>, after the #game element it draws into.
const full = html.replace('</body>', () => `${inlineScript}\n</body>`);
writeFileSync(join(DIR, 'orbit-and-glow.html'), full);

const pick = (re) => (html.match(re) ?? [])[0] ?? '';
const title = pick(/<title>[\s\S]*?<\/title>/);
const styles = (html.match(/<style>[\s\S]*?<\/style>/g) ?? []).join('\n');
const body = (html.match(/<body>([\s\S]*?)<\/body>/) ?? [])[1] ?? '';
const fragment = `${title}\n<meta name="theme-color" content="#0B1026">\n${styles}\n${body.trim()}\n${inlineScript}\n`;
writeFileSync(join(DIR, 'artifact.html'), fragment);

console.log(`Wrote ${DIR}/orbit-and-glow.html (${(full.length / 1024).toFixed(0)} KB) and ${DIR}/artifact.html`);
