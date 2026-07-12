const POLL_INTERVAL_MS = 2 * 60 * 1000;

const ALGO_FACTORS = [
  { key: 'frequency', label: 'Frecvență istorică', desc: 'Proximitate de media așteptată per număr principal' },
  { key: 'recency', label: 'Frecvență recentă', desc: 'Numere active în ultimele 100 extrageri' },
  { key: 'gap', label: 'Gap temporal', desc: 'Zile de la ultima apariție, normalizat' },
  { key: 'pairSynergy', label: 'Perechi istorice', desc: 'Co-apariții frecvente între numere principale' },
  { key: 'recentPairs', label: 'Perechi recente', desc: 'Co-apariții din ultimele 50 extrageri' },
  { key: 'oddEven', label: 'Par / Impar', desc: 'Distribuție echilibrată 2+3 sau 3+2' },
  { key: 'sumRange', label: 'Suma numerelor', desc: 'Gaussian centrat pe media istorică' },
  { key: 'spread', label: 'Distribuție spațială', desc: 'Distanța optimă între numere consecutive' },
  { key: 'decadeSpread', label: 'Decade', desc: 'Acoperire pe intervale de zeci (1–10, 11–20...)' },
  { key: 'consecutive', label: 'Consecutive', desc: 'Penalizare numere consecutive' },
];

const STAR_ALGO_FACTORS = [
  { key: 'frequency', label: 'Stele — frecvență', desc: 'Proximitate de media așteptată per Lucky Star' },
  { key: 'gap', label: 'Stele — gap', desc: 'Zile de la ultima apariție a fiecărei stele' },
  { key: 'oddEven', label: 'Stele — par/impar', desc: 'Preferință 1 impar + 1 par' },
  { key: 'pairSynergy', label: 'Perechi de stele', desc: 'Co-apariții istorice între perechi de stele' },
];

const state = {
  nextDraw: null,
  years: [],
  currentYear: null,
  stats: null,
  lastUpdated: null,
  gbpEurRate: null,
  variantMap: {},
};

const $ = (sel) => document.querySelector(sel);

function renderBalls(numbers, matchedSet, extraClass = '', large = false) {
  const sizeClass = large && !extraClass.includes('ball-star') ? 'ball-lg' : '';
  return numbers
    .map((n) => {
      const matchCls = matchedSet?.has(n) ? 'ball-match' : '';
      const cls = ['ball', sizeClass, extraClass, matchCls].filter(Boolean).join(' ');
      return `<span class="${cls}">${n}</span>`;
    })
    .join('');
}

function renderBreakdown(breakdown, factors = ALGO_FACTORS) {
  if (!breakdown) return '';
  return Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([key, val]) => {
      const factor = factors.find((f) => f.key === key);
      const pct = Math.round(val * 100);
      return `
        <div class="breakdown-row">
          <span class="breakdown-label">${factor?.label || key}</span>
          <div class="breakdown-bar"><div class="breakdown-fill" style="width:${pct}%"></div></div>
          <span class="breakdown-pct">${pct}%</span>
        </div>`;
    })
    .join('');
}

function renderVariant(variant) {
  const sourceLabel = variant.source === 'auto' ? 'Automat' : 'Manual';
  const sourceClass = variant.source === 'auto' ? 'source-auto' : 'source-manual';
  const meta = variant.meta || {};
  const starSection = variant.starBreakdown
    ? `<p class="breakdown-subtitle">Lucky Stars</p>${renderBreakdown(variant.starBreakdown, STAR_ALGO_FACTORS)}`
    : '';

  return `
    <article class="variant-card">
      <div class="variant-header">
        <span class="variant-index">Varianta 1</span>
        <span class="variant-source ${sourceClass}">${sourceLabel}</span>
        <span class="variant-score">Scor ${(variant.score * 100).toFixed(1)}%</span>
      </div>
      <div class="variant-balls">
        ${renderBalls(variant.numbers, null, '', true)}
        <span class="balls-separator">+</span>
        ${renderBalls(variant.stars, null, 'ball-star')}
      </div>
      <div class="variant-meta">
        <span>Suma ${meta.sum}</span>
        <span>${meta.odd} impare · ${meta.even} pare</span>
        <span>Stele: ${meta.starSum || variant.stars.reduce((a, b) => a + b, 0)}</span>
      </div>
      <details class="variant-details">
        <summary>Detalii algoritm</summary>
        <div class="breakdown">${renderBreakdown(variant.breakdown)}${starSection}</div>
      </details>
    </article>`;
}

function updateDrawInfo(data) {
  const next = data.nextDraw;
  if (!next) return;
  const el = $('#draw-info-inline');
  if (el) el.textContent = `Extragerea pentru ${next.display}`;
  state.nextDraw = next;
}

function renderGenerator(data) {
  const section = $('#variants-section');
  const nextKey = data.nextDraw?.key;
  const entry = (data.draws || []).find((d) => d.drawKey === nextKey);

  if (!entry?.variants?.length) {
    section.innerHTML = '<p class="empty-msg">Nicio variantă generată încă.</p>';
    return;
  }

  section.innerHTML = `<div class="variants-grid">${renderVariant(entry.variants[0])}</div>`;
}

function renderAlgoGrid() {
  $('#algo-grid').innerHTML = ALGO_FACTORS.map((f) => `
    <div class="algo-card">
      <h4>${f.label}</h4>
      <p>${f.desc}</p>
    </div>
  `).join('');
}

function formatMoney(value, currency = 'GBP') {
  if (!value) return '';
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function toGbp(amount, currency = 'GBP') {
  if (!amount) return 0;
  if (currency === 'GBP') return amount;
  if (currency === 'EUR' && state.gbpEurRate) return Math.round(amount / state.gbpEurRate);
  return amount;
}

function formatEurFromGbp(gbp) {
  if (!gbp || !state.gbpEurRate) return '';
  const eur = gbp * state.gbpEurRate;
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(eur);
}

function renderWinnerBadge(cat1) {
  const currency = cat1.currency || 'EUR';
  const eurLine = (gbp) => {
    const eur = formatEurFromGbp(gbp);
    return eur ? `<span class="badge-prize badge-eur">≈ ${eur}</span>` : '';
  };

  if (cat1.hasWinner) {
    const label = cat1.winners === 1 ? '1 câștigător' : `${cat1.winners} câștigători`;
    const gbp = toGbp(cat1.prize, currency);
    return `
      <span class="badge badge-winner">${label}</span>
      <span class="badge-prize">${formatMoney(gbp, 'GBP')}</span>
      ${eurLine(gbp)}
    `;
  }

  const gbp = toGbp(cat1.jackpot, currency);
  return `
    <span class="badge badge-report">Report</span>
    <span class="badge-prize">Jackpot ${formatMoney(gbp, 'GBP')}</span>
    ${eurLine(gbp)}
  `;
}

async function loadGbpEurRate() {
  try {
    const res = await fetch('/api/exchange-rate/gbp');
    if (res.ok) {
      const data = await res.json();
      state.gbpEurRate = data.rate;
    }
  } catch {
    state.gbpEurRate = 1.17;
  }
}

function getMatched(drawDate) {
  return state.variantMap[drawDate] || null;
}

function renderDraws(draws) {
  const container = $('#draws-body');

  if (!draws.length) {
    container.innerHTML = '<p class="empty">Nicio extragere găsită.</p>';
    return;
  }

  container.innerHTML = draws.map((draw) => {
    const matched = getMatched(draw.date);
    const numMatched = matched
      ? new Set(matched.numbers || [])
      : null;
    const starMatched = matched
      ? new Set(matched.stars || [])
      : null;
    const numHits = numMatched
      ? draw.numbers.filter((n) => numMatched.has(n)).length
      : 0;
    const starHits = starMatched
      ? draw.stars.filter((s) => starMatched.has(s)).length
      : 0;
    const totalHits = numHits + starHits;
    const rowClass = totalHits > 0 ? 'draw-card draw-card-match' : 'draw-card';

    return `
    <article class="${rowClass}">
      <div class="draw-card-numbers">
        <div class="numbers numbers-euro">
          <div class="numbers-group">${renderBalls(draw.numbers, numMatched)}</div>
          <span class="balls-separator">+</span>
          <div class="numbers-group numbers-stars">${renderBalls(draw.stars, starMatched, 'ball-star')}</div>
        </div>
      </div>
      <div class="draw-card-date">
        ${draw.dateDisplay}
        ${totalHits ? `<span class="match-count">${numHits} num · ${starHits} stele</span>` : ''}
      </div>
      <div class="draw-card-cat">${renderWinnerBadge(draw.category1)}</div>
    </article>`;
  }).join('');
}

function renderYearSelect(years) {
  const select = $('#year-select');
  select.innerHTML = years
    .slice()
    .reverse()
    .map(({ year, draws }) => `
      <option value="${year}"${year === state.currentYear ? ' selected' : ''}>
        ${year} (${draws} extrageri)
      </option>
    `)
    .join('');
}

function renderStats(stats) {
  $('#stat-draws').textContent = stats.totalDraws.toLocaleString('ro-RO');
  $('#stat-winners').textContent = stats.winnersCount.toLocaleString('ro-RO');
  $('#stat-reports').textContent = stats.reportsCount.toLocaleString('ro-RO');
}

function updateStatus(lastUpdated, status) {
  const el = $('#last-updated');
  if (!lastUpdated) {
    el.textContent = '';
    return;
  }

  const updated = new Date(lastUpdated);
  const dateStr = updated.toLocaleDateString('ro-RO', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  if (status?.isRefreshing) {
    el.textContent = `Ultima actualizare: ${dateStr} · se actualizează acum...`;
    el.classList.add('syncing');
    return;
  }

  el.classList.remove('syncing');
  let text = `Ultima actualizare: ${dateStr}`;
  if (status?.nextScheduledRefresh) {
    const next = new Date(status.nextScheduledRefresh);
    const nextStr = next.toLocaleDateString('ro-RO', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    text += ` · următoarea automată: ${nextStr}`;
  }
  el.textContent = text;
}

async function loadVariantMap() {
  try {
    const res = await fetch('/api/euromillions/generator/matches');
    if (res.ok) {
      const data = await res.json();
      state.variantMap = data.matches || {};
    }
  } catch {
    state.variantMap = {};
  }
}

async function loadGenerator() {
  try {
    const res = await fetch('/api/euromillions/generator');
    if (!res.ok) throw new Error('Eroare la încărcarea generatorului');
    const data = await res.json();
    $('#disclaimer').textContent = data.disclaimer;
    updateDrawInfo(data);
    renderGenerator(data);
  } catch (err) {
    $('#variants-section').innerHTML = `<p class="error-msg">${err.message}</p>`;
  }
}

async function loadDraws(year) {
  const container = $('#draws-body');
  container.innerHTML = '<p class="loading">Se încarcă...</p>';

  try {
    const res = await fetch(`/api/euromillions/draws?year=${year}`);
    if (!res.ok) throw new Error('Eroare la încărcarea datelor');
    const data = await res.json();

    $('#section-title').textContent = `Extrageri ${year}`;
    $('#draw-count').textContent = `${data.count} extrageri`;
    renderDraws(data.draws);
  } catch (err) {
    container.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

async function init({ reloadDraws = true } = {}) {
  try {
    await Promise.all([loadGbpEurRate(), loadVariantMap()]);

    const [statsRes, yearsRes, statusRes] = await Promise.all([
      fetch('/api/euromillions/stats'),
      fetch('/api/euromillions/years'),
      fetch('/api/euromillions/status'),
    ]);

    if (!statsRes.ok || !yearsRes.ok) {
      throw new Error('Date indisponibile. Serverul le va prelua automat.');
    }

    const statsData = await statsRes.json();
    const yearsData = await yearsRes.json();
    const statusData = statusRes.ok ? await statusRes.json() : null;

    const dataChanged = state.lastUpdated && state.lastUpdated !== statsData.lastUpdated;
    state.lastUpdated = statsData.lastUpdated;
    state.stats = statsData.stats;
    state.years = yearsData.years;

    renderStats(state.stats);
    updateStatus(statsData.lastUpdated, statusData);

    const latestYear = state.years[state.years.length - 1]?.year;
    if (latestYear && !state.currentYear) {
      state.currentYear = latestYear;
    }

    renderYearSelect(state.years);

    if (latestYear && (reloadDraws || dataChanged)) {
      await loadDraws(state.currentYear);
    }
  } catch (err) {
    $('#draws-body').innerHTML = `<p class="error">${err.message}</p>`;
    $('#hero-stats').style.display = 'none';
  }
}

async function pollForUpdates() {
  try {
    const res = await fetch('/api/euromillions/status');
    if (!res.ok) return;
    const status = await res.json();
    updateStatus(status.lastUpdated || state.lastUpdated, status);

    if (status.isRefreshing) return;
    if (status.lastUpdated && status.lastUpdated !== state.lastUpdated) {
      await loadVariantMap();
      await loadGenerator();
      await init({ reloadDraws: true });
    }
  } catch {
    /* ignoră */
  }
}

$('#btn-generate').addEventListener('click', async () => {
  const btn = $('#btn-generate');
  btn.disabled = true;
  btn.querySelector('.btn-generate-text').textContent = 'Se generează...';

  try {
    const res = await fetch('/api/euromillions/generator/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drawKey: state.nextDraw?.key }),
    });
    if (!res.ok) throw new Error('Generare eșuată');
    await loadGenerator();
    await loadVariantMap();
    if (state.currentYear) await loadDraws(state.currentYear);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-generate-text').textContent = 'Generează variantă nouă';
  }
});

$('#year-select').addEventListener('change', (e) => {
  state.currentYear = parseInt(e.target.value, 10);
  loadDraws(state.currentYear);
});

loadGenerator();
init();
renderAlgoGrid();
setInterval(pollForUpdates, POLL_INTERVAL_MS);
