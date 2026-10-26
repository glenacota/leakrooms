/* Do the screens fit a phone held sideways? This file cannot render anything, so
   it reads the stylesheets and the markup as text and holds the rules that keep
   them honest: the safe-area tokens exist and are used, a short screen gets the
   compact tier, and the sizes that cap a panel use dvh as well as vh. The real
   check (screenshots at eight viewport sizes) is the audit in the phase report. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const CSS = ['tokens', 'hud', 'screens', 'splash', 'settings', 'touch', 'base'];
const sheet = Object.fromEntries(CSS.map(n => [n, read(`css/${n}.css`)]));
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
const html = read('index.html');

/* Every innermost { ... } block with its declarations, comments removed. */
function leafRules(css){
  return [...strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));
}

/* The text of the first @media block whose query contains `needle`, braces balanced. */
function mediaBlock(css, needle){
  const s = strip(css);
  const i = s.search(new RegExp(`@media[^{]*${needle.replace(/[()]/g, '\\$&')}[^{]*\\{`));
  if (i < 0) return null;
  let depth = 0;
  for (let j = s.indexOf('{', i); j < s.length; j++){
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return s.slice(i, j + 1);
  }
  return null;
}

test('[FIT] a size cap in vh always has a dvh line after it in the same rule', () => {
  let capped = 0;
  for (const [name, css] of Object.entries(sheet)){
    for (const { sel, body } of leafRules(css)){
      const decls = body.split(';').map(d => d.trim()).filter(Boolean);
      decls.forEach((d, i) => {
        if (!/^max-height\s*:.*\dvh\b/.test(d)) return;
        capped++;
        const later = decls.slice(i + 1).some(x => /^max-height\s*:.*\ddvh\b/.test(x));
        assert.ok(later, `${name}.css: "${sel}" caps max-height in vh with no dvh line after it`);
      });
    }
  }
  assert.ok(capped >= 4, `only ${capped} vh caps found: the parse is wrong`);
});

test('[FIT] text-size-adjust, touch-action: manipulation and no overscroll', () => {
  const base = strip(sheet.base);
  assert.ok(/-webkit-text-size-adjust\s*:\s*100%/.test(base) && /(^|[^-])text-size-adjust\s*:\s*100%/.test(base));
  assert.ok(/\.screen\s*,\s*button\s*\{[^}]*touch-action\s*:\s*manipulation/.test(base));
  assert.ok(/html\s*,\s*body\s*\{[^}]*overscroll-behavior\s*:\s*none/.test(base));
});

test('[FIT] --safe-t/-r/-b/-l are defined once, and read through var() everywhere else', () => {
  const tokens = strip(sheet.tokens);
  for (const [k, side] of [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']])
    assert.ok(new RegExp(`--safe-${k}\\s*:\\s*env\\(safe-area-inset-${side},\\s*0px\\)`).test(tokens), `--safe-${k}`);
  for (const [name, css] of Object.entries(sheet)){
    if (name === 'tokens') continue;
    assert.ok(!/env\(/.test(strip(css)), `${name}.css reads env() directly: use the --safe tokens`);
  }
  const screen = leafRules(sheet.screens).find(r => r.sel === '.screen');
  assert.ok(screen && /padding\s*:\s*var\(--safe-t\)\s+var\(--safe-r\)\s+var\(--safe-b\)\s+var\(--safe-l\)/.test(screen.body),
    '.screen does not pad itself by the safe area');
  const hud = strip(sheet.hud).match(/\.crt-tl\s*\{([^}]*)\}/);
  assert.ok(hud && /top\s*:\s*max\(10px,\s*var\(--safe-t\)\)/.test(hud[1]) && /left\s*:\s*max\(12px,\s*var\(--safe-l\)\)/.test(hud[1]),
    'the HUD anchor does not clear the notch');
  assert.ok(/\.crt-tl\s*\{\s*left\s*:\s*max\(8px,\s*var\(--safe-l\)\)/.test(strip(sheet.base)), 'the narrow HUD override ignores the notch');
});

test('[FIT] a (max-height:520px) block exists and keeps the landscape ticket in two columns', () => {
  const b = mediaBlock(sheet.base, '(max-height:520px)');
  assert.ok(b, 'no compact tier in base.css');
  assert.ok(/\.order\s*\{\s*grid-template-columns\s*:\s*1fr\s+170px/.test(b), 'no 1fr 170px ticket');
  for (const bad of [/\bzoom\s*:/, /transform\s*:\s*scale/])
    assert.ok(!bad.test(b), 'the compact tier shrinks by scaling, not by tightening');
  // nothing in it asks for type under 10px
  for (const m of b.matchAll(/font-size\s*:\s*([\d.]+)px/g))
    assert.ok(Number(m[1]) >= 10, `compact tier has a ${m[1]}px font`);
});

test('[FIT] the 820 px stacking rule does not apply to a short landscape screen', () => {
  const css = strip(sheet.screens);
  const m = css.match(/@media\s*([^{]*)\{\s*\.order\s*\{\s*grid-template-columns\s*:\s*1fr\s*;\s*\}/);
  assert.ok(m, 'the stacking rule is gone');
  const q = m[1];
  assert.ok(/max-width:820px\)\s*and\s*\(min-height:521px\)/.test(q), `not limited to tall screens: ${q}`);
  assert.ok(/orientation:portrait/.test(q), 'a portrait screen no longer stacks');
  // and the old unqualified form is not left behind
  assert.ok(!/@media\s*\(max-width:820px\)\s*\{\s*\.order\s*\{/.test(css));
});

test('[FIT] touch.css has the 40px targets, the 44px primary buttons and the hidden legend', () => {
  const t = strip(sheet.touch);
  for (const sel of ['.seg button', '.pause-tabs button', '.stamp-terms .chg', 'button.ghost', 'button.danger'])
    assert.ok(new RegExp(`\\[data-input=touch\\]\\s*${sel.replace(/[.]/g, '\\.')}[^{]*[,{]`).test(t), `no touch rule for ${sel}`);
  assert.ok(/min-height\s*:\s*40px/.test(t));
  for (const id of ['btn-start', 'btn-descend', 'btn-retry', 'btn-again', 'btn-resume'])
    assert.ok(t.includes(`#${id}`), `no 44px rule for #${id}`);
  assert.ok(/min-height\s*:\s*44px/.test(t));
  assert.ok(/input\[type=range\]\s*\{[^}]*height\s*:\s*14px/.test(t), 'no 14px slider track');
  assert.ok(/::-webkit-slider-thumb\s*\{[^}]*width\s*:\s*28px[^}]*height\s*:\s*28px/.test(t));
  assert.ok(/::-moz-range-thumb\s*\{[^}]*width\s*:\s*28px[^}]*height\s*:\s*28px/.test(t));
  const hide = mediaBlock(sheet.touch, '(max-height:520px)');
  assert.ok(hide && /\.order-side \.stub-note/.test(hide) && /\.controls-big/.test(hide) && /display\s*:\s*none/.test(hide),
    'the stub legend is not hidden on a short touch screen');
});

test('[FIT] css/base.css is the last stylesheet linked in index.html', () => {
  const links = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m => m[1]);
  assert.ok(links.length >= 7, `only ${links.length} stylesheets found`);
  assert.equal(links[links.length - 1], 'css/base.css');
});

test('[FIT] the compact pause pages scroll inside the ticket and pin their tab and button rows', () => {
  const b = mediaBlock(sheet.base, '(max-height:520px)');
  assert.ok(/--pause-chrome\s*:\s*\d+px/.test(b), 'no --pause-chrome');
  assert.ok(/\[data-pause-page="settings"\][\s\S]*?overflow-y\s*:\s*auto/.test(b));
  assert.ok(/\.pause-tabs\s*\{[^}]*position\s*:\s*sticky/.test(b));
  assert.ok(/\.setrow\.buttons\s*\{[^}]*position\s*:\s*sticky/.test(b));
});
