import { TIMEZONE } from './constants';

// Dates from Postgres `date` columns are 'YYYY-MM-DD' — show them without
// timezone shifting.
export function fmtDate(d: string | null | undefined) {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function fmtDateTime(ts: string) {
  return new Date(ts).toLocaleString('en-US', {
    timeZone: TIMEZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// Today's date in San Antonio as 'YYYY-MM-DD'
export function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

export const isOverdue = (neededBy: string | null, status: string) =>
  !!neededBy && neededBy < todayISO() && !['Posted', 'Scheduled', 'On Hold'].includes(status);

export const initials = (name: string) =>
  name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
