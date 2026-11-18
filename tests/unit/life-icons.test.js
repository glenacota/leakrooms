import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { readCss, readHtml } from '../helpers/src-text.js';
import { setLives, setRunLives } from '../../src/game/run.js';

const { A, els } = await loadGame();

test('life icons match remaining and spent lives on the HUD and pause page', () => {
  const originalLives = A.lives;
  const originalRunLives = A.runLives;
  A.buildFloor(0, 1234);

  try {
    for (const [total, remaining] of [[1, 1], [1, 0], [3, 2], [5, 5], [5, 1]]){
      setRunLives(total);
      setLives(remaining);
      A.updateHUD();

      const hud = els['val-lives'].innerHTML;
      assert.match(hud, new RegExp(`aria-label="${remaining} of ${total} lives remaining"`));
      assert.equal((hud.match(/href="#i-plumber-head"/g) || []).length, total);
      assert.equal((hud.match(/class="life-pip gone"/g) || []).length, total - remaining);
      assert.equal((hud.match(/aria-hidden="true"/g) || []).length, total);

      A.STATE = 'play';
      A.togglePause();
      assert.equal(els['pause-lives'].innerHTML, hud);
    }
  } finally {
    setRunLives(originalRunLives);
    setLives(originalLives);
  }
});

test('plumber head icon and spent-life styles are available to both readouts', () => {
  const html = readHtml();
  const css = readCss();
  assert.match(html, /<symbol id="i-plumber-head"[^>]*>[\s\S]*?fill="#e8c11f"[\s\S]*?fill="#000"[\s\S]*?<\/symbol>/);
  assert.match(css, /\.life-pip\.gone\s*\{[^}]*opacity\s*:\s*\.2/);
  assert.match(css, /\.run-stats \.life-pip\s*\{[^}]*width\s*:\s*20px/);
});

test('field manual shows two remaining plumber heads and one spent head', () => {
  const html = readHtml();
  const legend = html.match(/<i class="lg lg-lives"[^>]*>([\s\S]*?)<\/i>/);
  assert.ok(legend, 'the crew legend is missing');
  assert.match(legend[0], /aria-hidden="true"/);
  assert.equal((legend[1].match(/href="#i-plumber-head"/g) || []).length, 3);
  assert.equal((legend[1].match(/class="life-pip gone"/g) || []).length, 1);
});
