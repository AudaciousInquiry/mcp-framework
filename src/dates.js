'use strict';

const ACCEPTED =
  'YYYY-MM-DD, YYYY-MM-DDTHH:MM[:SS[.mmm]][Z|+HH:MM], now, today, yesterday, tomorrow, or an offset such as -7d, +2w, -3h, +30m';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?$/;
const OFFSET_RE = /^([+-])(\d+)([dwhm])$/;

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

function localDate(d) {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function validParts(y, mo, d, h = 0, mi = 0, s = 0) {
  const check = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d &&
    h < 24 && mi < 60 && s < 60;
}

function bad(field, value) {
  return new Error(`${field}: "${value}" is not a valid date; accepted forms: ${ACCEPTED}`);
}

/**
 * Convert text to a date (`YYYY-MM-DD`) or a UTC date-time (`...Z`). Local
 * time is used for a date-time without a zone and for a date given to a
 * date-time field. Natural language other than the relative words is refused.
 * @param {string} text
 * @param {'date'|'date-time'} kind
 * @param {{field?: string, now?: Date}} [options]
 * @returns {string}
 */
function convertDate(text, kind, { field = 'value', now = new Date() } = {}) {
  const t = text.trim();
  const lower = t.toLowerCase();
  const instantResult = (instant) => (kind === 'date' ? localDate(instant) : instant.toISOString());
  const midnight = (offsetDays) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);

  if (lower === 'now') return instantResult(new Date(now.getTime()));
  if (lower === 'today') return instantResult(midnight(0));
  if (lower === 'yesterday') return instantResult(midnight(-1));
  if (lower === 'tomorrow') return instantResult(midnight(1));

  const off = OFFSET_RE.exec(lower);
  if (off) {
    const n = Number(off[2]) * (off[1] === '-' ? -1 : 1);
    const unitMs = { d: 86400000, w: 7 * 86400000, h: 3600000, m: 60000 }[off[3]];
    return instantResult(new Date(now.getTime() + n * unitMs));
  }

  let m = DATE_RE.exec(t);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!validParts(y, mo, d)) throw bad(field, text);
    if (kind === 'date') return `${m[1]}-${m[2]}-${m[3]}`;
    return new Date(y, mo - 1, d).toISOString();
  }

  m = DATETIME_RE.exec(t);
  if (m) {
    const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
    const s = m[6] ? Number(m[6]) : 0;
    if (!validParts(y, mo, d, h, mi, s)) throw bad(field, text);
    const ms = m[7] ? Number(m[7].padEnd(3, '0').slice(0, 3)) : 0;
    let instant;
    if (m[8]) {
      const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${pad(s)}.${pad(ms, 3)}${m[8]}`;
      instant = new Date(iso);
    } else {
      instant = new Date(y, mo - 1, d, h, mi, s, ms);
    }
    if (Number.isNaN(instant.getTime())) throw bad(field, text);
    return instantResult(instant);
  }
  throw bad(field, text);
}

module.exports = { convertDate, ACCEPTED };
