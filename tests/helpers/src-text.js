/* Source-text readers for the markup, stylesheet and renderer tests.

   Some tests assert on the shape of the shipped files rather than on runtime
   behaviour: does index.html still wire the HUD, does the renderer still
   dispatch through a sprite table. These read the real bytes once per test
   instead of keeping a copy of the files around to regex.

   readSrc() covers every *.js under src/, walked recursively. The walk is
   recursive on purpose: the draw passes live in a subdirectory, and an
   assertion that silently stopped seeing a file because someone made a
   subfolder is the failure this reader exists to prevent. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = path.join(__dirname, '..', '..');

function jsFilesIn(dir){
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b)=>a.name<b.name?-1:1)) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(jsFilesIn(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

export function readSrc(){
  let out = '';
  for (const f of ['src/main.js', 'src/boot.js']){
    const p2 = path.join(root, f);
    if (fs.existsSync(p2)) out += '\n' + fs.readFileSync(p2, 'utf8');
  }
  for (const dir of ['src']) {
    const d = path.join(root, dir);
    if (fs.existsSync(d)) {
      for (const f of jsFilesIn(d))
        out += '\n' + fs.readFileSync(f, 'utf8');
    }
  }
  return out;
}

export function readHtml(){
  return fs.readFileSync(path.join(root, 'index.html'), 'utf8');
}

export function readCss(){
  /* Read in the order index.html links them, not sorted: the cascade depends
     on it. tokens.css must come first (it defines the :root variables) and
     base.css last (prefers-reduced-motion overrides animations set above). */
  const ORDER = ['tokens','hud','screens','splash','settings','base'];
  let out = '';
  for (const name of ORDER){
    const p = path.join(root, 'css', name + '.js'.replace('.js','.css'));
    if (fs.existsSync(p)) out += '\n' + fs.readFileSync(p, 'utf8');
  }
  return out;
}
