import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'euromillions-draws.json');
const API_URL = 'https://euromillions.api.pedromealha.dev/draws';
const YEARS_BACK = 10;

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

async function fetchAllDraws() {
  const response = await fetch(API_URL);
  if (!response.ok) throw new Error(`Eroare la ${API_URL}: ${response.status}`);
  return response.json();
}

async function scrape() {
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - YEARS_BACK;
  const years = [];

  for (let y = startYear; y <= currentYear; y++) years.push(y);

  console.log(`[euromillions] Preluare toate extragerile (${startYear}–${currentYear})...`);

  const rows = await fetchAllDraws();
  const allDraws = rows
    .map(parseDraw)
    .filter(Boolean)
    .filter((d) => d.year >= startYear && d.year <= currentYear);

  const unique = new Map();
  for (const draw of allDraws) unique.set(draw.date, draw);
  const draws = [...unique.values()].sort((a, b) => b.date.localeCompare(a.date));

  const data = {
    lastUpdated: new Date().toISOString(),
    source: API_URL,
    game: 'EuroMillions UK',
    years,
    stats: buildStats(draws),
    draws,
  };

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');

  console.log(`[euromillions] Salvat: ${draws.length} extrageri în ${DATA_FILE}`);
  return data;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  scrape().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { scrape, buildStats, parseDraw };
