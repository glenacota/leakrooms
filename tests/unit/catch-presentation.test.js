import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';
import {
  CATCH_MS, CATCH_SKIP_GRACE_MS, CATCH_ZOOM_MAX, beginCatchPresentation, catchDue, catchPresenting,
  catchProgress, catchSkippable, catchZoomScale, endCatchPresentation,
} from '../../src/util/catch-presentation.js';

/* The timing module is pure: every time is passed in, so nothing waits on a clock. */
test('[catch] the beat is a fixed length on the browser timeline', () => {
  const t = softAssert();
  endCatchPresentation();
  t.assert(!catchPresenting(), 'a beat plays before one starts');
  t.assert(catchProgress(5000) === 1, 'no beat should read as finished');

  beginCatchPresentation(1000);
  t.assert(catchPresenting(), 'the beat did not start');
  t.assert(catchProgress(1000) === 0, 'the beat does not start at 0');
  t.assert(Math.abs(catchProgress(1000 + CATCH_MS / 2) - 0.5) < 1e-9, 'the midpoint is not 0.5');
  t.assert(catchProgress(1000 + CATCH_MS * 3) === 1, 'progress does not clamp at 1');
  t.assert(!catchDue(1000 + CATCH_MS - 1), 'the beat ends before its length');
  t.assert(catchDue(1000 + CATCH_MS), 'the beat does not end at its length');
  t.assert(!catchSkippable(1000 + CATCH_SKIP_GRACE_MS - 1), 'opening input can cut off the beat');
  t.assert(catchSkippable(1000 + CATCH_SKIP_GRACE_MS), 'the beat cannot ever be skipped');
  t.assert(catchZoomScale(1000) === 1, 'catch zoom starts at normal scale');
  t.assert(catchZoomScale(1000 + CATCH_MS / 2) === 75.5, 'catch zoom reaches midpoint scale');
  t.assert(catchZoomScale(1000 + CATCH_MS) === CATCH_ZOOM_MAX, 'catch zoom stays at maximum scale at the end');

  t.assert(endCatchPresentation() === true, 'ending a playing beat should report it');
  t.assert(endCatchPresentation() === false, 'ending twice should report nothing the second time');
  t.assert(!catchPresenting(), 'the beat is still playing after it ended');
  t.done();
});

const { A, els } = await loadGame();
const cardShown = () => !els['screen-dead'].classList.contains('hidden');

function floorInPlay(){
  A.hideScreens();
  A.RUN_SEED = 4242;
  A.buildFloor(0, 4242);
  A.STATE = 'play';
  A.lives = 3;
  A.floorIdx = 0;
}

test('[catch] a catch holds the death card until the beat ends', () => {
  const t = softAssert();
  endCatchPresentation();
  floorInPlay();

  A.caught();
  t.assert(A.STATE === 'dead', `a catch left STATE at ${A.STATE}, want dead`);
  t.assert(A.lives === 2, `a catch cost ${3 - A.lives} crew, want 1`);
  t.assert(catchPresenting(), 'a catch did not start the beat');
  t.assert(!cardShown(), 'the death card showed during the beat');

  t.assert(A.revealDeath() === true, 'revealing the card during the beat did nothing');
  t.assert(cardShown(), 'the death card did not show after the reveal');
  t.assert(!catchPresenting(), 'the beat is still playing after the reveal');
  t.assert(A.revealDeath() === false, 'a second reveal showed the card again');
  t.done();
});

test('[catch] repeated catches restart the beat from zero', () => {
  const t = softAssert();
  endCatchPresentation();
  floorInPlay();

  A.caught();
  t.assert(catchProgress(1000) === 0, 'the first catch beat did not start at zero');
  t.assert(A.revealDeath() === true, 'the first catch beat could not be revealed');

  A.STATE = 'play';
  A.lives = 2;
  A.caught();
  t.assert(catchPresenting(), 'the second catch beat did not start');
  t.assert(catchProgress(performance.now()) < 0.1, 'the second catch beat inherited first-catch progress');

  t.done();
});

test('[catch] running out of air shows the card at once', () => {
  const t = softAssert();
  endCatchPresentation();
  floorInPlay();

  A.outOfTime();
  t.assert(A.STATE === 'dead', `running out of air left STATE at ${A.STATE}`);
  t.assert(!catchPresenting(), 'running out of air started the catch beat');
  t.assert(cardShown(), 'the death card did not show at once');
  t.done();
});

test('[catch] retrying during the beat ends it and starts play', () => {
  const t = softAssert();
  endCatchPresentation();
  floorInPlay();

  A.caught();
  els['btn-retry'].click();
  t.assert(A.STATE === 'play', `retry left STATE at ${A.STATE}, want play`);
  t.assert(!catchPresenting(), 'the beat is still playing after a retry');
  t.done();
});

test('[catch] a key during the beat skips it and does not also retry', () => {
  const t = softAssert();
  endCatchPresentation();
  floorInPlay();

  A.caught();
  beginCatchPresentation(performance.now() - CATCH_SKIP_GRACE_MS);
  const keydown = global.window._h && global.window._h.keydown;
  t.assert(typeof keydown === 'function', 'no keydown handler was registered');
  keydown({ key: 'Enter', repeat: false, metaKey: false, ctrlKey: false, altKey: false, preventDefault(){} });
  t.assert(!catchPresenting(), 'a key did not skip the beat');
  t.assert(cardShown(), 'skipping the beat did not show the card');
  t.assert(A.STATE === 'dead', `the skip key also retried: STATE is ${A.STATE}`);
  t.done();
});
