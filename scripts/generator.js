import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getNextDraw, getUpcomingDraws, isDrawPast } from './draw-schedule.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'draws.json');
const GENERATED_FILE = path.join(__dirname, '..', 'data', 'generated.json');

const WEIGHTS = {
  frequency: 0.11,
  recency: 0.10,
  gap: 0.14,
  pairSynergy: 0.16,
  recentPairs: 0.08,
  tripletSynergy: 0.06,
  oddEven: 0.11,
  sumRange: 0.11,
  spread: 0.05,
  decadeSpread: 0.04,
  consecutive: 0.05,
  lastDraw: 0.04,
  diversity: 0.05,
};

const VARIANTS_PER_DRAW = 1;
const MONTE_CARLO_SAMPLES = 100000;
const TOP_POOL_SIZE = 80;
const RECENCY_WINDOW = 120;
const RECENT_PAIRS_WINDOW = 60;

function loadDraws() {
  if (!fs.existsSync(DATA_FILE)) return [];
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return data.draws || [];
}

function loadGenerated() {
  if (!fs.existsSync(GENERATED_FILE)) {
    return { draws: [], lastAutoRun: null };
  }
  return JSON.parse(fs.readFileSync(GENERATED_FILE, 'utf8'));
}

function saveGenerated(data) {
  const dir = path.dirname(GENERATED_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(GENERATED_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function buildAnalytics(draws) {
  const frequency = {};
  const recency = {};
  const lastSeen = {};
  const pairCount = {};
  const recentPairCount = {};
  const tripletCount = {};
  const sums = [];
  const oddCounts = {};
  const gaps = {};

  for (let n = 1; n <= 49; n++) {
    frequency[n] = 0;
    recency[n] = 0;
    lastSeen[n] = null;
  }

  const chronological = [...draws].reverse();
  const today = new Date();
  const recentDraws = draws.slice(0, RECENT_PAIRS_WINDOW);

  chronological.forEach((draw, idx) => {
    const nums = draw.numbers;
    const sum = nums.reduce((a, b) => a + b, 0);
    sums.push(sum);

    const odd = nums.filter((n) => n % 2 === 1).length;
    oddCounts[odd] = (oddCounts[odd] || 0) + 1;

    const ageFromEnd = chronological.length - 1 - idx;
    const recencyWeight = ageFromEnd < RECENCY_WINDOW
      ? 1 + (RECENCY_WINDOW - ageFromEnd) / RECENCY_WINDOW
      : 0.4;

    for (const n of nums) {
      frequency[n]++;
      recency[n] += recencyWeight;
      lastSeen[n] = draw.date;
    }

    for (let i = 0; i < nums.length; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        const a = Math.min(nums[i], nums[j]);
        const b = Math.max(nums[i], nums[j]);
        const key = `${a}-${b}`;
        pairCount[key] = (pairCount[key] || 0) + 1;
      }
    }

    for (let i = 0; i < nums.length; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        for (let k = j + 1; k < nums.length; k++) {
          const sorted = [nums[i], nums[j], nums[k]].sort((a, b) => a - b);
          tripletCount[sorted.join('-')] = (tripletCount[sorted.join('-')] || 0) + 1;
        }
      }
    }
  });

  for (const draw of recentDraws) {
    const nums = draw.numbers;
    for (let i = 0; i < nums.length; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        const a = Math.min(nums[i], nums[j]);
        const b = Math.max(nums[i], nums[j]);
        const key = `${a}-${b}`;
        recentPairCount[key] = (recentPairCount[key] || 0) + 1;
      }
    }
  }

  const totalDraws = draws.length;
  const expectedFreq = (totalDraws * 6) / 49;
  const maxRecency = Math.max(...Object.values(recency), 1);

  for (let n = 1; n <= 49; n++) {
    gaps[n] = lastSeen[n]
      ? Math.floor((today - new Date(lastSeen[n])) / 86400000)
      : 9999;
  }

  const avgGap = Object.values(gaps).filter((g) => g < 9999).reduce((a, b) => a + b, 0) / 49;
  const sumMean = sums.reduce((a, b) => a + b, 0) / sums.length;
  const sumStd = Math.sqrt(sums.reduce((s, v) => s + (v - sumMean) ** 2, 0) / sums.length) || 1;

  const maxPair = Math.max(...Object.values(pairCount), 1);
  const maxRecentPair = Math.max(...Object.values(recentPairCount), 1);
  const maxTriplet = Math.max(...Object.values(tripletCount), 1);

  const idealSpread = 7.5;

  return {
    frequency,
    recency,
    maxRecency,
    expectedFreq,
    gaps,
    avgGap,
    pairCount,
    recentPairCount,
    tripletCount,
    maxPair,
    maxRecentPair,
    maxTriplet,
    sumMean,
    sumStd,
    oddCounts,
    idealSpread,
    totalDraws,
    lastDraw: new Set(draws[0]?.numbers || []),
    recentDraws: draws.slice(0, 10).map((d) => d.numbers),
  };
}

function decadeOf(n) {
  return Math.ceil(n / 10);
}

function countOdd(nums) {
  return nums.filter((n) => n % 2 === 1).length;
}

function countConsecutive(sorted) {
  let count = 0;
  for (let i = 0; i < 5; i++) {
    if (sorted[i + 1] - sorted[i] === 1) count++;
  }
  return count;
}

function overlap(a, b) {
  const setB = new Set(b);
  return a.filter((n) => setB.has(n)).length;
}

function spreadScore(sorted) {
  const gaps = [];
  for (let i = 0; i < 5; i++) gaps.push(sorted[i + 1] - sorted[i]);
  const avg = gaps.reduce((a, b) => a + b, 0) / 5;
  const variance = gaps.reduce((s, g) => s + (g - avg) ** 2, 0) / 5;
  const spread = Math.sqrt(variance);
  const z = Math.abs(spread - 7.5) / 4;
  return Math.exp(-0.5 * z * z);
}

function scoreCombination(nums, analytics, existingVariants = []) {
  const sorted = [...nums].sort((a, b) => a - b);
  const breakdown = {};

  const freqScores = sorted.map((n) => {
    const dev = (analytics.frequency[n] - analytics.expectedFreq) / analytics.expectedFreq;
    return 1 - Math.abs(dev) * 0.55;
  });
  breakdown.frequency = freqScores.reduce((a, b) => a + b, 0) / 6;

  breakdown.recency = sorted.map((n) => analytics.recency[n] / analytics.maxRecency)
    .reduce((a, b) => a + b, 0) / 6;

  const gapScores = sorted.map((n) => {
    const g = analytics.gaps[n];
    const ratio = g / analytics.avgGap;
    if (ratio >= 0.6 && ratio <= 1.8) return 1;
    if (ratio < 0.6) return 0.55 + ratio;
    return Math.max(0.35, 1.6 - ratio * 0.3);
  });
  breakdown.gap = gapScores.reduce((a, b) => a + b, 0) / 6;

  let pairScore = 0;
  let pairs = 0;
  let recentPairScore = 0;
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      const key = `${sorted[i]}-${sorted[j]}`;
      pairScore += (analytics.pairCount[key] || 0) / analytics.maxPair;
      recentPairScore += (analytics.recentPairCount[key] || 0) / analytics.maxRecentPair;
      pairs++;
    }
  }
  breakdown.pairSynergy = pairScore / pairs;
  breakdown.recentPairs = recentPairScore / pairs;

  let tripletScore = 0;
  let triplets = 0;
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      for (let k = j + 1; k < 6; k++) {
        const key = [sorted[i], sorted[j], sorted[k]].join('-');
        tripletScore += (analytics.tripletCount[key] || 0) / analytics.maxTriplet;
        triplets++;
      }
    }
  }
  breakdown.tripletSynergy = tripletScore / triplets;

  const odd = countOdd(sorted);
  const totalOdd = Object.values(analytics.oddCounts).reduce((a, b) => a + b, 0);
  breakdown.oddEven = (analytics.oddCounts[odd] || 0) / totalOdd;
  if (odd === 3) breakdown.oddEven = Math.min(1, breakdown.oddEven * 1.2);

  const sum = sorted.reduce((a, b) => a + b, 0);
  const z = Math.abs(sum - analytics.sumMean) / analytics.sumStd;
  breakdown.sumRange = Math.exp(-0.5 * z * z);

  breakdown.spread = spreadScore(sorted);

  const decades = new Set(sorted.map(decadeOf));
  breakdown.decadeSpread = decades.size / 5;

  const consec = countConsecutive(sorted);
  breakdown.consecutive = Math.max(0, 1 - consec * 0.4);

  let lastOverlap = 0;
  for (const n of sorted) {
    if (analytics.lastDraw.has(n)) lastOverlap++;
  }
  breakdown.lastDraw = 1 - lastOverlap / 6;

  let diversity = 1;
  for (const variant of existingVariants) {
    diversity = Math.min(diversity, (6 - overlap(sorted, variant)) / 6);
  }
  breakdown.diversity = existingVariants.length ? diversity : 1;

  let total = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    total += (breakdown[key] || 0) * weight;
  }

  return {
    score: Math.round(total * 1000) / 1000,
    breakdown,
    meta: {
      sum,
      odd,
      even: 6 - odd,
      decades: [...decades].sort(),
      consecutive: consec,
      lastDrawOverlap: lastOverlap,
    },
  };
}

function refineCombination(nums, analytics, existingVariants) {
  let best = [...nums].sort((a, b) => a - b);
  let bestScore = scoreCombination(best, analytics, existingVariants).score;

  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (let i = 0; i < 6; i++) {
      for (let candidate = 1; candidate <= 49; candidate++) {
        if (best.includes(candidate)) continue;
        const trial = [...best];
        trial[i] = candidate;
        trial.sort((a, b) => a - b);
        if (!passesHardFilters(trial, analytics)) continue;
        const scored = scoreCombination(trial, analytics, existingVariants);
        if (scored.score > bestScore) {
          best = trial;
          bestScore = scored.score;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return { numbers: best, ...scoreCombination(best, analytics, existingVariants) };
}

function randomCombination(exclude = new Set()) {
  const pool = [];
  for (let n = 1; n <= 49; n++) {
    if (!exclude.has(n)) pool.push(n);
  }
  const result = [];
  while (result.length < 6) {
    const idx = Math.floor(Math.random() * pool.length);
    result.push(pool.splice(idx, 1)[0]);
  }
  return result.sort((a, b) => a - b);
}

function passesHardFilters(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const odd = countOdd(sorted);
  const decades = new Set(sorted.map(decadeOf));

  if (sum < 95 || sum > 205) return false;
  if (odd === 0 || odd === 6) return false;
  if (decades.size < 4) return false;
  if (countConsecutive(sorted) >= 3) return false;

  const low = sorted.filter((n) => n <= 16).length;
  const high = sorted.filter((n) => n >= 34).length;
  if (low === 0 || high === 0) return false;

  const gaps = [];
  for (let i = 0; i < 5; i++) gaps.push(sorted[i + 1] - sorted[i]);
  if (Math.min(...gaps) < 2 && countConsecutive(sorted) >= 2) return false;

  return true;
}

function pickFromPool(candidates, existingVariants) {
  const minDiff = 3;
  const pool = candidates.slice(0, TOP_POOL_SIZE);

  for (const c of pool) {
    const tooSimilar = existingVariants.some(
      (v) => 6 - overlap(c.numbers, v) < minDiff
    );
    if (!tooSimilar) return c;
  }

  const weights = pool.map((c) => c.score ** 3);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[0];
}

function generateVariant(analytics, existingVariants = [], attemptOffset = 0) {
  const candidates = [];

  for (let i = 0; i < MONTE_CARLO_SAMPLES; i++) {
    const combo = randomCombination();
    if (!passesHardFilters(combo)) continue;

    const scored = scoreCombination(combo, analytics, existingVariants);
    if (scored.score < 0.48) continue;

    candidates.push({ numbers: combo, ...scored });
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    const fallback = randomCombination();
    return refineCombination(fallback, analytics, existingVariants);
  }

  const picked = pickFromPool(candidates, existingVariants);
  return refineCombination(picked.numbers, analytics, existingVariants);
}

function generateVariants(count = VARIANTS_PER_DRAW) {
  const draws = loadDraws();
  if (!draws.length) throw new Error('Nu există date istorice pentru generare.');

  const analytics = buildAnalytics(draws);
  const variants = [];
  const existing = [];

  for (let i = 0; i < count; i++) {
    const variant = generateVariant(analytics, existing, i);
    variants.push({
      numbers: variant.numbers,
      score: variant.score,
      breakdown: variant.breakdown,
      meta: variant.meta,
      generatedAt: new Date().toISOString(),
    });
    existing.push(variant.numbers);
  }

  return {
    variants,
    analytics: {
      totalDraws: analytics.totalDraws,
      sumMean: Math.round(analytics.sumMean),
      avgGap: Math.round(analytics.avgGap),
    },
  };
}

function ensureDrawEntry(store, draw) {
  let entry = store.draws.find((d) => d.drawKey === draw.key);
  if (!entry) {
    entry = {
      drawKey: draw.key,
      drawDate: draw.date,
      drawDisplay: draw.display,
      variants: [],
      autoGenerated: false,
    };
    store.draws.push(entry);
  }
  return entry;
}

function cleanupStore(store) {
  const next = getNextDraw();
  if (!next) return store;

  const archivedDates = new Set(loadDraws().map((d) => d.date));

  store.draws = store.draws.filter((entry) => {
    if (entry.drawKey === next.key) return true;
    if (archivedDates.has(entry.drawKey)) return true;
    return false;
  });

  return store;
}

function getNextEntry(store) {
  const next = getNextDraw();
  if (!next) return null;
  return store.draws.find((d) => d.drawKey === next.key) || null;
}

function autoGenerateIfNeeded() {
  const previous = loadGenerated();
  let store = { ...previous, draws: [...previous.draws] };
  const countBefore = store.draws.length;

  store = cleanupStore(store);
  let dirty = store.draws.length !== countBefore;

  const draws = loadDraws();
  if (!draws.length) {
    if (dirty) saveGenerated(store);
    return store;
  }

  const next = getNextDraw();
  if (!next) {
    if (dirty) saveGenerated(store);
    return store;
  }

  const entry = ensureDrawEntry(store, next);

  if (entry.variants.length === 0) {
    const analytics = buildAnalytics(draws);
    const variant = generateVariant(analytics, []);

    entry.variants = [{
      numbers: variant.numbers,
      score: variant.score,
      breakdown: variant.breakdown,
      meta: variant.meta,
      generatedAt: new Date().toISOString(),
      source: 'auto',
    }];
    entry.autoGenerated = true;
    store.lastAutoRun = new Date().toISOString();
    dirty = true;
    console.log(`[generator] Auto: 1 variantă pentru ${next.display}`);
  }

  if (dirty) saveGenerated(store);

  return store;
}

function manualGenerate(drawKey = null) {
  const draws = loadDraws();
  if (!draws.length) throw new Error('Nu există date istorice.');

  const draw = drawKey
    ? getUpcomingDraws(4).find((d) => d.key === drawKey) || getNextDraw()
    : getNextDraw();

  if (!draw) throw new Error('Nu s-a putut determina extragerea.');

  const store = cleanupStore(loadGenerated());
  const entry = ensureDrawEntry(store, draw);
  const analytics = buildAnalytics(draws);
  const variant = generateVariant(analytics, []);

  const newVariant = {
    numbers: variant.numbers,
    score: variant.score,
    breakdown: variant.breakdown,
    meta: variant.meta,
    generatedAt: new Date().toISOString(),
    source: 'manual',
  };

  entry.variants = [newVariant];
  store.lastAutoRun = new Date().toISOString();
  saveGenerated(store);

  return { draw, variant: newVariant, entry };
}

function getVariantMatchMap() {
  const store = loadGenerated();
  const map = {};

  for (const entry of store.draws) {
    if (!entry.variants?.length) continue;
    const nums = new Set();
    for (const v of entry.variants) {
      for (const n of v.numbers) nums.add(n);
    }
    map[entry.drawKey] = [...nums];
  }

  return map;
}

function getMatchResults() {
  const store = loadGenerated();
  const draws = loadDraws();
  const results = [];

  for (const entry of store.draws) {
    const actual = draws.find((d) => d.date === entry.drawKey);
    if (!actual) continue;

    for (const variant of entry.variants) {
      const hits = variant.numbers.filter((n) => actual.numbers.includes(n));
      results.push({
        drawKey: entry.drawKey,
        drawDisplay: entry.drawDisplay,
        variantNumbers: variant.numbers,
        actualNumbers: actual.numbers,
        hits: hits.length,
        hitNumbers: hits,
        source: variant.source,
      });
    }
  }

  return results.sort((a, b) => b.drawKey.localeCompare(a.drawKey));
}

function getGeneratorState() {
  const store = autoGenerateIfNeeded();
  const nextDraw = getNextDraw();
  const entry = getNextEntry(store);

  const displayEntry = entry
    ? { ...entry, variants: entry.variants.slice(0, 1) }
    : null;

  return {
    nextDraw,
    lastAutoRun: store.lastAutoRun,
    draws: displayEntry ? [displayEntry] : [],
    variantsPerDraw: 1,
    disclaimer:
      'Variantele sunt generate algoritmic pe baza distribuției istorice. Nu garantează câștiguri — fiecare combinație are probabilitate egală la extragere.',
  };
}

function startGeneratorSchedule() {
  autoGenerateIfNeeded();
  setInterval(() => autoGenerateIfNeeded(), 60 * 60 * 1000);
}

export {
  generateVariants,
  generateVariant,
  autoGenerateIfNeeded,
  manualGenerate,
  getGeneratorState,
  getVariantMatchMap,
  getMatchResults,
  startGeneratorSchedule,
  buildAnalytics,
  scoreCombination,
  VARIANTS_PER_DRAW,
};
