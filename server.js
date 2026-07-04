import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scrape } from './scripts/scrape.js';
import { scrape as scrapeEuromillions } from './scripts/scrape-euromillions.js';
import {
  getGeneratorState,
  manualGenerate,
  startGeneratorSchedule,
  getVariantMatchMap,
  getMatchResults,
  autoGenerateIfNeeded,
} from './scripts/generator.js';
import {
  getGeneratorState as getEuromillionsState,
  manualGenerate as manualEuromillionsGenerate,
  startGeneratorSchedule as startEuromillionsSchedule,
  getVariantMatchMap as getEuromillionsMatchMap,
  getMatchResults as getEuromillionsMatchResults,
  autoGenerateIfNeeded as autoEuromillionsGenerate,
} from './scripts/generator-euromillions.js';
import { getEurRate } from './scripts/bnr.js';
import { startPostDrawScheduler } from './scripts/scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data', 'draws.json');
const EM_DATA_FILE = path.join(__dirname, 'data', 'euromillions-draws.json');
const DATA_DIR = path.join(__dirname, 'data');
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const REFRESH_HOURS = parseInt(process.env.AUTO_REFRESH_HOURS || '3', 10);
const REFRESH_INTERVAL_MS = REFRESH_HOURS * 60 * 60 * 1000;
const CRON_SECRET = process.env.CRON_SECRET || '';
const IS_PROD = process.env.NODE_ENV === 'production';

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let isRefreshing = false;
let lastRefreshAttempt = null;
let nextScheduledRefresh = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return null;
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function isDataStale() {
  const data = loadData();
  if (!data?.lastUpdated) return true;
  const age = Date.now() - new Date(data.lastUpdated).getTime();
  return age >= REFRESH_INTERVAL_MS;
}

function loadEmData() {
  if (!fs.existsSync(EM_DATA_FILE)) return null;
  return JSON.parse(fs.readFileSync(EM_DATA_FILE, 'utf8'));
}

function isEmDataStale() {
  const data = loadEmData();
  if (!data?.lastUpdated) return true;
  const age = Date.now() - new Date(data.lastUpdated).getTime();
  return age >= REFRESH_INTERVAL_MS;
}

async function autoRefresh(reason) {
  if (isRefreshing) return null;
  isRefreshing = true;
  lastRefreshAttempt = new Date().toISOString();

  try {
    console.log(`[auto-refresh] ${reason}...`);
    const [data, emData] = await Promise.all([
      scrape().catch((err) => {
        console.error(`[auto-refresh] Loto: ${err.message}`);
        return loadData();
      }),
      scrapeEuromillions().catch((err) => {
        console.error(`[auto-refresh] EuroMillions: ${err.message}`);
        return loadEmData();
      }),
    ]);
    console.log(`[auto-refresh] Gata — Loto: ${data?.draws?.length || 0}, EuroMillions: ${emData?.draws?.length || 0}`);
    autoGenerateIfNeeded();
    autoEuromillionsGenerate();
    return data;
  } catch (err) {
    console.error(`[auto-refresh] Eroare: ${err.message}`);
    return null;
  } finally {
    isRefreshing = false;
    scheduleNextRefresh();
  }
}

function scheduleNextRefresh() {
  nextScheduledRefresh = new Date(Date.now() + REFRESH_INTERVAL_MS).toISOString();
}

function startAutoRefresh() {
  scheduleNextRefresh();
  setInterval(() => autoRefresh('programat'), REFRESH_INTERVAL_MS);
}

app.get('/api/health', (req, res) => {
  const data = loadData();
  const emData = loadEmData();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    hasData: !!data,
    draws: data?.draws?.length || 0,
    euromillionsDraws: emData?.draws?.length || 0,
    lastUpdated: data?.lastUpdated || null,
    euromillionsLastUpdated: emData?.lastUpdated || null,
    env: IS_PROD ? 'production' : 'development',
  });
});

app.get('/api/cron', async (req, res) => {
  if (!CRON_SECRET || req.query.secret !== CRON_SECRET) {
    return res.status(403).json({ error: 'Acces interzis' });
  }
  try {
    const data = await autoRefresh('cron extern');
    autoGenerateIfNeeded();
    autoEuromillionsGenerate();
    res.json({
      success: true,
      count: data?.draws?.length || 0,
      euromillionsCount: loadEmData()?.draws?.length || 0,
      lastUpdated: data?.lastUpdated || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/draws', (req, res) => {
  const data = loadData();
  if (!data) return res.status(404).json({ error: 'Nu există date. Se vor prelua automat.' });

  const year = req.query.year ? parseInt(req.query.year, 10) : null;
  let draws = data.draws;
  if (year) draws = draws.filter((d) => d.year === year);

  res.json({
    lastUpdated: data.lastUpdated,
    year: year || 'all',
    count: draws.length,
    draws,
  });
});

app.get('/api/stats', (req, res) => {
  const data = loadData();
  if (!data) return res.status(404).json({ error: 'Nu există date.' });

  res.json({
    lastUpdated: data.lastUpdated,
    years: data.years,
    stats: data.stats,
  });
});

app.get('/api/years', (req, res) => {
  const data = loadData();
  if (!data) return res.status(404).json({ error: 'Nu există date.' });

  const byYear = {};
  for (const draw of data.draws) {
    byYear[draw.year] = (byYear[draw.year] || 0) + 1;
  }

  res.json({
    years: data.years.map((y) => ({ year: y, draws: byYear[y] || 0 })),
  });
});

app.get('/api/status', (req, res) => {
  const data = loadData();
  res.json({
    lastUpdated: data?.lastUpdated || null,
    isRefreshing,
    lastRefreshAttempt,
    nextScheduledRefresh,
    refreshIntervalHours: REFRESH_HOURS,
    hasData: !!data,
  });
});

app.post('/api/refresh', async (req, res) => {
  if (isRefreshing) {
    return res.status(409).json({ error: 'Actualizare deja în curs' });
  }
  try {
    const data = await autoRefresh('manual');
    if (!data) throw new Error('Actualizare eșuată');
    res.json({ success: true, count: data.draws.length, lastUpdated: data.lastUpdated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/exchange-rate', async (req, res) => {
  try {
    const data = await getEurRate();
    res.json({ rate: data.rate, date: data.date, source: data.source });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/generator/matches', (req, res) => {
  try {
    res.json({ matches: getVariantMatchMap(), results: getMatchResults() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/generator', (req, res) => {
  try {
    const state = getGeneratorState();
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/generator/generate', (req, res) => {
  try {
    const { drawKey } = req.body || {};
    const result = manualGenerate(drawKey || null);
    res.json({
      success: true,
      draw: result.draw,
      variant: result.variant,
      entry: result.entry,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/euromillions/draws', (req, res) => {
  const data = loadEmData();
  if (!data) return res.status(404).json({ error: 'Nu există date EuroMillions. Se vor prelua automat.' });

  const year = req.query.year ? parseInt(req.query.year, 10) : null;
  let draws = data.draws;
  if (year) draws = draws.filter((d) => d.year === year);

  res.json({
    lastUpdated: data.lastUpdated,
    year: year || 'all',
    count: draws.length,
    draws,
  });
});

app.get('/api/euromillions/stats', (req, res) => {
  const data = loadEmData();
  if (!data) return res.status(404).json({ error: 'Nu există date EuroMillions.' });

  res.json({
    lastUpdated: data.lastUpdated,
    years: data.years,
    stats: data.stats,
  });
});

app.get('/api/euromillions/years', (req, res) => {
  const data = loadEmData();
  if (!data) return res.status(404).json({ error: 'Nu există date EuroMillions.' });

  const byYear = {};
  for (const draw of data.draws) {
    byYear[draw.year] = (byYear[draw.year] || 0) + 1;
  }

  res.json({
    years: data.years.map((y) => ({ year: y, draws: byYear[y] || 0 })),
  });
});

app.get('/api/euromillions/status', (req, res) => {
  const data = loadEmData();
  res.json({
    lastUpdated: data?.lastUpdated || null,
    isRefreshing,
    lastRefreshAttempt,
    nextScheduledRefresh,
    refreshIntervalHours: REFRESH_HOURS,
    hasData: !!data,
  });
});

app.get('/api/euromillions/generator/matches', (req, res) => {
  try {
    res.json({ matches: getEuromillionsMatchMap(), results: getEuromillionsMatchResults() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/euromillions/generator', (req, res) => {
  try {
    res.json(getEuromillionsState());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/euromillions/generator/generate', (req, res) => {
  try {
    const { drawKey } = req.body || {};
    const result = manualEuromillionsGenerate(drawKey || null);
    res.json({
      success: true,
      draw: result.draw,
      variant: result.variant,
      entry: result.entry,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const file = path.join(__dirname, 'public', req.path === '/' ? 'index.html' : req.path);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

ensureDataDir();

const server = app.listen(PORT, HOST, async () => {
  console.log(`Loto 6/49 — ${IS_PROD ? 'PRODUCTION' : 'development'}`);
  console.log(`Listening on ${HOST}:${PORT}`);
  console.log(`Actualizare automată la fiecare ${REFRESH_HOURS} ore`);

  startAutoRefresh();
  startGeneratorSchedule();
  startEuromillionsSchedule();
  startPostDrawScheduler((reason) => autoRefresh(reason));

  if (!fs.existsSync(DATA_FILE) || !fs.existsSync(EM_DATA_FILE)) {
    await autoRefresh('date lipsă la pornire');
  } else if (isDataStale() || isEmDataStale()) {
    autoRefresh('date expirate la pornire');
  } else {
    autoGenerateIfNeeded();
    autoEuromillionsGenerate();
  }
});

process.on('SIGTERM', () => {
  console.log('SIGTERM — oprire server');
  server.close(() => process.exit(0));
});
