/**
 * Parser for the coach's spreadsheet training logs (the "forgiving import" from
 * the spec's manual-history path). Built from real files, so it tolerates their
 * quirks:
 *
 *  - **Date-coercion bug**: Excel/Sheets turn an "Assigned Miles" cell like
 *    "7-8" into a DATE (2021-07-08). We reverse it: month=low, day=high →
 *    the mileage range 7–8. This is pervasive in the real files.
 *  - Mileage as a single number, a range ("11-12", "7-7.5"), or the bug above.
 *  - Day rows in any order; blank spacer rows; a "Total Miles" row and a
 *    "Things to think about" narrative we skip.
 *  - Year is implicit in sheet names, so it's supplied as a parameter.
 *
 * Pure data-shaping over an exceljs workbook; no DB, no clock.
 */
import ExcelJS from 'exceljs';

export interface MileValue {
  value: number; // single value or range midpoint
  lo: number;
  hi: number;
  wasDateBug: boolean;
}

export interface ParsedDay {
  date: string; // 'YYYY-MM-DD'
  dayName: string;
  sheetName: string;
  sport: 'run' | 'cross_train' | 'other';
  assignedMiles: MileValue | null;
  actualMiles: number | null;
  workout: string; // assigned session text
  warmup: string;
  cooldown: string;
  description: string; // athlete's log of what they actually did
  core: string;
  avgPaceSecPerKm: number | null; // parsed from description when an "avg" pace is present
  durationSeconds: number | null; // derived from actualMiles × avg pace, when available
  // Wellness signals (when the log has them) → readiness inputs.
  sleepHours?: number | null;
  restingHr?: number | null;
  feel?: number | null; // 1-5 subjective
}

const MI_TO_KM = 1.609344;
const NON_WEEK_SHEETS = new Set(['build comparisons', 'races', 'drills', 'core work']);
const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export interface ParseOptions {
  year: number;
}

export async function parseTrainingLogFile(
  path: string,
  opts: ParseOptions,
): Promise<ParsedDay[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return parseWorkbook(wb, opts);
}

export async function parseTrainingLogBuffer(
  buf: ArrayBuffer | Buffer,
  opts: ParseOptions,
): Promise<ParsedDay[]> {
  const wb = new ExcelJS.Workbook();
  // Cast around the @types/node Buffer-generic mismatch with exceljs's signature.
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return parseWorkbook(wb, opts);
}

export function parseWorkbook(wb: ExcelJS.Workbook, opts: ParseOptions): ParsedDay[] {
  // Two known shapes: a flat daily table (a real "Date" column) vs the weekly
  // sheet-per-week layout. Detect and dispatch.
  const flatSheet = wb.worksheets.find((ws) => flatHeaderRow(ws) != null);
  const out: ParsedDay[] = flatSheet
    ? parseFlatSheet(flatSheet)
    : (() => {
        const acc: ParsedDay[] = [];
        wb.eachSheet((ws) => {
          if (NON_WEEK_SHEETS.has(ws.name.trim().toLowerCase())) return;
          acc.push(...parseWeekSheet(ws, opts));
        });
        return acc;
      })();

  // Sort chronologically and de-dupe by date (last wins).
  const byDate = new Map<string, ParsedDay>();
  for (const d of out.sort((a, b) => a.date.localeCompare(b.date))) byDate.set(d.date, d);
  return Array.from(byDate.values());
}

// --- flat daily-table format (e.g. an exported "log_report") ---

interface FlatCols {
  date: number;
  logged?: number;
  assigned?: number;
  type?: number;
  description?: number;
  phase?: number;
  pace?: number; // "Log Pace Per Mile"
  sleep?: number; // "Hrs of Sleep"
  restingHr?: number; // "Morning Heartrate"
  feel?: number; // "How I felt …"
}

/** Returns the header row number if this sheet is a flat daily log (has a Date column). */
function flatHeaderRow(ws: ExcelJS.Worksheet): number | null {
  const max = Math.min(ws.rowCount || 3, 3);
  for (let r = 1; r <= max; r++) {
    const cells: string[] = [];
    ws.getRow(r).eachCell((c) => cells.push(cellText(c).toLowerCase().trim()));
    if (cells.includes('date') && cells.some((t) => t.includes('miles') || t.includes('workout'))) {
      return r;
    }
  }
  return null;
}

function mapFlatColumns(row: ExcelJS.Row): FlatCols {
  // Exact matches — these logs often carry parallel metric columns
  // ("Logged Kilometers", "Workout Description(Kms)") we must NOT pick.
  const cols: Partial<FlatCols> = {};
  row.eachCell((cell, c) => {
    const t = cellText(cell).toLowerCase().trim();
    if (t === 'date') cols.date = c;
    else if (t === 'logged miles') cols.logged = c;
    else if (t === 'assigned miles') cols.assigned = c;
    else if (t === 'type of workout' || t === 'type') cols.type = c;
    else if (t === 'workout description') cols.description = c;
    else if (t === 'log pace per mile') cols.pace = c;
    else if (t.includes('hrs of sleep') || t === 'sleep') cols.sleep = c;
    else if (t.includes('morning heartrate') || t.includes('resting')) cols.restingHr = c;
    else if (t.includes('how i felt')) cols.feel = c;
    else if (t.includes('phase')) cols.phase = c;
  });
  return cols as FlatCols;
}

/** A positive number from a cell, else null (0/blank treated as "not logged"). */
function positiveNumber(cell: ExcelJS.Cell): number | null {
  const n = numberFrom(cell);
  return n != null && n > 0 ? n : null;
}

function mapTypeToSport(type: string): 'run' | 'cross_train' | 'other' {
  const t = type.toLowerCase();
  if (/bike|cycl|swim|aqua|elliptical|pool|cross/.test(t)) return 'cross_train';
  if (/rest|hike|off\b/.test(t)) return 'other';
  return 'run';
}

/**
 * Parse a "Log Pace Per Mile" cell → sec/km. These logs store the ACTUAL pace
 * as an Excel TIME value (a 1899-epoch Date where hours=minutes-of-pace,
 * minutes=seconds-of-pace, e.g. 06:52:00 → 6:52/mi). Falls back to a "M:SS"
 * string if present.
 */
function parsePaceCell(cell: ExcelJS.Cell): number | null {
  const v = cell.value;
  let secPerMile: number | null = null;
  if (v instanceof Date) {
    secPerMile = v.getUTCHours() * 60 + v.getUTCMinutes(); // h=min, m=sec
  } else {
    const m = String(typeof v === 'string' ? v : (cell.text ?? '')).match(/(\d{1,2}):(\d{2})/);
    if (m) secPerMile = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  return secPerMile != null && secPerMile > 240 && secPerMile < 900 ? secPerMile / MI_TO_KM : null;
}

function parseFlatSheet(ws: ExcelJS.Worksheet): ParsedDay[] {
  const headerRow = flatHeaderRow(ws)!;
  const cols = mapFlatColumns(ws.getRow(headerRow));
  if (cols.date == null) return [];

  const days: ParsedDay[] = [];
  const lastRow = ws.actualRowCount || ws.rowCount;
  for (let r = headerRow + 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const dateVal = row.getCell(cols.date).value;
    const date = dateVal instanceof Date ? dateVal.toISOString().slice(0, 10) : null;
    if (!date) continue;

    const type = cols.type ? cellText(row.getCell(cols.type)) : '';
    const description = cols.description ? cellText(row.getCell(cols.description)) : '';
    const logged = cols.logged ? numberFrom(row.getCell(cols.logged)) : null;
    const assigned = cols.assigned ? numberFrom(row.getCell(cols.assigned)) : null;
    const sport = mapTypeToSport(type);
    // Use the dedicated ACTUAL-pace column when present; only fall back to
    // parsing an assigned "@ pace" from the text when there is no pace column.
    const avgPaceSecPerKm =
      cols.pace != null
        ? parsePaceCell(row.getCell(cols.pace))
        : /easy|maintenance|recovery|long|aerobic/i.test(type)
          ? parseAtPace(description)
          : null;
    const actualMiles = logged != null && logged > 0 ? logged : null;

    days.push({
      date,
      dayName: '',
      sheetName: ws.name,
      sport,
      assignedMiles: assigned != null ? { value: assigned, lo: assigned, hi: assigned, wasDateBug: false } : null,
      actualMiles,
      workout: [type, description].filter(Boolean).join(' — '),
      warmup: '',
      cooldown: '',
      description,
      core: '',
      avgPaceSecPerKm,
      durationSeconds:
        avgPaceSecPerKm != null && actualMiles != null
          ? Math.round(actualMiles * MI_TO_KM * avgPaceSecPerKm)
          : null,
      sleepHours: cols.sleep ? positiveNumber(row.getCell(cols.sleep)) : null,
      restingHr: cols.restingHr ? positiveNumber(row.getCell(cols.restingHr)) : null,
      feel: cols.feel ? positiveNumber(row.getCell(cols.feel)) : null,
    });
  }
  return days;
}

function numberFrom(cell: ExcelJS.Cell): number | null {
  const v = cell.value;
  if (typeof v === 'number' && isFinite(v)) return v;
  const m = cellText(cell).match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/** Parse "@ 7:08/mi" style steady-run paces → sec/km. */
function parseAtPace(desc: string): number | null {
  const m = desc.match(/@?\s*(\d{1,2}):(\d{2})\s*\/\s*mi/i);
  if (!m) return null;
  const secPerMile = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  if (secPerMile > 240 && secPerMile < 900) return secPerMile / MI_TO_KM;
  return null;
}

function parseWeekSheet(ws: ExcelJS.Worksheet, opts: ParseOptions): ParsedDay[] {
  const headerRow = findHeaderRow(ws);
  if (!headerRow) return [];

  const cols = mapColumns(ws.getRow(headerRow));
  if (cols.assigned == null && cols.workouts == null) return [];

  // Week start date comes from the header row's first cell, e.g. "4/11-4/17".
  const headerLabel = cellText(ws.getRow(headerRow).getCell(1));
  const weekStart = parseWeekStart(headerLabel, opts.year);

  const days: ParsedDay[] = [];
  const lastRow = ws.actualRowCount || ws.rowCount;
  for (let r = headerRow + 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const first = cellText(row.getCell(1)).trim().toLowerCase();
    if (!first) continue;
    const dow = WEEKDAYS[first.replace(/[^a-z]/g, '')];
    if (dow === undefined) continue; // skip "Total Miles", "Things to think about", etc.

    const date = weekStart ? dateForDow(weekStart, dow) : null;
    if (!date) continue;

    const workout = cols.workouts ? cellText(row.getCell(cols.workouts)) : '';
    const description = cols.description ? cellText(row.getCell(cols.description)) : '';
    const assigned = cols.assigned ? parseMiles(row.getCell(cols.assigned)) : null;
    const actual = cols.actual ? parseMiles(row.getCell(cols.actual)) : null;
    const avgPaceSecPerKm = parseAvgPace(description);
    const actualMiles = actual?.value ?? null;

    days.push({
      date,
      dayName: capitalize(first),
      sheetName: ws.name,
      sport: detectSport(`${workout} ${description}`),
      assignedMiles: assigned,
      actualMiles,
      workout,
      warmup: cols.warmup ? cellText(row.getCell(cols.warmup)) : '',
      cooldown: cols.cooldown ? cellText(row.getCell(cols.cooldown)) : '',
      description,
      core: cols.core ? cellText(row.getCell(cols.core)) : '',
      avgPaceSecPerKm,
      durationSeconds:
        avgPaceSecPerKm != null && actualMiles != null
          ? Math.round(actualMiles * MI_TO_KM * avgPaceSecPerKm)
          : null,
    });
  }
  return days;
}

// --- column + header detection ---

interface ColMap {
  warmup?: number;
  workouts?: number;
  cooldown?: number;
  assigned?: number;
  actual?: number;
  description?: number;
  core?: number;
}

function findHeaderRow(ws: ExcelJS.Worksheet): number | null {
  const max = Math.min(ws.rowCount || 5, 5);
  for (let r = 1; r <= max; r++) {
    const joined = rowText(ws.getRow(r)).toLowerCase();
    if (joined.includes('assigned miles') || joined.includes('workouts')) return r;
  }
  return null;
}

function mapColumns(row: ExcelJS.Row): ColMap {
  const cols: ColMap = {};
  row.eachCell((cell, c) => {
    const t = cellText(cell).toLowerCase();
    if (t.includes('w/u') || t.startsWith('warm')) cols.warmup = c;
    else if (t.includes('workout')) cols.workouts = c;
    else if (t.includes('c/d') || t.startsWith('cool')) cols.cooldown = c;
    else if (t.includes('assigned')) cols.assigned = c;
    else if (t.includes('actual')) cols.actual = c;
    else if (t.includes('run description') || t === 'description') cols.description = c;
    else if (t.includes('core')) cols.core = c;
  });
  return cols;
}

// --- mileage parsing (incl. the date-coercion reversal) ---

export function parseMiles(cell: ExcelJS.Cell): MileValue | null {
  const v = cell.value;

  // The date-coercion bug: a date in a mileage column is really "M-D" miles.
  if (v instanceof Date) {
    const lo = v.getUTCMonth() + 1;
    const hi = v.getUTCDate();
    if (lo >= 1 && hi >= 1 && lo <= hi && hi <= 31) {
      return { value: (lo + hi) / 2, lo, hi, wasDateBug: true };
    }
  }

  if (typeof v === 'number' && isFinite(v)) {
    return { value: v, lo: v, hi: v, wasDateBug: false };
  }

  const s = cellText(cell).trim();
  if (!s) return null;

  // Range like "11-12", "7-7.5", "64-66.5", "7.5-8.5"
  const range = s.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
  if (range) {
    const lo = parseFloat(range[1]);
    const hi = parseFloat(range[2]);
    return { value: (lo + hi) / 2, lo, hi, wasDateBug: false };
  }

  const single = s.match(/^(\d+(?:\.\d+)?)/);
  if (single) {
    const n = parseFloat(single[1]);
    return { value: n, lo: n, hi: n, wasDateBug: false };
  }
  return null;
}

// --- date inference ---

interface MD {
  month: number;
  day: number;
  year: number;
}

export function parseWeekStart(label: string, year: number): MD | null {
  const m = label.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (!m) return null;
  return { month: parseInt(m[1], 10), day: parseInt(m[2], 10), year };
}

function dateForDow(start: MD, targetDow: number): string {
  const startUtc = Date.UTC(start.year, start.month - 1, start.day);
  const startDow = new Date(startUtc).getUTCDay(); // 0=Sun
  const offset = (targetDow - startDow + 7) % 7;
  return new Date(startUtc + offset * 86400000).toISOString().slice(0, 10);
}

// --- text + pace helpers ---

/**
 * Best-effort average pace, ONLY when the text marks it as an average/flat pace
 * (so we don't mistake interval split times like "3:32/2:33" for a run pace).
 */
export function parseAvgPace(desc: string): number | null {
  if (!desc) return null;
  const patterns = [
    /avg\.?\s*(\d{1,2}):(\d{2})/i,
    /(\d{1,2}):(\d{2})\s*avg/i,
    /(\d{1,2})\s*flat/i, // "7 flat" → 7:00
  ];
  for (const re of patterns) {
    const m = desc.match(re);
    if (m) {
      const min = parseInt(m[1], 10);
      const sec = m[2] ? parseInt(m[2], 10) : 0;
      const secPerMile = min * 60 + sec;
      if (secPerMile > 240 && secPerMile < 900) return secPerMile / MI_TO_KM; // 4:00–15:00/mi sanity
    }
  }
  return null;
}

function detectSport(text: string): 'run' | 'cross_train' | 'other' {
  const t = text.toLowerCase();
  if (/aquajog|pool run|elliptical|bike|spin|cycling/.test(t)) return 'cross_train';
  if (/\bhik(e|ing)\b|swim|rest day/.test(t)) return 'other';
  return 'run';
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // rich text / formula results
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((p) => p.text).join('');
    if ('result' in v) return String(v.result ?? '');
    if ('text' in v) return String((v as { text: unknown }).text ?? '');
  }
  return cell.text ?? '';
}

function rowText(row: ExcelJS.Row): string {
  const parts: string[] = [];
  row.eachCell((c) => parts.push(cellText(c)));
  return parts.join(' | ');
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
