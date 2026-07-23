const POLL_INTERVAL_MS = 2 * 60 * 1000;

const ALGO_FACTORS = [
  { key: 'frequency', label: 'Frecvență istorică', desc: 'Proximitate de media așteptată per număr' },
  { key: 'recency', label: 'Frecvență recentă', desc: 'Numere active în ultimele 120 extrageri' },
  { key: 'gap', label: 'Gap temporal', desc: 'Zile de la ultima apariție, normalizat' },
  { key: 'pairSynergy', label: 'Perechi istorice', desc: 'Co-apariții din tot istoricul' },
  { key: 'recentPairs', label: 'Perechi recente', desc: 'Co-apariții din ultimele 60 extrageri' },
  { key: 'tripletSynergy', label: 'Triplete', desc: 'Co-apariții istorice între triplete' },
  { key: 'oddEven', label: 'Par / Impar', desc: 'Distribuție 3+3 preferată statistic' },
  { key: 'sumRange', label: 'Suma numerelor', desc: 'Gaussian centrat pe media istorică (~147)' },
  { key: 'spread', label: 'Distribuție spațială', desc: 'Distanța optimă între numere consecutive' },
  { key: 'decadeSpread', label: 'Decade', desc: 'Spread pe intervale 1–10, 11–20...' },
  { key: 'consecutive', label: 'Consecutive', desc: 'Penalizare numere consecutive' },
  { key: 'lastDraw', label: 'Extragerea anterioară', desc: 'Diversificare față de ultima extragere' },
  { key: 'diversity', label: 'Diversitate', desc: 'Distanță minimă între variante generate' },
];

const state = {
  nextDraw: null,
  years: [],
  currentYear: null,
  stats: null,
  lastUpdated: null,
  eurRate: null,
  variantMap: {},
};

const $ = (sel) => document.querySelector(sel);

function formatRon(value) {
  if (!value) return '';
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency: 'RON',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatEur(ron) {
  if (!ron || !state.eurRate) return '';
  const eur = ron / state.eurRate;
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(eur);
}

function renderBalls(numbers, matchedSet, large = false) {
  const sizeClass = large ? 'ball-lg' : '';
  return numbers
    .map((n) => {
      const matchCls = matchedSet?.has(n) ? 'ball-match' : '';
      const cls = ['ball', sizeClass, matchCls].filter(Boolean).join(' ');
      return `<span class="${cls}">${n}</span>`;
    })
    .join('');
}

function renderBreakdown(breakdown) {
  if (!breakdown) return '';
  return Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([key, val]) => {
      const factor = ALGO_FACTORS.find((f) => f.key === key);
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

  return `
    <article class="variant-card">
      <div class="variant-header">
        <span class="variant-index">Varianta 1</span>
        <span class="variant-source ${sourceClass}">${sourceLabel}</span>
        <span class="variant-score">Scor ${(variant.score * 100).toFixed(1)}%</span>
      </div>
      <div class="variant-balls">${renderBalls(variant.numbers, null, true)}</div>
      <div class="variant-meta">
        <span>Suma ${meta.sum}</span>
        <span>${meta.odd} impare · ${meta.even} pare</span>
        <span>${meta.consecutive} consecutive</span>
      </div>
      <details class="variant-details">
        <summary>Detalii algoritm</summary>
        <div class="breakdown">${renderBreakdown(variant.breakdown)}</div>
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

function renderVariants(data) {
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

function renderWinnerBadge(cat1) {
  if (!cat1) {
    return `<span class="badge badge-report">Premii în actualizare</span>`;
  }

  const eurLine = (ron) => {
    const eur = formatEur(ron);
    return eur ? `<span class="badge-prize badge-eur">≈ ${eur}</span>` : '';
  };

  if (cat1.hasWinner) {
    const label = cat1.winners === 1 ? '1 câștigător' : `${cat1.winners} câștigători`;
    const prizeBlock = cat1.prize > 0
      ? `<span class="badge-prize">${formatRon(cat1.prize)}</span>${eurLine(cat1.prize)}`
      : '';
    return `
      <span class="badge badge-winner">${label}</span>
      ${prizeBlock}
    `;
  }

  if (!(cat1.jackpot > 0) && !(cat1.prize > 0)) {
    return `<span class="badge badge-report">Premii în actualizare</span>`;
  }

  return `
    <span class="badge badge-report">Report</span>
    <span class="badge-prize">Jackpot ${formatRon(cat1.jackpot)}</span>
    ${eurLine(cat1.jackpot)}
  `;
}

function getMatchedNumbers(drawDate) {
  const matched = state.variantMap[drawDate];
  return matched ? new Set(matched) : null;
}

function renderDraws(draws) {
  const container = $('#draws-body');

  if (!draws.length) {
    container.innerHTML = '<p class="empty">Nicio extragere găsită.</p>';
    return;
  }

  container.innerHTML = draws.map((draw) => {
    const matched = getMatchedNumbers(draw.date);
    const matchCount = matched
      ? draw.numbers.filter((n) => matched.has(n)).length
      : 0;
    const rowClass = matchCount > 0 ? 'draw-card draw-card-match' : 'draw-card';

    return `
    <article class="${rowClass}">
      <div class="draw-card-numbers">
        <div class="numbers numbers-row">
          ${renderBalls(draw.numbers, matched)}
        </div>
      </div>
      <div class="draw-card-date">
        ${draw.dateDisplay}
        ${matchCount ? `<span class="match-count">${matchCount} potriviri</span>` : ''}
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

async function loadExchangeRate() {
  try {
    const res = await fetch('/api/exchange-rate');
    if (res.ok) {
      const data = await res.json();
      state.eurRate = data.rate;
    }
  } catch {
    state.eurRate = 5.2374;
  }
}

async function loadVariantMap() {
  try {
    const res = await fetch('/api/generator/matches');
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
    const res = await fetch('/api/generator');
    if (!res.ok) throw new Error('Eroare la încărcarea generatorului');
    const data = await res.json();
    $('#disclaimer').textContent = data.disclaimer;
    updateDrawInfo(data);
    renderVariants(data);
  } catch (err) {
    $('#variants-section').innerHTML = `<p class="error-msg">${err.message}</p>`;
  }
}

async function loadDraws(year) {
  const container = $('#draws-body');
  container.innerHTML = '<p class="loading">Se încarcă...</p>';

  try {
    const res = await fetch(`/api/draws?year=${year}`);
    if (!res.ok) throw new Error('Eroare la încărcarea datelor');
    const data = await res.json();

    $('#section-title').textContent = `Extrageri ${year}`;
    $('#draw-count').textContent = `${data.count} extrageri`;
    renderDraws(data.draws);
  } catch (err) {
    container.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

async function initArchive({ reloadDraws = true } = {}) {
  try {
    await Promise.all([loadExchangeRate(), loadVariantMap()]);

    const [statsRes, yearsRes, statusRes] = await Promise.all([
      fetch('/api/stats'),
      fetch('/api/years'),
      fetch('/api/status'),
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
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const status = await res.json();
    updateStatus(status.lastUpdated || state.lastUpdated, status);

    if (status.isRefreshing) return;
    if (status.lastUpdated && status.lastUpdated !== state.lastUpdated) {
      await loadVariantMap();
      await loadGenerator();
      await initArchive({ reloadDraws: true });
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
    const res = await fetch('/api/generator/generate', {
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

renderAlgoGrid();
loadGenerator();
initArchive();
setInterval(pollForUpdates, POLL_INTERVAL_MS);
