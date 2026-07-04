import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getNextDraw, getUpcomingDraws } from './draw-schedule-euromillions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'euromillions-draws.json');
const GENERATED_FILE = path.join(__dirname, '..', 'data', 'euromillions-generated.json');

const MAIN_MAX = 50;
const MAIN_COUNT = 5;
const STAR_MAX = 12;
const STAR_COUNT = 2;

const WEIGHTS = {
  frequency: 0.12,
  recency: 0.10,
  gap: 0.14,
  pairSynergy: 0.18,
  recentPairs: 0.08,
  oddEven: 0.12,
  sumRange: 0.12,
  spread: 0.06,
  decadeSpread: 0.04,
  consecutive: 0.04,
};

const STAR_WEIGHTS = {
  frequency: 0.35,
  gap: 0.30,
  oddEven: 0.20,
  pairSynergy: 0.15,
};

const MONTE_CARLO_SAMPLES = 80000;
const TOP_POOL_SIZE = 60;
const RECENCY_WINDOW = 100;
const RECENT_PAIRS_WINDOW = 50;

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
  const starFrequency = {};
  const starGap = {};
  const starLastSeen = {};
  const starPairCount = {};
  const sums = [];
  const oddCounts = {};

  for (let n = 1; n <= MAIN_MAX; n++) {
    frequency[n] = 0;
    recency[n] = 0;
    lastSeen[n] = null;
  }
  for (let n = 1; n <= STAR_MAX; n++) {
    starFrequency[n] = 0;
    starLastSeen[n] = null;
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

    for (const s of draw.stars) {
      starFrequency[s]++;
      starLastSeen[s] = draw.date;
    }

    for (let i = 0; i < nums.length; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        const a = Math.min(nums[i], nums[j]);
        const b = Math.max(nums[i], nums[j]);
        const key = `${a}-${b}`;
        pairCount[key] = (pairCount[key] || 0) + 1;
      }
    }

    const [s1, s2] = [...draw.stars].sort((a, b) => a - b);
    const starKey = `${s1}-${s2}`;
    starPairCount[starKey] = (starPairCount[starKey] || 0) + 1;
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
  const expectedFreq = (totalDraws * MAIN_COUNT) / MAIN_MAX;
  const maxRecency = Math.max(...Object.values(recency), 1);
  const gaps = {};

  for (let n = 1; n <= MAIN_MAX; n++) {
    gaps[n] = lastSeen[n]
      ? Math.floor((today - new Date(lastSeen[n])) / 86400000)
      : 9999;
    starGap[n] = starLastSeen[n]
      ? Math.floor((today - new Date(starLastSeen[n])) / 86400000)
      : 9999;
  }

  const avgGap = Object.values(gaps).filter((g) => g < 9999).reduce((a, b) => a + b, 0) / MAIN_MAX;
  const avgStarGap = Object.values(starGap).filter((g) => g < 9999).reduce((a, b) => a + b, 0) / STAR_MAX;
  const sumMean = sums.reduce((a, b) => a + b, 0) / sums.length;
  const sumStd = Math.sqrt(sums.reduce((s, v) => s + (v - sumMean) ** 2, 0) / sums.length) || 1;

  return {
    frequency,
    recency,
    maxRecency,
    expectedFreq,
    gaps,
    avgGap,
    pairCount,
    recentPairCount,
    maxPair: Math.max(...Object.values(pairCount), 1),
    maxRecentPair: Math.max(...Object.values(recentPairCount), 1),
    sumMean,
    sumStd,
    oddCounts,
    totalDraws,
    lastDraw: new Set(draws[0]?.numbers || []),
    starFrequency,
    starGap,
    avgStarGap,
    starPairCount,
    maxStarPair: Math.max(...Object.values(starPairCount), 1),
    expectedStarFreq: (totalDraws * STAR_COUNT) / STAR_MAX,
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
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1] - sorted[i] === 1) count++;
  }
  return count;
}

function spreadScore(sorted) {
  const gaps = [];
  for (let i = 0; i < sorted.length - 1; i++) gaps.push(sorted[i + 1] - sorted[i]);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const variance = gaps.reduce((s, g) => s + (g - avg) ** 2, 0) / gaps.length;
  const spread = Math.sqrt(variance);
  const z = Math.abs(spread - 9) / 5;
  return Math.exp(-0.5 * z * z);
}

function scoreMain(nums, analytics) {
  const sorted = [...nums].sort((a, b) => a - b);
  const breakdown = {};

  breakdown.frequency = sorted.map((n) => {
    const dev = (analytics.frequency[n] - analytics.expectedFreq) / analytics.expectedFreq;
    return 1 - Math.abs(dev) * 0.55;
  }).reduce((a, b) => a + b, 0) / MAIN_COUNT;

  breakdown.recency = sorted.map((n) => analytics.recency[n] / analytics.maxRecency)
    .reduce((a, b) => a + b, 0) / MAIN_COUNT;

  breakdown.gap = sorted.map((n) => {
    const g = analytics.gaps[n];
    const ratio = g / analytics.avgGap;
    if (ratio >= 0.6 && ratio <= 1.8) return 1;
    if (ratio < 0.6) return 0.55 + ratio;
    return Math.max(0.35, 1.6 - ratio * 0.3);
  }).reduce((a, b) => a + b, 0) / MAIN_COUNT;

  let pairScore = 0;
  let recentPairScore = 0;
  let pairs = 0;
  for (let i = 0; i < MAIN_COUNT; i++) {
    for (let j = i + 1; j < MAIN_COUNT; j++) {
      const key = `${sorted[i]}-${sorted[j]}`;
      pairScore += (analytics.pairCount[key] || 0) / analytics.maxPair;
      recentPairScore += (analytics.recentPairCount[key] || 0) / analytics.maxRecentPair;
      pairs++;
    }
  }
  breakdown.pairSynergy = pairScore / pairs;
  breakdown.recentPairs = recentPairScore / pairs;

  const odd = countOdd(sorted);
  const totalOdd = Object.values(analytics.oddCounts).reduce((a, b) => a + b, 0);
  breakdown.oddEven = (analytics.oddCounts[odd] || 0) / totalOdd;
  if (odd === 2 || odd === 3) breakdown.oddEven = Math.min(1, breakdown.oddEven * 1.15);

  const sum = sorted.reduce((a, b) => a + b, 0);
  const z = Math.abs(sum - analytics.sumMean) / analytics.sumStd;
  breakdown.sumRange = Math.exp(-0.5 * z * z);
  breakdown.spread = spreadScore(sorted);
  breakdown.decadeSpread = new Set(sorted.map(decadeOf)).size / 5;
  breakdown.consecutive = Math.max(0, 1 - countConsecutive(sorted) * 0.45);

  let total = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    total += (breakdown[key] || 0) * weight;
  }

  return { score: total, breakdown, sum, odd };
}

function scoreStars(stars, analytics) {
  const sorted = [...stars].sort((a, b) => a - b);
  const breakdown = {};

  breakdown.frequency = sorted.map((n) => {
    const dev = (analytics.starFrequency[n] - analytics.expectedStarFreq) / analytics.expectedStarFreq;
    return 1 - Math.abs(dev) * 0.55;
  }).reduce((a, b) => a + b, 0) / STAR_COUNT;

  breakdown.gap = sorted.map((n) => {
    const g = analytics.starGap[n];
    const ratio = g / analytics.avgStarGap;
    if (ratio >= 0.5 && ratio <= 2) return 1;
    return Math.max(0.4, 1.2 - Math.abs(ratio - 1) * 0.3);
  }).reduce((a, b) => a + b, 0) / STAR_COUNT;

  const odd = countOdd(sorted);
  breakdown.oddEven = odd === 1 ? 1 : 0.65;

  const key = `${sorted[0]}-${sorted[1]}`;
  breakdown.pairSynergy = (analytics.starPairCount[key] || 0) / analytics.maxStarPair;

  let total = 0;
  for (const [key, weight] of Object.entries(STAR_WEIGHTS)) {
    total += (breakdown[key] || 0) * weight;
  }

  return { score: total, breakdown };
}

function passesHardFilters(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const odd = countOdd(sorted);
  const decades = new Set(sorted.map(decadeOf));

  if (sum < 55 || sum > 220) return false;
  if (odd === 0 || odd === 5) return false;
  if (decades.size < 3) return false;
  if (countConsecutive(sorted) >= 3) return false;

  return true;
}

function randomMain() {
  const pool = Array.from({ length: MAIN_MAX }, (_, i) => i + 1);
  const result = [];
  while (result.length < MAIN_COUNT) {
    const idx = Math.floor(Math.random() * pool.length);
    result.push(pool.splice(idx, 1)[0]);
  }
  return result.sort((a, b) => a - b);
}

function randomStars() {
  const pool = Array.from({ length: STAR_MAX }, (_, i) => i + 1);
  const result = [];
  while (result.length < STAR_COUNT) {
    const idx = Math.floor(Math.random() * pool.length);
    result.push(pool.splice(idx, 1)[0]);
  }
  return result.sort((a, b) => a - b);
}

function refineMain(nums, analytics) {
  let best = [...nums].sort((a, b) => a - b);
  let bestScore = scoreMain(best, analytics).score;

  for (let pass = 0; pass < 2; pass++) {
    let improved = false;
    for (let i = 0; i < MAIN_COUNT; i++) {
      for (let candidate = 1; candidate <= MAIN_MAX; candidate++) {
        if (best.includes(candidate)) continue;
        const trial = [...best];
        trial[i] = candidate;
        trial.sort((a, b) => a - b);
        if (!passesHardFilters(trial)) continue;
        const scored = scoreMain(trial, analytics);
        if (scored.score > bestScore) {
          best = trial;
          bestScore = scored.score;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return best;
}

function generateMain(analytics) {
  const candidates = [];

  for (let i = 0; i < MONTE_CARLO_SAMPLES; i++) {
    const combo = randomMain();
    if (!passesHardFilters(combo)) continue;
    const scored = scoreMain(combo, analytics);
    if (scored.score < 0.45) continue;
    candidates.push({ numbers: combo, ...scored });
  }

  candidates.sort((a, b) => b.score - a.score);
  const picked = candidates[0] || { numbers: randomMain() };
  const refined = refineMain(picked.numbers, analytics);
  return { numbers: refined, ...scoreMain(refined, analytics) };
}

function generateStars(analytics) {
  const candidates = [];

  for (let i = 0; i < 20000; i++) {
    const stars = randomStars();
    const scored = scoreStars(stars, analytics);
    if (scored.score < 0.4) continue;
    candidates.push({ stars, ...scored });
  }

  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) {
    const stars = randomStars();
    return { stars, ...scoreStars(stars, analytics) };
  }

  return candidates[Math.floor(Math.random() * Math.min(5, candidates.length))];
}

function generateVariant(analytics) {
  const main = generateMain(analytics);
  const star = generateStars(analytics);
  const combinedScore = main.score * 0.82 + star.score * 0.18;

  return {
    numbers: main.numbers,
    stars: star.stars,
    score: Math.round(combinedScore * 1000) / 1000,
    breakdown: main.breakdown,
    starBreakdown: star.breakdown,
    meta: {
      sum: main.sum,
      odd: main.odd,
      even: MAIN_COUNT - main.odd,
      starSum: star.stars.reduce((a, b) => a + b, 0),
    },
  };
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
    const variant = generateVariant(analytics);

    entry.variants = [{
      numbers: variant.numbers,
      stars: variant.stars,
      score: variant.score,
      breakdown: variant.breakdown,
      starBreakdown: variant.starBreakdown,
      meta: variant.meta,
      generatedAt: new Date().toISOString(),
      source: 'auto',
    }];
    entry.autoGenerated = true;
    store.lastAutoRun = new Date().toISOString();
    dirty = true;
    console.log(`[euromillions] Auto: 1 variantă pentru ${next.display}`);
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
  const variant = generateVariant(analytics);

  const newVariant = {
    numbers: variant.numbers,
    stars: variant.stars,
    score: variant.score,
    breakdown: variant.breakdown,
    starBreakdown: variant.starBreakdown,
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
    const stars = new Set();
    for (const v of entry.variants) {
      for (const n of v.numbers) nums.add(n);
      for (const s of v.stars) stars.add(s);
    }
    map[entry.drawKey] = { numbers: [...nums], stars: [...stars] };
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
      const numHits = variant.numbers.filter((n) => actual.numbers.includes(n));
      const starHits = variant.stars.filter((s) => actual.stars.includes(s));
      results.push({
        drawKey: entry.drawKey,
        drawDisplay: entry.drawDisplay,
        variantNumbers: variant.numbers,
        variantStars: variant.stars,
        actualNumbers: actual.numbers,
        actualStars: actual.stars,
        numberHits: numHits.length,
        starHits: starHits.length,
        hitNumbers: numHits,
        hitStars: starHits,
        source: variant.source,
      });
    }
  }

  return results.sort((a, b) => b.drawKey.localeCompare(a.drawKey));
}

function getNextEntry(store) {
  const next = getNextDraw();
  if (!next) return null;
  return store.draws.find((d) => d.drawKey === next.key) || null;
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
      'Variantele sunt generate algoritmic pe baza distribuției istorice EuroMillions UK. Nu garantează câștiguri — fiecare combinație are probabilitate egală la extragere.',
  };
}

function startGeneratorSchedule() {
  autoGenerateIfNeeded();
  setInterval(() => autoGenerateIfNeeded(), 60 * 60 * 1000);
}

export {
  autoGenerateIfNeeded,
  manualGenerate,
  getGeneratorState,
  getVariantMatchMap,
  getMatchResults,
  startGeneratorSchedule,
};
