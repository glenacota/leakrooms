/* Cross-module free-name checker.
   Every identifier in every src file that names something exported
   elsewhere must be either imported/declared locally, a known global,
   a keyword, or accessed through a dotted expression (foo.bar) or as
   an object key (key: value). Any bare use is a free name - a bug. */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/* Strip comments and string/template literals, preserve newlines. */
function strip(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' '; i++;
      }
      out += '  '; i += 2; continue;
    }
    if (c === '\'' || c === '"') {
      const q = c; out += ' '; i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        out += src[i] === '\n' ? '\n' : ' '; i++;
      }
      out += ' '; i++; continue;
    }
    if (c === '`') {
      out += ' '; i++;
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        out += ' '; i++;
      }
      out += ' '; i++; continue;
    }
    out += c; i++;
  }
  return out;
}

/* Collect all exported names across the whole src tree. */
function collectExported(cleanSrc) {
  const exp = new Set();
  for (const c of Object.values(cleanSrc)) {
    for (const m of c.matchAll(/\bexport\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
      exp.add(m[1]);
    }
    for (const m of c.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) {
        const t = part.trim(); if (!t) continue;
        const as = t.split(/\s+as\s+/);
        exp.add((as[1] || as[0]).trim());
      }
    }
  }
  return exp;
}

/* Per-file declared/imported names. */
function collectDeclared(cleanSrc) {
  const decl = new Set();
  for (const m of cleanSrc.matchAll(/\b(?:import|export)\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim(); if (!t) continue;
      const as = t.split(/\s+as\s+/);
      decl.add((as[1] || as[0]).trim());
    }
  }
  for (const m of cleanSrc.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)/g)) decl.add(m[1]);
  for (const m of cleanSrc.matchAll(/\bimport\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g)) decl.add(m[1]);
  for (const m of cleanSrc.matchAll(/\b(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) decl.add(m[1]);
  for (const m of cleanSrc.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) decl.add(m[1]);
  for (const m of cleanSrc.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const p of m[1].split(',')) {
      const t = p.replace(/[{}\[\].]/g, ' ').trim().split(/\s+/)[0];
      if (t && /^[A-Za-z_$][\w$]*$/.test(t)) decl.add(t);
    }
  }
  for (const m of cleanSrc.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) decl.add(m[1]);
  return decl;
}

/* Known globals — Node builtins + browser environment. */
const GLOBALS = new Set([
  ...Object.getOwnPropertyNames(globalThis),
  'window', 'document', 'navigator', 'location', 'history', 'screen', 'frames',
  'self', 'top', 'parent', 'opener', 'name', 'length', 'closed', 'status',
  'origin', 'focus', 'blur', 'open', 'close', 'print', 'stop', 'find',
  'scroll', 'scrollTo', 'scrollBy', 'alert', 'confirm', 'prompt',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'localStorage', 'sessionStorage', 'indexedDB', 'crypto', 'performance',
  'structuredClone', 'fetch', 'Request', 'Response', 'Headers', 'AbortController',
  'Image', 'Audio', 'Option', 'Text', 'Range', 'Selection',
  'HTMLElement', 'HTMLCanvasElement', 'CanvasRenderingContext2D',
  'AudioContext', 'OfflineAudioContext', 'GainNode', 'AnalyserNode',
  'Uint8Array', 'Float32Array', 'Map', 'Set', 'WeakMap',
  'Promise', 'Symbol', 'Proxy', 'Reflect', 'Intl', 'console', 'Math',
  'JSON', 'Date', 'RegExp', 'Error', 'TypeError', 'Array', 'Object',
  'String', 'Number', 'Boolean', 'Infinity', 'isNaN', 'parseInt',
  'parseFloat', 'encodeURIComponent', 'decodeURIComponent', 'queueMicrotask'
]);

const KEYWORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'delete',
  'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if',
  'import', 'in', 'instanceof', 'let', 'new', 'of', 'return', 'super',
  'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with',
  'yield', 'await', 'async', 'static', 'get', 'set', 'true', 'false', 'null',
  'undefined', 'NaN', 'enum', 'debugger'
]);

/* Check a single file for free names. Returns array of offending names. */
function freeNames(relPath, cleanSrc, exported) {
  const declared = collectDeclared(cleanSrc);
  const bad = new Map();
  for (const m of cleanSrc.matchAll(/([A-Za-z_$][\w$]*)/g)) {
    const name = m[1];
    const before = cleanSrc.slice(0, m.index).trimEnd().slice(-1);
    const after = cleanSrc.slice(m.index + name.length).trimStart()[0];
    if (before === '.' || before === '?' || before === '#') continue;
    if (after === ':') continue;
    if (declared.has(name) || GLOBALS.has(name) || KEYWORDS.has(name)) continue;
    if (!exported.has(name)) continue;
    bad.set(name, (bad.get(name) || 0) + 1);
  }
  return [...bad.keys()];
}

test('every src module uses no free cross-module name', () => {
  const clean = Object.fromEntries(
    SRC_FILES.map(f => [f, strip(fs.readFileSync(path.join(ROOT, f), 'utf8'))])
  );
  const exported = collectExported(clean);
  const offenders = [];
  for (const f of SRC_FILES) {
    const bad = freeNames(f, clean[f], exported);
    if (bad.length) offenders.push(`${f} :: ${bad.join(', ')}`);
  }
  assert.deepEqual(offenders, [],
    `free cross-module name(s) used without import:\n  ${offenders.join('\n  ')}`);
});

/* Fixture smoke test — ensures the checker actually flags things. */
test('the checker still has teeth (fixtures)', () => {
  const exported = new Set(['foo', 'bar', 'baz']);
  const cases = [
    { name: 'bare free name', src: 'foo', expect: ['foo'] },
    { name: 'dotted access', src: 'obj.foo', expect: [] },
    { name: 'object key', src: '{ foo: 1 }', expect: [] },
    { name: 'global', src: 'console.log', expect: [] },
    { name: 'keyword', src: 'const foo = 1', expect: [] },
  ];
  for (const tc of cases) {
    const clean = strip(tc.src);
    const bad = freeNames('fixture', clean, exported);
    assert.deepEqual(bad, tc.expect, tc.name);
  }
});