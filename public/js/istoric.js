const $ = (sel) => document.querySelector(sel);

function formatWhen(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('ro-RO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function gameLabel(game) {
  return game === 'euromillions' ? 'EuroMillions' : 'Loto 6/49';
}

function renderBalls(numbers, matchedSet = null) {
  return (numbers || [])
    .map((n) => {
      const matchCls = matchedSet?.has(n) ? 'ball-match' : '';
      return `<span class="ball ${matchCls}">${n}</span>`;
    })
    .join('');
}

function renderStars(stars, matchedSet = null) {
  if (!stars?.length) return '';
  return (stars || [])
    .map((s) => {
      const matchCls = matchedSet?.has(s) ? 'ball-match' : '';
      return `<span class="ball ball-star ${matchCls}">${s}</span>`;
    })
    .join('');
}

function renderEntry(entry) {
  const matchedNums = new Set(entry.hitNumbers || []);
  const matchedStars = new Set(entry.hitStars || []);
  const hasHits = (entry.hitCount || 0) > 0;
  const rowClass = hasHits ? 'draw-card draw-card-match' : 'draw-card';
  const isEuro = entry.game === 'euromillions';

  const status = !entry.hasResult
    ? '<span class="badge badge-report">Așteaptă extragerea</span>'
    : hasHits
      ? `<span class="match-count">${entry.hitCount} potriviri</span>`
      : '<span class="badge badge-report">0 potriviri</span>';

  const numbersHtml = isEuro
    ? `<div class="numbers numbers-euro">
          <div class="numbers-group">${renderBalls(entry.numbers, matchedNums)}</div>
          <span class="balls-separator">+</span>
          <div class="numbers-group numbers-stars">${renderStars(entry.stars, matchedStars)}</div>
        </div>`
    : `<div class="numbers numbers-row">${renderBalls(entry.numbers, matchedNums)}</div>`;

  return `
    <article class="${rowClass}">
      <div class="draw-card-numbers">
        ${numbersHtml}
      </div>
      <div class="draw-card-date history-meta-col">
        <span class="history-game">${gameLabel(entry.game)}</span>
        <span class="history-when">${formatWhen(entry.createdAt)}</span>
        <span class="history-draw">${entry.drawDisplay || entry.drawKey}</span>
        ${hasHits ? `<span class="match-count">${entry.hitCount} potriviri</span>` : ''}
      </div>
      <div class="draw-card-cat history-side">
        <span class="history-country" title="${entry.countryCode || ''}">${entry.country || 'Necunoscută'}</span>
        ${status}
      </div>
    </article>`;
}

async function loadHistory() {
  const body = $('#history-body');
  const countEl = $('#history-count');
  const metaEl = $('#history-meta');

  try {
    const res = await fetch('/api/history');
    if (!res.ok) throw new Error('Nu am putut încărca istoricul.');
    const data = await res.json();
    const entries = data.entries || [];

    countEl.textContent = entries.length === 1
      ? '1 generare'
      : `${entries.length} generări`;

    metaEl.textContent = data.updatedAt
      ? `Actualizat ${formatWhen(data.updatedAt)}`
      : '';

    if (!entries.length) {
      body.innerHTML = '<p class="empty">Nicio generare manuală încă. Apasă „Generează variantă nouă” pe Loto sau EuroMillions.</p>';
      return;
    }

    body.innerHTML = entries.map(renderEntry).join('');
  } catch (err) {
    body.innerHTML = `<p class="empty">${err.message}</p>`;
    countEl.textContent = '';
  }
}

loadHistory();
setInterval(loadHistory, 2 * 60 * 1000);
