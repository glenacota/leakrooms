import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGame } from '../helpers/harness.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const GOLDEN = path.join(ROOT, 'tests', 'fixtures', 'render-trace.json');
const ACTUAL = path.join(ROOT, 'tests', '.trace-actual.json');

// seeded Math.random BEFORE importing game
function mulberry32(a){
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(0xBEEF);

const { A, recCtx } = await loadGame({ recordMain: true });
const buildFloor = A.buildFloor;
const update = A.update;
const render = A.render;

test('render trace matches golden', () => {
  buildFloor(0, 1234);
  for (let i = 0; i < 30; i++) update(1 / 60);
  for (let i = 0; i < 3; i++) render(1000 + i * 16);

  const log = recCtx.log;
  const payload = JSON.stringify(log);
  const sha = crypto.createHash('sha1').update(payload).digest('hex');
  const actual = { sha1: sha, length: log.length };

  if (process.env.UPDATE_GOLDEN === '1') {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, JSON.stringify(actual, null, 2) + '\n');
    console.log('wrote golden', actual);
    return;
  }

  if (!fs.existsSync(GOLDEN)) {
    fs.writeFileSync(ACTUAL, JSON.stringify(actual, null, 2) + '\n');
    throw new Error('golden missing; wrote ' + ACTUAL);
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  if (golden.sha1 !== actual.sha1 || golden.length !== actual.length) {
    fs.writeFileSync(ACTUAL, JSON.stringify(actual, null, 2) + '\n');
    throw new Error(`trace mismatch: golden ${golden.sha1}/${golden.length} vs actual ${actual.sha1}/${actual.length}`);
  }
});
