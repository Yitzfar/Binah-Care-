export const ET_TIMEZONE = 'America/New_York';

export function formatEtNowClock(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIMEZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date()) + ' ET';
}

export function getTodayEtIso(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function formatEtDateLabel(dateIso: string): string {
  if (!dateIso || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    return dateIso;
  }
  const [y, m, d] = dateIso.split('-').map(Number);
  const utcDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIMEZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(utcDate);
}

/**
 * Parses 12-hour AM/PM time string (e.g. "9:30 AM", "2:15 PM") into minutes from midnight.
 */
export function parse12HourTimeToMinutes(timeStr: string): number | null {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3].toUpperCase();

  if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;
  if (meridiem === 'AM') {
    if (hours === 12) hours = 0;
  } else {
    if (hours !== 12) hours += 12;
  }
  return hours * 60 + minutes;
}

export function computeHoursBetween12Hr(startTimeEt: string, endTimeEt: string): number {
  const start = parse12HourTimeToMinutes(startTimeEt);
  const end = parse12HourTimeToMinutes(endTimeEt);
  if (start === null || end === null || end <= start) {
    return 0;
  }
  return Math.round(((end - start) / 60) * 100) / 100;
}

export const EASTERN_TIME_SLOTS_12HR: string[] = [
  '8:00 AM',
  '8:30 AM',
  '9:00 AM',
  '9:30 AM',
  '10:00 AM',
  '10:30 AM',
  '11:00 AM',
  '11:30 AM',
  '12:00 PM',
  '12:30 PM',
  '1:00 PM',
  '1:30 PM',
  '2:00 PM',
  '2:30 PM',
  '3:00 PM',
  '3:30 PM',
  '4:00 PM',
  '4:30 PM',
  '5:00 PM',
  '5:30 PM',
  '6:00 PM',
  '6:30 PM',
  '7:00 PM',
  '7:30 PM',
  '8:00 PM',
];

export function getRelativeDaysAgoEtIso(daysAgo: number, baseMs = Date.now()): string {
  const targetMs = baseMs - daysAgo * 24 * 60 * 60 * 1000;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(targetMs));

  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

/**
 * Resolves YYYY-MM-DD + 12-hour AM/PM time in America/New_York (EST/EDT DST-aware) to UTC epoch ms.
 */
export function getEtDateTimeEpochMs(dateEt: string, time12HrEt: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateEt)) return null;
  const totalMinutes = parse12HourTimeToMinutes(time12HrEt);
  if (totalMinutes === null) return null;

  const [y, m, d] = dateEt.split('-').map(Number);
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;

  // Initial UTC guess assuming EST (-05:00), then refine using actual America/New_York wall clock
  const targetUtcWall = Date.UTC(y, m - 1, d, hour24, minute, 0);
  let guess = targetUtcWall + 5 * 60 * 60 * 1000;

  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: ET_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(guess));

    const py = Number(parts.find((p) => p.type === 'year')?.value ?? y);
    const pm = Number(parts.find((p) => p.type === 'month')?.value ?? m);
    const pd = Number(parts.find((p) => p.type === 'day')?.value ?? d);
    let ph = Number(parts.find((p) => p.type === 'hour')?.value ?? hour24);
    if (ph === 24) ph = 0;
    const pmin = Number(parts.find((p) => p.type === 'minute')?.value ?? minute);

    const renderedWall = Date.UTC(py, pm - 1, pd, ph, pmin, 0);
    const delta = targetUtcWall - renderedWall;
    if (delta === 0) break;
    guess += delta;
  }

  return guess;
}

export function getHoursSinceSessionEndedEt(
  dateEt: string,
  endTimeEt: string,
  nowMs = Date.now()
): number | null {
  const endMs = getEtDateTimeEpochMs(dateEt, endTimeEt);
  if (endMs === null) return null;
  const diffHours = (nowMs - endMs) / (1000 * 60 * 60);
  return Math.round(diffHours * 10) / 10;
}

export function formatOverdueDuration(hours: number, lang: 'en' | 'yi'): string {
  const rounded = Math.max(0, Math.round(hours * 10) / 10);
  const days = Math.floor(rounded / 24);
  const remHours = Math.round(rounded % 24);
  if (lang === 'yi') {
    return days > 0 ? `${days} טאָג ${remHours} שעה (${rounded}h)` : `${rounded} שעה שפּעט`;
  }
  return days > 0 ? `${days}d ${remHours}h (${rounded}h)` : `${rounded}h overdue`;
}

