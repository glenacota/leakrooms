/* Every production module loads, and nothing but the composition root may
   import the composition root.

   This exists because of a family of breaks that syntax checking cannot see
   and no behavioural test reaches: a module that imports a name nobody
   exports, a module that nothing imports so nobody ever loads it, a pair of
   modules that import each other. All three are invisible until something
   actually imports the file, and the suite only ever imports `game.js` — which
   reaches most of the tree and none of the rest.

   During the module split this caught four real ones: a missing `addRunTime`
   export, a missing `drawDoor` export, `REPAIR_TIME` imported from constants
   rather than tuning, and a `LOUD`/`clockText` pair left behind in hud.js.
   Every one of them was a red test run, not a judgement call. */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadGame } from '../helpers/harness.js';

/* The stubs must be installed before anything is imported: render/canvas.js and
   render/textures.js touch `document` at module scope, and ui/hud.js reads the
   HUD table while it loads. */
const { A } = await loadGame();

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* The folders that hold shipped code. tests/ is excluded by construction —
   the helpers import the code under test and would make the cycle check
   meaningless. */
/* Every shipped module lives under src/ now — one walk covers the tree. */
const DIRS = ['src'];
const ENTRY = 'src/main.js';

function walk(dir, out){
  for (const e of fs.readdirSync(dir, { withFileTypes: true })){
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(path.relative(ROOT, p));
  }
  return out;
}

const files = [];
for (const d of DIRS){
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) walk(abs, files);
}
files.push(ENTRY);
files.sort();

/* Every relative import in a module, resolved to a repo-relative path. */
function importsOf(file){
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const out = new Set();
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'(\.[^']+)'/g)){
    out.add(path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, file)), m[1])));
  }
  return [...out];
}

const graph = new Map(files.map(f => [f, importsOf(f)]));

test('every production module loads', async () => {
  const broken = [];
  for (const f of files){
    try { await import(pathToFileURL(path.join(ROOT, f)).href); }
    catch (e){ broken.push(`${f} :: ${e.message}`); }
  }
  assert.deepEqual(broken, [],
    `module(s) failed to load — an import names something the target does not export:\n  ${broken.join('\n  ')}`);
});

test('only the composition root imports game.js', () => {
  const offenders = [...graph.entries()]
    .filter(([f]) => f !== ENTRY)
    .filter(([, deps]) => deps.includes(ENTRY))
    .map(([f]) => f);
  assert.deepEqual(offenders, [],
    `these import the entry point, which makes it a leaf instead of a root:\n  ${offenders.join('\n  ')}`);
});

test('the module graph has no cycles', () => {
  const found = [];
  const visit = (node, path) => {
    const at = path.indexOf(node);
    if (at >= 0){ found.push([...path.slice(at), node].join(' -> ')); return; }
    for (const dep of graph.get(node) || []){
      if (graph.has(dep)) visit(dep, [...path, node]);
    }
  };
  for (const f of files) visit(f, []);
  assert.deepEqual(found, [], `import cycle(s):\n  ${found.join('\n  ')}`);
});

test('the smoke test loaded a real game, not an empty module', () => {
  assert.ok(A && A.G, '__api did not load');
  assert.ok(A.G && A.G.grid, 'no floor was built at boot');
});