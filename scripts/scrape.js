import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'draws.json');
const SOURCE_URL = 'http://noroc-chior.ro/Loto/6-din-49/arhiva-rezultate.php';

const MONTHS = {
  ianuarie: 1, februarie: 2, martie: 3, aprilie: 4,
  mai: 5, iunie: 6, iulie: 7, august: 8,
  septembrie: 9, octombrie: 10, noiembrie: 11, decembrie: 12,
};

const YEARS_BACK = 10;

function parseRomanianDate(text) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const match = cleaned.match(/^[A-Za-z]{2},\s*(\d{1,2})\s+(\w+)\s+(\d{4})$/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = MONTHS[match[2].toLowerCase()];
  const year = parseInt(match[3], 10);

  if (!month) return null;

  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { iso, display: cleaned, year };
}

function parsePrize(value) {
  if (!value || value === 'REPORT') return 0;
  const normalized = value.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(normalized);
  return Number.isFinite(num) ? num : 0;
}

function parseYear(html, year) {
  const $ = cheerio.load(html);
  const draws = [];

  $('tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 10) return;

    const dateText = $(cells[0]).text().trim();
    if (!/^\w{2},\s*\d/.test(dateText)) return;

    const parsed = parseRomanianDate(dateText);
    if (!parsed || parsed.year !== year) return;

    const numbers = [];
    for (let i = 1; i <= 6; i++) {
      const num = parseInt($(cells[i]).text().trim(), 10);
      if (num >= 1 && num <= 49) numbers.push(num);
    }
    if (numbers.length !== 6) return;

    const cat1Text = $(cells[7]).text().trim();
    const hasWinner = cat1Text !== 'REPORT' && /^\d+$/.test(cat1Text);
    const winners = hasWinner ? parseInt(cat1Text, 10) : 0;
    const prize = parsePrize($(cells[8]).text().trim());
    const jackpot = parsePrize($(cells[9]).text().trim());

    draws.push({
      date: parsed.iso,
      dateDisplay: parsed.display,
      year: parsed.year,
      numbers,
      category1: {
        hasWinner,
        winners,
        prize,
        jackpot,
      },
    });
  });

  return draws;
}

function buildStats(draws) {
  const numberFrequency = {};
  const allNumbers = [];

  for (let n = 1; n <= 49; n++) numberFrequency[n] = 0;

  for (const draw of draws) {
    for (const num of draw.numbers) {
      numberFrequency[num]++;
      allNumbers.push(num);
    }
  }

  const sortedByFrequency = Object.entries(numberFrequency)
    .map(([num, count]) => ({ number: parseInt(num, 10), count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalDraws: draws.length,
    totalNumbersDrawn: allNumbers.length,
    numberFrequency,
    allNumbers,
    mostFrequent: sortedByFrequency.slice(0, 10),
    leastFrequent: [...sortedByFrequency].reverse().slice(0, 10),
    winnersCount: draws.filter((d) => d.category1.hasWinner).length,
    reportsCount: draws.filter((d) => !d.category1.hasWinner).length,
  };
}

async function fetchYear(year) {
  const url = `${SOURCE_URL}?Y=${year}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Eroare la ${url}: ${response.status}`);
  return response.text();
}

async function scrape() {
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - YEARS_BACK;
  const years = [];

  for (let y = startYear; y <= currentYear; y++) years.push(y);

  console.log(`Scraping ani ${startYear}–${currentYear}...`);

  const allDraws = [];

  for (const year of years) {
    process.stdout.write(`  ${year}... `);
    try {
      const html = await fetchYear(year);
      const draws = parseYear(html, year);
      allDraws.push(...draws);
      console.log(`${draws.length} extrageri`);
    } catch (err) {
      console.log(`EROARE: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  allDraws.sort((a, b) => b.date.localeCompare(a.date));

  const data = {
    lastUpdated: new Date().toISOString(),
    source: SOURCE_URL,
    years,
    stats: buildStats(allDraws),
    draws: allDraws,
  };

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');

  console.log(`\nSalvat: ${allDraws.length} extrageri în ${DATA_FILE}`);
  return data;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  scrape().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { scrape, parseYear, buildStats };
