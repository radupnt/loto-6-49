const BNR_URL = 'https://www.bnr.ro/nbrfxrates.xml';
const CACHE_MS = 12 * 60 * 60 * 1000;

let cache = { rate: null, date: null, fetchedAt: 0 };

function parseEurRate(xml) {
  const dateMatch = xml.match(/<Cube date="([^"]+)"/);
  const rateMatch = xml.match(/<Rate currency="EUR">([\d.]+)<\/Rate>/);
  if (!rateMatch) throw new Error('Curs EUR negăsit în XML BNR');
  return {
    eurRon: parseFloat(rateMatch[1]),
    publishingDate: dateMatch?.[1] || null,
    source: 'BNR',
  };
}

async function getEurRate() {
  if (cache.rate && Date.now() - cache.fetchedAt < CACHE_MS) {
    return cache;
  }

  const response = await fetch(BNR_URL);
  if (!response.ok) throw new Error(`BNR indisponibil: ${response.status}`);

  const xml = await response.text();
  const parsed = parseEurRate(xml);

  cache = {
    rate: parsed.eurRon,
    date: parsed.publishingDate,
    source: parsed.source,
    fetchedAt: Date.now(),
  };

  return cache;
}

function ronToEur(ron, rate) {
  if (!ron || !rate) return 0;
  return ron / rate;
}

export { getEurRate, ronToEur };
