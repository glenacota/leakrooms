export const LEADERBOARD_KEY = 'leakrooms.leaderboard.v1';
export const LEADERBOARD_TERMS = Object.freeze(['RELAXED', 'NORMAL', 'HARD']);

const TOP_RANK = 10;

function getStorage(){
  try {
    const storage = globalThis.localStorage;
    if (!storage) throw new Error('Browser storage is unavailable');
    return { storage };
  } catch (error){
    return { error };
  }
}

function isRecord(value){
  return value && typeof value === 'object' && !Array.isArray(value)
    && LEADERBOARD_TERMS.includes(value.terms)
    && (value.status === 'COMPLETED' || value.status === 'FAILED')
    && Number.isSafeInteger(value.total)
    && Number.isSafeInteger(value.elapsedSeconds) && value.elapsedSeconds >= 0
    && typeof value.timestamp === 'string' && Number.isFinite(Date.parse(value.timestamp));
}

function isLegacyRecord(value){
  return value && typeof value === 'object' && !Array.isArray(value)
    && LEADERBOARD_TERMS.includes(value.terms)
    && (value.outcome === 'win' || value.outcome === 'loss')
    && Number.isSafeInteger(value.score)
    && typeof value.time === 'number' && Number.isFinite(value.time) && value.time >= 0
    && Number.isSafeInteger(Math.floor(value.time))
    && typeof value.date === 'string' && Number.isFinite(Date.parse(value.date));
}

/** Loads all local shift results without replacing data that cannot be read. */
export function readLeaderboard(){
  const { storage, error } = getStorage();
  if (error) return { ok:false, records:[], error };
  try {
    const raw = storage.getItem(LEADERBOARD_KEY);
    if (!raw) return { ok:true, records:[] };
    const storedRecords = JSON.parse(raw);
    if (!Array.isArray(storedRecords)) throw new Error('Stored leaderboard data is invalid');
    let migrated = false;
    const records = storedRecords.map(record => {
      if (isRecord(record)) return record;
      if (!isLegacyRecord(record)) throw new Error('Stored leaderboard data is invalid');
      migrated = true;
      return {
        terms: record.terms,
        total: record.score,
        status: record.outcome === 'win' ? 'COMPLETED' : 'FAILED',
        elapsedSeconds: Math.floor(record.time),
        timestamp: record.date,
      };
    });
    if (migrated) storage.setItem(LEADERBOARD_KEY, JSON.stringify(records));
    return { ok:true, records };
  } catch (readError){
    return { ok:false, records:[], error:readError };
  }
}

/**
 * Ranks one terms list by total, with equal totals sharing competition ranks.
 * @param {Array<object>} records
 * @param {'RELAXED'|'NORMAL'|'HARD'} terms
 */
export function rankLeaderboard(records, terms){
  if (!LEADERBOARD_TERMS.includes(terms)) throw new RangeError(`Unknown leaderboard terms: ${terms}`);
  const sorted = records
    .filter(record => record.terms === terms)
    .slice()
    .sort((a, b) => b.total - a.total || a.timestamp.localeCompare(b.timestamp));
  let rank = 0;
  let priorTotal;
  return sorted.map((record, index) => {
    if (index === 0 || record.total !== priorTotal) rank = index + 1;
    priorTotal = record.total;
    return { ...record, rank };
  });
}

/** Returns the first ten ranks, including every tie at rank ten. */
export function topLeaderboard(records, terms){
  return rankLeaderboard(records, terms).filter(record => record.rank <= TOP_RANK);
}

/** Saves a terminal shift result and returns its rank in that terms list. */
export function recordLeaderboardResult(result){
  if (!isRecord(result)) throw new TypeError('Invalid leaderboard result');
  const current = readLeaderboard();
  if (!current.ok) return current;

  const records = [...current.records, result];
  const { storage, error } = getStorage();
  if (error) return { ok:false, records:current.records, error };
  try {
    storage.setItem(LEADERBOARD_KEY, JSON.stringify(records));
  } catch (writeError){
    return { ok:false, records:current.records, error:writeError };
  }

  const rank = 1 + current.records.filter(record =>
    record.terms === result.terms && record.total > result.total).length;
  return { ok:true, records, rank };
}

/** Removes every saved result from this browser. */
export function clearLeaderboard(){
  const { storage, error } = getStorage();
  if (error) return { ok:false, error };
  try {
    storage.removeItem(LEADERBOARD_KEY);
    return { ok:true };
  } catch (removeError){
    return { ok:false, error:removeError };
  }
}
