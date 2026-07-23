import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'generation-history.json');
const LOTO_DRAWS_FILE = path.join(DATA_DIR, 'draws.json');
const EM_DRAWS_FILE = path.join(DATA_DIR, 'euromillions-draws.json');

const HISTORY_PATH_IN_REPO = 'data/generation-history.json';
const GITHUB_TOKEN = process.env.HISTORY_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.HISTORY_GITHUB_REPO || 'radupnt/loto-6-49';
const GITHUB_BRANCH = process.env.HISTORY_GITHUB_BRANCH || 'main';

const geoCache = new Map();
const GEO_TTL_MS = 6 * 60 * 60 * 1000;

function emptyStore() {
  return { entries: [], updatedAt: null };
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return emptyStore();
  try {
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    if (!Array.isArray(data.entries)) return emptyStore();
    return {
      entries: data.entries,
      updatedAt: data.updatedAt || null,
    };
  } catch {
    return emptyStore();
  }
}

function saveHistory(store) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const payload = {
    updatedAt: new Date().toISOString(),
    entries: store.entries,
  };
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function extractClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return String(forwarded[0]).split(',')[0].trim();
  }
  const ip = req.ip || req.socket?.remoteAddress || '';
  return String(ip).replace(/^::ffff:/, '');
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('127.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  return false;
}

function normalizeCountry(countryCode, country) {
  const code = (countryCode || 'XX').toUpperCase();
  if (code === 'RO' || /^romania$/i.test(country || '')) {
    return { countryCode: 'RO', country: 'România' };
  }
  return {
    countryCode: code,
    country: country || 'Necunoscută',
  };
}

async function fetchPublicIp() {
  try {
    const res = await fetch('https://api.ipify.org?format=json', {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`ipify HTTP ${res.status}`);
    const data = await res.json();
    return data.ip || null;
  } catch (err) {
    console.warn(`[history] public IP lookup failed: ${err.message}`);
    return null;
  }
}

async function geoFromIpApi(ip) {
  const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,message`;
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`geo HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== 'success') throw new Error(data.message || 'geo failed');
  return normalizeCountry(data.countryCode, data.country);
}

async function lookupCountry(ip) {
  let lookupIp = ip;

  // Pe localhost / rețea privată, IP-ul clientului nu e geolocalizabil —
  // folosim IP-ul public al conexiunii (același egress ca utilizatorul).
  if (!lookupIp || isPrivateIp(lookupIp)) {
    lookupIp = await fetchPublicIp();
  }

  if (!lookupIp || isPrivateIp(lookupIp)) {
    return { countryCode: 'RO', country: 'România' };
  }

  const cached = geoCache.get(lookupIp);
  if (cached && Date.now() - cached.at < GEO_TTL_MS) {
    return { countryCode: cached.countryCode, country: cached.country };
  }

  try {
    const result = await geoFromIpApi(lookupIp);
    geoCache.set(lookupIp, { ...result, at: Date.now() });
    return result;
  } catch (err) {
    console.warn(`[history] geo lookup failed for ${lookupIp}: ${err.message}`);
    return { countryCode: 'XX', country: 'Necunoscută' };
  }
}

async function syncHistoryToGitHub(content) {
  if (!GITHUB_TOKEN) return { skipped: true };

  const apiBase = `https://api.github.com/repos/${GITHUB_REPO}/contents/${HISTORY_PATH_IN_REPO}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    'User-Agent': 'LotoHub-HistorySync',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  let sha;
  try {
    const getRes = await fetch(`${apiBase}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, { headers });
    if (getRes.ok) {
      const existing = await getRes.json();
      sha = existing.sha;
    } else if (getRes.status !== 404) {
      const text = await getRes.text();
      throw new Error(`GitHub GET ${getRes.status}: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    throw new Error(`GitHub read: ${err.message}`);
  }

  const body = {
    message: `chore: update generation history (${new Date().toISOString()})`,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;

  const putRes = await fetch(apiBase, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!putRes.ok) {
    const text = await putRes.text();
    throw new Error(`GitHub PUT ${putRes.status}: ${text.slice(0, 200)}`);
  }

  return { ok: true };
}

function publicEntry(entry) {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    game: entry.game,
    drawKey: entry.drawKey,
    drawDisplay: entry.drawDisplay,
    numbers: entry.numbers,
    stars: entry.stars || null,
    countryCode: entry.countryCode,
    country: entry.country,
  };
}

async function appendHistoryEntry({ req, game, drawKey, drawDisplay, numbers, stars = null }) {
  const ip = extractClientIp(req);
  const geo = await lookupCountry(ip);

  const entry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    game,
    drawKey,
    drawDisplay,
    numbers: [...numbers],
    stars: stars ? [...stars] : null,
    countryCode: geo.countryCode,
    country: geo.country,
  };

  const store = loadHistory();
  store.entries.unshift(entry);
  // Cap local growth
  if (store.entries.length > 5000) store.entries = store.entries.slice(0, 5000);
  const saved = saveHistory(store);

  setImmediate(() => {
    syncHistoryToGitHub(JSON.stringify(saved, null, 2) + '\n').catch((err) => {
      console.warn(`[history] GitHub sync failed: ${err.message}`);
    });
  });

  return publicEntry(entry);
}

function loadDrawMap(filePath) {
  if (!fs.existsSync(filePath)) return new Map();
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const map = new Map();
    for (const draw of data.draws || []) {
      map.set(draw.date, draw);
    }
    return map;
  } catch {
    return new Map();
  }
}

function enrichWithMatches(entry) {
  const base = publicEntry(entry);
  const lotoMap = enrichWithMatches._lotoMap || (enrichWithMatches._lotoMap = loadDrawMap(LOTO_DRAWS_FILE));
  const emMap = enrichWithMatches._emMap || (enrichWithMatches._emMap = loadDrawMap(EM_DRAWS_FILE));

  if (entry.game === 'euromillions') {
    const actual = emMap.get(entry.drawKey);
    if (!actual) {
      return { ...base, hitNumbers: [], hitStars: [], hitCount: 0, hasResult: false };
    }
    const hitNumbers = (entry.numbers || []).filter((n) => actual.numbers?.includes(n));
    const hitStars = (entry.stars || []).filter((s) => actual.stars?.includes(s));
    return {
      ...base,
      hitNumbers,
      hitStars,
      hitCount: hitNumbers.length + hitStars.length,
      hasResult: true,
      actualNumbers: actual.numbers,
      actualStars: actual.stars || [],
    };
  }

  const actual = lotoMap.get(entry.drawKey);
  if (!actual) {
    return { ...base, hitNumbers: [], hitStars: [], hitCount: 0, hasResult: false };
  }
  const hitNumbers = (entry.numbers || []).filter((n) => actual.numbers?.includes(n));
  return {
    ...base,
    hitNumbers,
    hitStars: [],
    hitCount: hitNumbers.length,
    hasResult: true,
    actualNumbers: actual.numbers,
  };
}

function getHistoryWithMatches() {
  // Refresh draw maps each request so new scrapes apply
  enrichWithMatches._lotoMap = loadDrawMap(LOTO_DRAWS_FILE);
  enrichWithMatches._emMap = loadDrawMap(EM_DRAWS_FILE);

  const store = loadHistory();
  const entries = [...store.entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    updatedAt: store.updatedAt,
    count: entries.length,
    entries: entries.map(enrichWithMatches),
  };
}

export {
  appendHistoryEntry,
  getHistoryWithMatches,
  loadHistory,
  extractClientIp,
};
