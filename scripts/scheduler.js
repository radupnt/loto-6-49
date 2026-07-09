import { getBucharestParts } from './draw-schedule.js';
import { getLondonParts } from './draw-schedule-euromillions.js';

const LOTO_DRAW_DAYS = new Set([0, 4]);
const EM_DRAW_DAYS = new Set([2, 5]);
const POST_DRAW_HOUR = 19;
const POST_DRAW_MINUTE = 30;
const EM_POST_DRAW_HOUR = 21;
const EM_POST_DRAW_MINUTE = 30;

let lastLotoPostDrawRefresh = null;
let lastEmPostDrawRefresh = null;

function shouldRunLotoPostDrawRefresh() {
  const parts = getBucharestParts();
  if (!LOTO_DRAW_DAYS.has(parts.weekday)) return false;
  if (parts.hour < POST_DRAW_HOUR) return false;
  if (parts.hour === POST_DRAW_HOUR && parts.minute < POST_DRAW_MINUTE) return false;

  const todayKey = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  if (lastLotoPostDrawRefresh === todayKey) return false;
  return todayKey;
}

function shouldRunEmPostDrawRefresh() {
  const parts = getLondonParts();
  if (!EM_DRAW_DAYS.has(parts.weekday)) return false;
  if (parts.hour < EM_POST_DRAW_HOUR) return false;
  if (parts.hour === EM_POST_DRAW_HOUR && parts.minute < EM_POST_DRAW_MINUTE) return false;

  const todayKey = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  if (lastEmPostDrawRefresh === todayKey) return false;
  return todayKey;
}

function startPostDrawScheduler(onRefresh) {
  setInterval(() => {
    const lotoKey = shouldRunLotoPostDrawRefresh();
    if (lotoKey) {
      lastLotoPostDrawRefresh = lotoKey;
      console.log(`[scheduler] Post-extragere Loto ${lotoKey} — actualizare forțată`);
      onRefresh(`post-extragere loto ${lotoKey}`);
      return;
    }

    const emKey = shouldRunEmPostDrawRefresh();
    if (emKey) {
      lastEmPostDrawRefresh = emKey;
      console.log(`[scheduler] Post-extragere EuroMillions ${emKey} — actualizare forțată`);
      onRefresh(`post-extragere euromillions ${emKey}`);
    }
  }, 15 * 60 * 1000);
}

export { startPostDrawScheduler };
