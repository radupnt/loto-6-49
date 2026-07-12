const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=GBP&to=EUR';
const CACHE_MS = 12 * 60 * 60 * 1000;

let gbpCache = { rate: null, date: null, fetchedAt: 0 };

async function getGbpEurRate() {
  if (gbpCache.rate && Date.now() - gbpCache.fetchedAt < CACHE_MS) {
    return gbpCache;
  }

  const response = await fetch(FRANKFURTER_URL);
  if (!response.ok) throw new Error(`Curs GBP/EUR indisponibil: ${response.status}`);

  const data = await response.json();
  const rate = data.rates?.EUR;
  if (!rate) throw new Error('Curs GBP/EUR negăsit');

  gbpCache = {
    rate,
    date: data.date || null,
    source: 'Frankfurter (ECB)',
    fetchedAt: Date.now(),
  };

  return gbpCache;
}

function gbpToEur(gbp, rate) {
  if (!gbp || !rate) return 0;
  return gbp * rate;
}

function eurToGbp(eur, rate) {
  if (!eur || !rate) return 0;
  return eur / rate;
}

export { getGbpEurRate, gbpToEur, eurToGbp };
