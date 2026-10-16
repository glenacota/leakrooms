/* Soft assertion collector. assert() logs and records instead of throwing,
   so one test run surfaces every failure, not just the first; done() raises
   at the end of the run if anything was recorded. This is the suite's old
   global fail-counter behaviour, moved into a factory so test blocks can
   collect independently. */
export function softAssert(){
  const failures = [];
  return {
    assert(c,m){ if(!c){ console.log('  FAIL: '+m); failures.push(m); } },
    done(){ if (failures.length) throw new Error(`${failures.length} assertion(s) failed`); },
  };
}
