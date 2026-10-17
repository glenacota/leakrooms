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
  let out = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  for (const dir of ['src', 'config', 'util', 'sim', 'render', 'cast']) {
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
  let out = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const cssDir = path.join(root, 'css');
  if (fs.existsSync(cssDir)) {
    for (const f of fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).sort())
      out += '\n' + fs.readFileSync(path.join(cssDir, f), 'utf8');
  }
  return out;
}
