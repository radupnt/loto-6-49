import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'euromillions-draws.json');
const API_URL = 'https://euromillions.api.pedromealha.dev/draws';
const UK_LATEST_URL = 'https://www.national-lottery.co.uk/results/euromillions/draw-history/csv';
const YEARS_BACK = 10;
const FETCH_HEADERS = { 'User-Agent': 'LotoHub/1.0 (personal archive)' };
const RETRY_DELAYS_MS = [3000, 8000, 15000];

const DAY_NAMES = ['Duminică', 'Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă'];
const MONTH_NAMES = [
  'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
  'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie',
];

function formatDisplay(date) {
  const dayName = DAY_NAMES[date.getUTCDay()];
  const monthName = MONTH_NAMES[date.getUTCMonth()];
  return `${dayName}, ${date.getUTCDate()} ${monthName} ${date.getUTCFullYear()}`;
}

function parseDraw(raw) {
  const date = new Date(raw.date);
  if (Number.isNaN(date.getTime())) return null;

  const numbers = raw.numbers.map((n) => parseInt(n, 10)).filter((n) => n >= 1 && n <= 50);
  const stars = raw.stars.map((n) => parseInt(n, 10)).filter((n) => n >= 1 && n <= 12);

  if (numbers.length !== 5 || stars.length !== 2) return null;

  const iso = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  const prize = Math.round(raw.prize || 0);
  const hasWinner = !!raw.has_winner;

  return {
    date: iso,
    dateDisplay: formatDisplay(date),
    year: date.getUTCFullYear(),
    numbers,
    stars,
    drawNumber: raw.draw_id || null,
    category1: {
      hasWinner,
      winners: hasWinner ? 1 : 0,
      prize: hasWinner ? prize : 0,
      jackpot: prize,
      currency: 'EUR',
    },
  };
}

function parseUkLatestDraw(xml) {
  const dateIso = xml.match(/<draw-date>(\d{4}-\d{2}-\d{2})<\/draw-date>/)?.[1];
  if (!dateIso) return null;

  const numbers = [...xml.matchAll(/<ball number="\d+">(\d+)<\/ball>/g)]
    .map((m) => parseInt(m[1], 10))
    .filter((n) => n >= 1 && n <= 50);
  const stars = [...xml.matchAll(/<bonus-ball[^>]*type="luckystar"[^>]*>(\d+)<\/bonus-ball>/g)]
    .map((m) => parseInt(m[1], 10))
    .filter((n) => n >= 1 && n <= 12);

  if (numbers.length !== 5 || stars.length !== 2) return null;

  const drawNumber = parseInt(xml.match(/<draw-number>(\d+)<\/draw-number>/)?.[1] || '0', 10) || null;
  const ukTier1 = xml.match(/<prize-tiers country="UK">[\s\S]*?<prize-tier level="1">[\s\S]*?<number-of-winners>(\d+)<\/number-of-winners>[\s\S]*?<win-value>([\d.]+)<\/win-value>/);
  const winners = ukTier1 ? parseInt(ukTier1[1], 10) : 0;
  const winValue = ukTier1 ? Math.round(parseFloat(ukTier1[2])) : 0;
  const jackpotRaw = xml.match(/<jackpot-amount>([^<]+)<\/jackpot-amount>/)?.[1]?.replace(/,/g, '') || '0';
  const jackpot = Math.round(parseFloat(jackpotRaw) || 0);
  const hasWinner = winners > 0;

  const date = new Date(`${dateIso}T00:00:00Z`);

  return {
    date: dateIso,
    dateDisplay: formatDisplay(date),
    year: date.getUTCFullYear(),
    numbers,
    stars,
    drawNumber,
    category1: {
      hasWinner,
      winners,
      prize: hasWinner ? winValue : 0,
      jackpot: jackpot || winValue,
      currency: 'GBP',
    },
  };
}

function buildStats(draws) {
  const numberFrequency = {};
  const starFrequency = {};

  for (let n = 1; n <= 50; n++) numberFrequency[n] = 0;
  for (let n = 1; n <= 12; n++) starFrequency[n] = 0;

  for (const draw of draws) {
    for (const num of draw.numbers) numberFrequency[num]++;
    for (const star of draw.stars) starFrequency[star]++;
  }

  const sortedByFrequency = Object.entries(numberFrequency)
    .map(([num, count]) => ({ number: parseInt(num, 10), count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalDraws: draws.length,
    numberFrequency,
    starFrequency,
    mostFrequent: sortedByFrequency.slice(0, 10),
    leastFrequent: [...sortedByFrequency].reverse().slice(0, 10),
    winnersCount: draws.filter((d) => d.category1.hasWinner).length,
    reportsCount: draws.filter((d) => !d.category1.hasWinner).length,
  };
}

function loadExistingDraws() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return data.draws || [];
  } catch {
    return [];
  }
}

function saveData(draws, source) {
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - YEARS_BACK;
  const years = [];
  for (let y = startYear; y <= currentYear; y++) years.push(y);

  const filtered = draws.filter((d) => d.year >= startYear && d.year <= currentYear);
  const unique = new Map();
  for (const draw of filtered) unique.set(draw.date, draw);
  const sorted = [...unique.values()].sort((a, b) => b.date.localeCompare(a.date));

  const data = {
    lastUpdated: new Date().toISOString(),
    source,
    game: 'EuroMillions UK',
    years,
    stats: buildStats(sorted),
    draws: sorted,
  };

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

async function fetchWithTimeout(url, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: FETCH_HEADERS,
      signal: controller.signal,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAllDrawsFromApi() {
  let lastError = null;

  for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
    try {
      const response = await fetchWithTimeout(API_URL);
      if (response.status === 429) throw new Error('Rate limit 429');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (err) {
      lastError = err;
      console.warn(`[euromillions] API încercare ${i + 1}/${RETRY_DELAYS_MS.length}: ${err.message}`);
      if (i < RETRY_DELAYS_MS.length - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]));
      }
    }
  }

  throw lastError || new Error('API indisponibil');
}

async function fetchUkLatestDraw() {
  const response = await fetchWithTimeout(UK_LATEST_URL);
  if (!response.ok) throw new Error(`UK lottery HTTP ${response.status}`);
  const xml = await response.text();
  const draw = parseUkLatestDraw(xml);
  if (!draw) throw new Error('Nu s-a putut parsa extragerea UK');
  return draw;
}

function mergeDraws(existing, incoming) {
  const map = new Map(existing.map((d) => [d.date, d]));
  for (const draw of incoming) map.set(draw.date, draw);
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

async function scrape() {
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - YEARS_BACK;

  console.log(`[euromillions] Preluare extrageri (${startYear}–${currentYear})...`);

  try {
    const rows = await fetchAllDrawsFromApi();
    const allDraws = rows.map(parseDraw).filter(Boolean);
    const data = saveData(allDraws, API_URL);
    console.log(`[euromillions] Salvat din API: ${data.draws.length} extrageri`);
    return data;
  } catch (apiErr) {
    console.warn(`[euromillions] API principal eșuat (${apiErr.message}) — fallback UK Lottery`);

    const existing = loadExistingDraws();
    if (!existing.length) {
      throw new Error(`EuroMillions API eșuat și nu există arhivă locală: ${apiErr.message}`);
    }

    const latest = await fetchUkLatestDraw();
    const merged = mergeDraws(existing, [latest]);
    const data = saveData(merged, `${UK_LATEST_URL} (fallback)`);
    console.log(`[euromillions] Actualizat prin fallback UK: ${data.draws.length} extrageri (ultima: ${latest.date})`);
    return data;
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  scrape().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { scrape, buildStats, parseDraw, parseUkLatestDraw, fetchUkLatestDraw };
