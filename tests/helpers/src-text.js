/* Source-text readers for the markup/stylesheet/renderer tests. The suite
   asserts on the SHAPE of the shipped files (does index.html still wire the
   HUD? does game.js still dispatch through a sprite table?), so these read the
   real bytes once per test instead of reimplementing regexes over a copy.

   readSrc() covers game.js plus every *.js under src/ — when the monolith is
   split, source-shape assertions keep working without being rewritten. The
   list grew as the monolith split: sim/ (steps 24-28) and render/ (step 29)
   now hold bodies that assertions used to find in game.js, and cast/ holds the
   sprites. An assertion that reads a moved function must keep reading it, and
   the walk is RECURSIVE — render/passes/ (step 30) is a subdirectory, and an
   assertion that silently stopped seeing the scanline pass because someone
   made a subfolder is the exact failure this reader exists to prevent.
   readCss() covers style.css plus css/*.css if that directory ever appears. */
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
  /* Read in the order index.html links them, not sorted — the cascade depends
     it. tokens.css must be first (:root variables), base.css must be last
     (prefers-reduced-motion kills animations defined above). */
  const ORDER = ['tokens','hud','screens','splash','settings','base'];
  let out = '';
  for (const name of ORDER){
    const p = path.join(root, 'css', name + '.js'.replace('.js','.css'));
    if (fs.existsSync(p)) out += '\n' + fs.readFileSync(p, 'utf8');
  }
  return out;
}
