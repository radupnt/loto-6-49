const DAY_NAMES = ['Duminică', 'Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă'];
const MONTH_NAMES = [
  'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
  'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie',
];

const DRAW_DAYS = new Set([0, 4]); // Duminică, Joi
const DRAW_HOUR = 18;
const DRAW_MINUTE = 30;
const TZ = 'Europe/Bucharest';

function getBucharestParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
    weekday: weekdayMap[get('weekday')],
  };
}

function formatDrawDisplay(year, month, day, weekday) {
  const dayName = DAY_NAMES[weekday];
  const monthName = MONTH_NAMES[month - 1];
  return `${dayName}, ${day} ${monthName} ${year}, ora ${DRAW_HOUR}:${String(DRAW_MINUTE).padStart(2, '0')}`;
}

function toDrawKey(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getNextDraw(from = new Date()) {
  const cursor = new Date(from.getTime());

  for (let i = 0; i < 21; i++) {
    const parts = getBucharestParts(cursor);
    const isDrawDay = DRAW_DAYS.has(parts.weekday);
    const isPastTime =
      parts.hour > DRAW_HOUR ||
      (parts.hour === DRAW_HOUR && parts.minute >= DRAW_MINUTE);

    if (isDrawDay && (i > 0 || !isPastTime)) {
      const key = toDrawKey(parts.year, parts.month, parts.day);
      return {
        key,
        date: key,
        year: parts.year,
        month: parts.month,
        day: parts.day,
        weekday: parts.weekday,
        hour: DRAW_HOUR,
        minute: DRAW_MINUTE,
        display: formatDrawDisplay(parts.year, parts.month, parts.day, parts.weekday),
        iso: `${key}T${String(DRAW_HOUR).padStart(2, '0')}:${String(DRAW_MINUTE).padStart(2, '0')}:00`,
      };
    }

    cursor.setTime(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  return null;
}

function getUpcomingDraws(count = 2, from = new Date()) {
  const draws = [];
  let cursor = new Date(from.getTime());

  while (draws.length < count) {
    const next = getNextDraw(cursor);
    if (!next) break;
    if (!draws.find((d) => d.key === next.key)) draws.push(next);
    cursor = new Date(cursor.getTime() + 25 * 60 * 60 * 1000);
  }

  return draws;
}

function isDrawPast(drawKey) {
  const next = getNextDraw();
  if (!next) return true;
  return drawKey < next.key;
}

export {
  getNextDraw,
  getUpcomingDraws,
  isDrawPast,
  formatDrawDisplay,
  toDrawKey,
  getBucharestParts,
  TZ,
};
