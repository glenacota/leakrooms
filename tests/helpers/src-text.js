/* Source-text readers for the markup/stylesheet/renderer tests. The suite
   asserts on the SHAPE of the shipped files (does index.html still wire the
   HUD? does game.js still dispatch through a sprite table?), so these read the
   real bytes once per test instead of reimplementing regexes over a copy.

   readSrc() covers game.js plus every *.js under src/ — when the monolith is
   split, source-shape assertions keep working without being rewritten.
   readCss() covers style.css plus css/*.css if that directory ever appears. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = path.join(__dirname, '..', '..');

export function readSrc(){
  let out = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  for (const dir of ['src', 'config', 'util']) {
    const d = path.join(root, dir);
    if (fs.existsSync(d)) {
      for (const f of fs.readdirSync(d).filter(f => f.endsWith('.js')).sort())
        out += '\n' + fs.readFileSync(path.join(d, f), 'utf8');
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
