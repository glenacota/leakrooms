/* Checks that named ES-module imports are used in executable source, not just
   mentioned in comments or strings. Keep this syntax-only like free-names.test.js:
   the project has no parser dependency. */
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

/* Strip comments and string/template literals, preserving newlines and offsets. */
const TEMPLATE = String.fromCharCode(96);

/* Strip comments and literal text, but retain code inside template expressions. */
function strip(src, start = 0, templateExpression = false) {
  let out = '';
  let i = start;
  let braces = templateExpression ? 1 : 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (templateExpression && c === '}') {
      if (--braces === 0) return { text: out + ' ', index: i + 1 };
      out += c; i++; continue;
    }
    if (templateExpression && c === '{') { braces++; out += c; i++; continue; }
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
    if (c === "'" || c === '"') {
      const q = c; out += ' '; i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        out += src[i] === '\n' ? '\n' : ' '; i++;
      }
      out += ' '; i++; continue;
    }
    if (c === TEMPLATE) {
      out += ' '; i++;
      while (i < src.length && src[i] !== TEMPLATE) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          out += '  '; i += 2;
          const expr = strip(src, i, true);
          out += expr.text; i = expr.index;
          continue;
        }
        out += src[i] === '\n' ? '\n' : ' '; i++;
      }
      out += ' '; i++; continue;
    }
    out += c; i++;
  }
  return templateExpression ? { text: out, index: i } : out;
}

/* Read local binding names from named import clauses, including aliases. */
function namedImports(clean) {
  const names = [];
  const re = /^[ \t]*import\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\b[^;]*;/gm;
  for (const m of clean.matchAll(re)) {
    for (const part of m[1].split(',')) {
      const spec = part.trim();
      if (!spec) continue;
      const local = spec.split(/\s+as\s+/).at(-1).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(local)) names.push(local);
    }
  }
  return names;
}

/* Blank every static import statement so its own specifiers cannot count as use. */
function stripImports(clean) {
  return clean.replace(/^[ \t]*import\s+[^;]*;/gm, statement =>
    statement.replace(/[^\n]/g, ' '));
}

/** Returns local named imports absent from the stripped source body. */
function unusedImports(src) {
  const clean = strip(src);
  const imports = namedImports(clean);
  const body = stripImports(clean);
  const identifiers = new Set(body.match(/[A-Za-z_$][\w$]*/g) || []);
  return imports.filter(name => !identifiers.has(name));
}

test('every named import is used in its src module body', () => {
  const offenders = [];
  for (const file of SRC_FILES) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const unused = unusedImports(src);
    if (unused.length) offenders.push(`${file} :: ${unused.join(', ')}`);
  }
  assert.deepEqual(offenders, [],
    `unused named import(s):\n  ${offenders.join('\n  ')}`);
});

/* Fixture smoke tests make sure the checker catches dead imports, local aliases,
   and false "uses" that exist only as prose or literal text. */
test('the checker has teeth for fixture imports and mentions', () => {
  assert.deepEqual(unusedImports(`
    import { live, unused as orphan } from './fixture.js';
    live();
    // orphan is only mentioned in a comment.
    const note = "unused";
  `), ['orphan']);

  assert.deepEqual(unusedImports(`
    import { phraseOnly } from './fixture.js';
    /* phraseOnly */
    const note = 'phraseOnly';
  `), ['phraseOnly']);

  assert.deepEqual(unusedImports(`
    import { original as localName } from './fixture.js';
    localName();
  `), []);
});
