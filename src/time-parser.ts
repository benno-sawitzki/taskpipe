/**
 * Parse human-friendly time expressions into ISO datetime strings.
 */

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function parseTime(input: string): string | null {
  const trimmed = input.trim().toLowerCase();

  // "in Xm", "in Xh", "in Xd", "in Xw"
  const relMatch = trimmed.match(/^in\s+(\d+)\s*(m|min|h|hr|hours?|d|days?|w|weeks?)$/);
  if (relMatch) {
    const n = parseInt(relMatch[1]);
    const unit = relMatch[2][0]; // m, h, d, w
    const now = new Date();
    if (unit === 'm') now.setMinutes(now.getMinutes() + n);
    else if (unit === 'h') now.setHours(now.getHours() + n);
    else if (unit === 'd') now.setDate(now.getDate() + n);
    else if (unit === 'w') now.setDate(now.getDate() + n * 7);
    return now.toISOString();
  }

  // "tonight"
  if (trimmed === 'tonight') {
    const d = new Date();
    d.setHours(20, 0, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }

  // "tomorrow" or "tomorrow 9am"
  if (trimmed.startsWith('tomorrow')) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const timeStr = trimmed.replace('tomorrow', '').trim();
    if (timeStr) {
      const t = parseTimeOfDay(timeStr);
      if (t) { d.setHours(t.h, t.m, 0, 0); }
      else { d.setHours(9, 0, 0, 0); }
    } else {
      d.setHours(9, 0, 0, 0);
    }
    return d.toISOString();
  }

  // Day name: "monday", "tuesday 10am"
  const dayParts = trimmed.split(/\s+/);
  const dayIdx = DAYS.indexOf(dayParts[0]);
  if (dayIdx >= 0) {
    const d = new Date();
    const diff = (dayIdx - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    const timeStr = dayParts.slice(1).join(' ');
    if (timeStr) {
      const t = parseTimeOfDay(timeStr);
      if (t) d.setHours(t.h, t.m, 0, 0);
      else d.setHours(9, 0, 0, 0);
    } else {
      d.setHours(9, 0, 0, 0);
    }
    return d.toISOString();
  }

  // ISO datetime "2026-02-15T15:00" or "2026-02-15 15:00"
  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}:\d{2})$/);
  if (isoMatch) {
    const d = new Date(`${isoMatch[1]}T${isoMatch[2]}:00`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Plain ISO date "2026-02-15"
  const dateOnly = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnly) {
    const d = new Date(`${dateOnly[1]}T09:00:00`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Try native Date parse as fallback
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d.toISOString();

  return null;
}

function parseTimeOfDay(s: string): { h: number; m: number } | null {
  // "9am", "10am", "3pm", "10:30am", "14:00"
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = ampm[2] ? parseInt(ampm[2]) : 0;
    if (ampm[3] === 'pm' && h < 12) h += 12;
    if (ampm[3] === 'am' && h === 12) h = 0;
    return { h, m };
  }
  const mil = s.match(/^(\d{1,2}):(\d{2})$/);
  if (mil) return { h: parseInt(mil[1]), m: parseInt(mil[2]) };
  return null;
}
