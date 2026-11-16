import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENT } from '../../src/util/events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(path.relative(ROOT, p));
  }
  return out;
}

const SRC_FILES = walk(path.join(ROOT, 'src')).sort();

/* Remove line comments and block comments, preserving newlines and string literals. */
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  '; i += 2; continue;
    }
    out += c; i++;
  }
  return out;
}

/* Event types referenced via EVENT.xxx in emit()/on()/off() calls. */
function eventRefs(kind, src) {
  const clean = stripComments(src);
  const refs = new Set();
  const re = new RegExp(`${kind}\\(\\s*EVENT\\.([A-Za-z_$][\\w$]*)`, 'g');
  let m;
  while ((m = re.exec(clean)) !== null) refs.add(m[1]);
  return refs;
}

/* Bare string event types passed as the first arg to emit()/on()/off(). */
function bareStringRefs(kind, src) {
  const clean = stripComments(src);
  const refs = new Set();
  /* Negative lookbehind: 'on' must not be part of a larger word like 'transition'. */
  const re = new RegExp(`(?<![A-Za-z0-9_$])${kind}\\(\\s*['\"]([^'\"]+)['\"]`, 'g');
  let m;
  while ((m = re.exec(clean)) !== null) refs.add(m[1]);
  return refs;
}

test('every EVENT constant is emitted at least once', () => {
  const emitted = new Set();
  for (const file of SRC_FILES) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const k of eventRefs('emit', src)) emitted.add(k);
  }
  const missing = [];
  for (const key of Object.keys(EVENT)) {
    if (!emitted.has(key)) missing.push(`EVENT.${key}`);
  }
  assert.deepEqual(missing, [], `EVENT constants never emitted:\n  ${missing.join('\n  ')}`);
});

test('every EVENT constant is listened to at least once', () => {
  const listened = new Set();
  for (const file of SRC_FILES) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const k of eventRefs('on', src)) listened.add(k);
    for (const k of eventRefs('off', src)) listened.add(k);
  }
  const missing = [];
  for (const key of Object.keys(EVENT)) {
    if (!listened.has(key)) missing.push(`EVENT.${key}`);
  }
  assert.deepEqual(missing, [], `EVENT constants never listened to:\n  ${missing.join('\n  ')}`);
});

test('no bare event-type strings remain in emit()/on()/off() call sites', () => {
  const knownTypes = new Set(Object.values(EVENT));
  const offenders = [];
  for (const file of SRC_FILES) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const kind of ['emit', 'on', 'off']) {
      for (const s of bareStringRefs(kind, src)) {
        if (knownTypes.has(s)) offenders.push(`${file}: ${kind}('${s}')`);
      }
    }
  }
  assert.deepEqual(offenders, [], `bare event-type strings found:\n  ${offenders.join('\n  ')}`);
});
