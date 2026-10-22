/* The layer rules, asserted on the import graph and on the source text.

   The tree is only readable because the direction of every dependency is
   fixed: the simulation and its helpers never reach up into the renderer,
   the shell or the audio, and the run and the loop never reach into the
   renderer or the DOM. Nothing enforces that but this file. A single
   convenience import breaks it silently — the module still loads, the game
   still runs — and the cost is paid later, when a headless test has to
   invent a DOM to read the simulation.

   Two shapes are checked: which modules a file imports, and what a file
   says about `document`. The second matters because an import graph cannot
   see a run that reaches into the DOM through a helper. */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(path.relative(ROOT, p));
  }
  return out;
}

const FILES = walk(path.join(ROOT, 'src')).sort();

/* Every relative import in a module, resolved to a repo-relative path. */
function importsOf(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const out = [];
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'(\.[^']+)'/g)) {
    out.push(path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, file)), m[1])));
  }
  return out;
}

const GRAPH = new Map(FILES.map(f => [f, importsOf(f)]));

/* The layers that must not know the outside world exists. Each entry is the
   folder and the folders it is forbidden to import. */
const LAYERS = [
  { dir: 'src/sim/',    banned: ['src/render/', 'src/ui/', 'src/game/', 'src/audio/'] },
  { dir: 'src/util/',   banned: ['src/render/', 'src/ui/', 'src/game/', 'src/audio/'] },
  { dir: 'src/config/', banned: ['src/render/', 'src/ui/', 'src/game/', 'src/audio/'] },
];

/* These two sit between the simulation and the shell. The loop runs the game,
   and the run owns its state; both may be read by the renderer and the UI,
   but must not reach into them. */
const MIDDLE = ['src/game/run.js', 'src/game/loop.js'];
const MIDDLE_BANNED = ['src/render/', 'src/ui/'];

test('the simulation layers import nothing above them', () => {
  const offenders = [];
  for (const layer of LAYERS) {
    for (const f of FILES) {
      if (!f.startsWith(layer.dir)) continue;
      for (const dep of GRAPH.get(f) || []) {
        const hit = layer.banned.find(b => dep.startsWith(b));
        // Allow specific sim modules to import render/repaint.js for dirty tracking
        if (hit === 'src/render/' && dep.startsWith('src/render/repaint.js') && REPAINT_ALLOWED.includes(f)) {
          continue;
        }
        if (hit) offenders.push(`${f} -> ${dep} (${layer.dir} must not import ${hit})`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `a low layer imports up the tree:\n  ${offenders.join('\n  ')}`);
});

test('the run and the loop import no renderer and no UI', () => {
  const offenders = [];
  for (const f of MIDDLE) {
    for (const dep of GRAPH.get(f) || []) {
      const hit = MIDDLE_BANNED.find(b => dep.startsWith(b));
      if (hit) offenders.push(`${f} -> ${dep} (must not import ${hit})`);
    }
  }
  assert.deepEqual(offenders, [],
    `the run and the loop reach up into the renderer or the shell:\n  ${offenders.join('\n  ')}`);
});

test('the run and the loop never touch the document', () => {
  const offenders = [];
  for (const f of MIDDLE) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/\bdocument\s*\./.test(line)) offenders.push(`${f}:${i + 1} ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [],
    `the DOM belongs to ui/, not to the run or the loop:\n  ${offenders.join('\n  ')}`);
});

/* The state refactor moves G behind a facade and gives each sim module its
   state explicitly. Until every module is converted, the files that still
   import state.js are named here; a new importer fails the test instead of
   joining the list silently. */
const ALLOWED = [
];

/* The repaint refactor moves dirty tracking to render/repaint.js. These sim
   modules are allowed to import it to mark pixel layers as stale. */
const REPAINT_ALLOWED = [
  'src/sim/flood.js',
  'src/sim/leaks.js',
  'src/sim/state.js',
  'src/sim/vision.js',
];

test('only the allowlisted sim modules import state.js', () => {
  const importers = FILES
    .filter(f => f.startsWith('src/sim/') && (GRAPH.get(f) || []).includes('src/sim/state.js'))
    .sort();
  assert.deepEqual(importers, [...ALLOWED].sort(),
    `src/sim/** imports state.js outside the allowlist:\n  ${importers.join('\n  ')}`);
});