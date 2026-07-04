import { getBucharestParts, TZ } from './draw-schedule.js';

const DRAW_DAYS = new Set([0, 4]);
const POST_DRAW_HOUR = 19;
const POST_DRAW_MINUTE = 30;

let lastPostDrawRefresh = null;

function shouldRunPostDrawRefresh() {
  const parts = getBucharestParts();
  if (!DRAW_DAYS.has(parts.weekday)) return false;
  if (parts.hour < POST_DRAW_HOUR) return false;
  if (parts.hour === POST_DRAW_HOUR && parts.minute < POST_DRAW_MINUTE) return false;

  const todayKey = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  if (lastPostDrawRefresh === todayKey) return false;

  return todayKey;
}

function startPostDrawScheduler(onRefresh) {
  setInterval(() => {
    const todayKey = shouldRunPostDrawRefresh();
    if (!todayKey) return;

    lastPostDrawRefresh = todayKey;
    console.log(`[scheduler] Post-extragere ${todayKey} — actualizare forțată`);
    onRefresh(`post-extragere ${todayKey}`);
  }, 15 * 60 * 1000);
}

export { startPostDrawScheduler, TZ };
