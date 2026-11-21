/* Soft assertion collector.
   assert() records and logs instead of throwing, so one run surfaces every
   failure rather than only the first. done() throws at the end if anything was
   recorded. Tests create their own collector, so blocks can be independent.

   A collector that records a failure and is never done() would hide that
   failure from the build. The exit hook below fails the test file in that case.
   Each test file runs in its own process under `node --test`, so the hook
   applies per file. */
const unreported = new Set();

process.on('exit', () => {
  if (unreported.size === 0) return;
  console.log(`  FAIL: ${unreported.size} soft-assert collector(s) recorded failures but never called done()`);
  process.exitCode = 1;
});

export function softAssert(){
  const failures = [];
  const collector = {
    assert(c,m){
      if(!c){ console.log('  FAIL: '+m); failures.push(m); unreported.add(collector); }
    },
    done(){
      unreported.delete(collector);
      if (failures.length) throw new Error(`${failures.length} assertion(s) failed`);
    },
  };
  return collector;
}
