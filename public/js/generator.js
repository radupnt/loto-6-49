const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

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

let state = { nextDraw: null, draws: [] };

function renderBalls(numbers) {
  return numbers.map((n) => `<span class="ball ball-lg">${n}</span>`).join('');
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

function renderVariant(variant, index, drawDisplay) {
  const sourceLabel = variant.source === 'auto' ? 'Automat' : 'Manual';
  const sourceClass = variant.source === 'auto' ? 'source-auto' : 'source-manual';
  const meta = variant.meta || {};

  return `
    <article class="variant-card">
      <div class="variant-header">
        <span class="variant-index">Varianta ${index + 1}</span>
        <span class="variant-source ${sourceClass}">${sourceLabel}</span>
        <span class="variant-score">Scor ${(variant.score * 100).toFixed(1)}%</span>
      </div>
      <div class="variant-balls">${renderBalls(variant.numbers)}</div>
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

function renderDrawBlock(drawEntry) {
  const variants = drawEntry.variants || [];
  if (!variants.length) return '';

  return `
    <div class="variants-grid">
      ${variants.map((v, i) => renderVariant(v, i, drawEntry.drawDisplay)).join('')}
    </div>`;
}

function updateDrawInfo(data) {
  const next = data.nextDraw;
  if (!next) return;

  const el = $('#draw-info-inline');
  if (el) {
    el.textContent = `Extragerea pentru ${next.display}`;
  }

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

  const single = { ...entry, variants: entry.variants.slice(0, 1) };
  section.innerHTML = renderDrawBlock(single);
  state.draws = [single];
}

function renderAlgoGrid() {
  $('#algo-grid').innerHTML = ALGO_FACTORS.map((f) => `
    <div class="algo-card">
      <h4>${f.label}</h4>
      <p>${f.desc}</p>
    </div>
  `).join('');
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
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-generate-text').textContent = 'Generează variantă nouă';
  }
});

renderAlgoGrid();
loadGenerator();
