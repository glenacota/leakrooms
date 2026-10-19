/* Soft assertion collector.
   assert() records and logs instead of throwing, so one run surfaces every
   failure rather than only the first. done() throws at the end if anything was
   recorded. Tests create their own collector, so blocks can be independent. */
export function softAssert(){
  const failures = [];
  return {
    assert(c,m){ if(!c){ console.log('  FAIL: '+m); failures.push(m); } },
    done(){ if (failures.length) throw new Error(`${failures.length} assertion(s) failed`); },
  };
}
