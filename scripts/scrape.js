import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'draws.json');

const ARCHIVE_URL = 'https://www.loto49.ro/arhiva-loto49.php';
const OFFICIAL_URL =
  'https://www.loto.ro/loto-new/newLotoSiteNexioFinalVersion/web/app2.php/jocuri/649_si_noroc/rezultate_extragere.html';
const LEGACY_URL = 'http://noroc-chior.ro/Loto/6-din-49/arhiva-rezultate.php';

const MONTHS = {
  ianuarie: 1, februarie: 2, martie: 3, aprilie: 4,
  mai: 5, iunie: 6, iulie: 7, august: 8,
  septembrie: 9, octombrie: 10, noiembrie: 11, decembrie: 12,
};

const MONTH_NAMES = [
  '', 'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
  'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie',
];

const WEEKDAY_SHORT = ['Du', 'Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sâ'];
const YEARS_BACK = 10;
const UA = 'Mozilla/5.0 (compatible; LotoHub/1.0)';

function parsePrize(value) {
  if (!value || value === '-' || value === 'REPORT') return 0;
  const normalized = value.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(normalized);
  return Number.isFinite(num) ? num : 0;
}

function formatDateDisplay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = WEEKDAY_SHORT[date.getUTCDay()];
  return `${weekday}, ${d} ${MONTH_NAMES[m]} ${y}`;
}

function parseRomanianDate(text) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const match = cleaned.match(/^[A-Za-zĂÂÎȘȚăâîșț]{2},\s*(\d{1,2})\s+(\w+)\s+(\d{4})$/i);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = MONTHS[match[2].toLowerCase()];
  const year = parseInt(match[3], 10);
  if (!month) return null;

  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { iso, display: cleaned, year };
}

function emptyCategory1() {
  return { hasWinner: false, winners: 0, prize: 0, jackpot: 0 };
}

function parseCategory1(winnersText, prizeText, jackpotText) {
  const hasWinner = winnersText !== 'REPORT' && /^\d+$/.test(winnersText);
  return {
    hasWinner,
    winners: hasWinner ? parseInt(winnersText, 10) : 0,
    prize: parsePrize(prizeText),
    jackpot: parsePrize(jackpotText),
  };
}

function makeDraw(iso, numbers, category1 = emptyCategory1(), dateDisplay = null) {
  const year = parseInt(iso.slice(0, 4), 10);
  return {
    date: iso,
    dateDisplay: dateDisplay || formatDateDisplay(iso),
    year,
    numbers,
    category1,
  };
}

function parseYearLegacy(html, year) {
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
    draws.push(makeDraw(
      parsed.iso,
      numbers,
      parseCategory1(cat1Text, $(cells[8]).text().trim(), $(cells[9]).text().trim()),
      parsed.display,
    ));
  });

  return draws;
}

function parseArchiveTable(html) {
  const $ = cheerio.load(html);
  const draws = [];

  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 7) return;

    const date = $(cells[0]).text().trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

    const numbers = [];
    for (let i = 1; i <= 6; i++) {
      const num = parseInt($(cells[i]).text().trim(), 10);
      if (num >= 1 && num <= 49) numbers.push(num);
    }
    if (numbers.length !== 6) return;

    draws.push(makeDraw(date, numbers));
  });

  return draws;
}

function parseOfficialPage(html) {
  const $ = cheerio.load(html);
  const draws = [];

  $('.rezultate-extrageri-content.resultDiv').each((_, el) => {
    const title = $(el).find('.button-open-details p').first().text();
    if (!/6\/49/.test(title)) return;

    const dateMatch = title.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!dateMatch) return;
    const date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;

    const numbers = [];
    $(el).find('.numere-extrase img').each((__, img) => {
      const src = $(img).attr('src') || '';
      const m = src.match(/bile\/(\d+)\.png/i);
      if (m) {
        const num = parseInt(m[1], 10);
        if (num >= 1 && num <= 49) numbers.push(num);
      }
    });
    if (numbers.length !== 6) return;

    const cat1Row = $(el).find('table.results-table tbody tr').first();
    const winnersText = cat1Row.find('td').eq(1).text().trim();
    const prizeText = cat1Row.find('td').eq(2).text().trim();
    const jackpotText = cat1Row.find('td').eq(3).text().trim();

    draws.push(makeDraw(date, numbers, parseCategory1(winnersText, prizeText, jackpotText)));
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

function loadExisting() {
  if (!fs.existsSync(DATA_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
  });
  if (!response.ok) throw new Error(`Eroare la ${url}: ${response.status}`);
  return response.text();
}

async function scrapeLegacyYears(years) {
  const all = [];
  for (const year of years) {
    process.stdout.write(`  legacy ${year}... `);
    try {
      const html = await fetchText(`${LEGACY_URL}?Y=${year}`);
      const draws = parseYearLegacy(html, year);
      all.push(...draws);
      console.log(`${draws.length} extrageri`);
    } catch (err) {
      console.log(`EROARE: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return all;
}

function mergeDraws(...lists) {
  const byDate = new Map();

  for (const list of lists) {
    for (const draw of list) {
      if (!draw?.date || !Array.isArray(draw.numbers) || draw.numbers.length !== 6) continue;
      const prev = byDate.get(draw.date);
      if (!prev) {
        byDate.set(draw.date, { ...draw, category1: { ...emptyCategory1(), ...draw.category1 } });
        continue;
      }

      const nextCat = draw.category1 || emptyCategory1();
      const prevCat = prev.category1 || emptyCategory1();
      const preferNewPrize = nextCat.prize > 0 || nextCat.jackpot > 0 || nextCat.hasWinner;

      byDate.set(draw.date, {
        ...prev,
        ...draw,
        numbers: draw.numbers,
        category1: preferNewPrize ? nextCat : prevCat,
        dateDisplay: draw.dateDisplay || prev.dateDisplay || formatDateDisplay(draw.date),
      });
    }
  }

  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

async function scrape() {
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - YEARS_BACK;
  const years = [];
  for (let y = startYear; y <= currentYear; y++) years.push(y);

  console.log(`Scraping Loto 6/49 (${startYear}–${currentYear})...`);

  const existing = loadExisting();
  const existingDraws = existing?.draws || [];
  const scraped = [];
  const sources = [];

  try {
    process.stdout.write('  loto49.ro arhivă... ');
    const archiveHtml = await fetchText(ARCHIVE_URL);
    const archiveDraws = parseArchiveTable(archiveHtml);
    scraped.push(...archiveDraws);
    sources.push(ARCHIVE_URL);
    console.log(`${archiveDraws.length} extrageri`);
  } catch (err) {
    console.log(`EROARE: ${err.message}`);
  }

  try {
    process.stdout.write('  loto.ro oficial... ');
    const officialHtml = await fetchText(OFFICIAL_URL);
    const officialDraws = parseOfficialPage(officialHtml);
    scraped.push(...officialDraws);
    sources.push(OFFICIAL_URL);
    console.log(`${officialDraws.length} extrageri (cu premii)`);
  } catch (err) {
    console.log(`EROARE: ${err.message}`);
  }

  // Fallback istoric: încearcă vechiul site doar dacă nu avem deloc date locale
  if (existingDraws.length === 0 && scraped.length === 0) {
    console.log('  Fallback noroc-chior.ro (fără date locale)...');
    const legacy = await scrapeLegacyYears(years);
    scraped.push(...legacy);
    if (legacy.length) sources.push(LEGACY_URL);
  }

  const allDraws = mergeDraws(existingDraws, scraped);

  if (allDraws.length === 0) {
    console.warn('Nicio extragere obținută — păstrez fișierul existent.');
    return existing || {
      lastUpdated: new Date().toISOString(),
      source: sources.join(' | ') || ARCHIVE_URL,
      years,
      stats: buildStats([]),
      draws: [],
    };
  }

  if (existingDraws.length > 0 && allDraws.length < Math.floor(existingDraws.length * 0.5)) {
    console.warn(
      `Scrape suspect (${allDraws.length} vs ${existingDraws.length} existente) — păstrez datele vechi.`,
    );
    return existing;
  }

  const data = {
    lastUpdated: new Date().toISOString(),
    source: sources.join(' | ') || existing?.source || ARCHIVE_URL,
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

export { scrape, parseYearLegacy as parseYear, buildStats };
