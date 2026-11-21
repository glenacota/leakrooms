/* Checks that every test file calls done() at least once for each softAssert()
   collector it creates. A collector that is never done() logs its failures and
   lets the build pass. The helper's exit hook catches that at run time; this
   test catches it before the run, from source text. Like unused-imports.test.js,
   it is syntax-only: comments are stripped, strings are not parsed. */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const TESTS = path.join(ROOT, 'tests');

/* Helpers define the collector and fixtures are data, so neither is scanned. */
const SKIP = new Set(['helpers', 'fixtures']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, out); }
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

function count(src, re) {
  return (src.match(re) || []).length;
}

/* This file names softAssert() in its own test titles, so it is not scanned. */
const SELF = fileURLToPath(import.meta.url);
const FILES = walk(TESTS).filter(f => f !== SELF).sort();

test('every test file calls done() for each softAssert() collector', () => {
  const offenders = [];
  for (const f of FILES) {
    const code = stripComments(fs.readFileSync(f, 'utf8'));
    const created = count(code, /\bsoftAssert\(\)/g);
    const done = count(code, /\.done\(\)/g);
    if (created > done) {
      offenders.push(`${path.relative(ROOT, f)}: ${created} softAssert() but ${done} done()`);
    }
  }
  assert.deepEqual(offenders, [], `add done() to the test that owns each collector:\n${offenders.join('\n')}`);
});

test('the scan finds collectors, so the walk is not silently empty', () => {
  const total = FILES.reduce((n, f) => n + count(stripComments(fs.readFileSync(f, 'utf8')), /\bsoftAssert\(\)/g), 0);
  assert.ok(total > 0, 'found no softAssert() calls; the file walk may be broken');
});
