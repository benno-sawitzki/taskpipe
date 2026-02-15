import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const TASKPIPE_DIR = '.taskpipe';
const ACTIVITY_FILE = path.join(TASKPIPE_DIR, 'activity.json');

interface ActivityEvent {
  ts: string;
  source: string;
  type: string;
}

interface DailySummary {
  firstActive: string;
  lastActive: string;
  eventCount: number;
}

interface ActivityProfile {
  avgFirstActive: string;
  avgLastActive: string;
  avgMidpoint: string;
  weekday: { avgFirstActive: string; avgLastActive: string };
  weekend: { avgFirstActive: string; avgLastActive: string };
  confidence: number;
  dataPoints: number;
  lastComputed: string;
}

interface ActivityData {
  events: ActivityEvent[];
  dailySummary: Record<string, DailySummary>;
  profile: ActivityProfile | null;
}

function getDefaultData(): ActivityData {
  return { events: [], dailySummary: {}, profile: null };
}

function loadActivity(): ActivityData {
  try {
    return JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf-8'));
  } catch {
    return getDefaultData();
  }
}

function saveActivity(data: ActivityData): void {
  if (!fs.existsSync(TASKPIPE_DIR)) fs.mkdirSync(TASKPIPE_DIR, { recursive: true });
  fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(data, null, 2));
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatTime12h(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}:00${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

function pruneData(data: ActivityData): void {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  // Prune events older than 30 days
  data.events = data.events.filter(e => new Date(e.ts) >= thirtyDaysAgo);

  // Prune daily summaries older than 90 days
  const cutoff = ninetyDaysAgo.toISOString().split('T')[0];
  for (const key of Object.keys(data.dailySummary)) {
    if (key < cutoff) delete data.dailySummary[key];
  }
}

export function logActivity(source: string, type: string, timestamp?: string): void {
  const data = loadActivity();
  const ts = timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();
  const date = new Date(ts);

  // Add event
  data.events.push({ ts, source, type });

  // Update daily summary
  const dayKey = date.toISOString().split('T')[0];
  const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  if (!data.dailySummary[dayKey]) {
    data.dailySummary[dayKey] = { firstActive: timeStr, lastActive: timeStr, eventCount: 1 };
  } else {
    const summary = data.dailySummary[dayKey];
    if (timeStr < summary.firstActive) summary.firstActive = timeStr;
    if (timeStr > summary.lastActive) summary.lastActive = timeStr;
    summary.eventCount += 1;
  }

  pruneData(data);
  saveActivity(data);
}

export function computeProfile(): ActivityProfile | null {
  const data = loadActivity();
  const days = Object.keys(data.dailySummary).sort();
  if (days.length === 0) return null;

  const weekdayFirst: number[] = [];
  const weekdayLast: number[] = [];
  const weekendFirst: number[] = [];
  const weekendLast: number[] = [];
  const allFirst: number[] = [];
  const allLast: number[] = [];

  for (const day of days) {
    const s = data.dailySummary[day];
    const d = new Date(day + 'T12:00:00');
    const dow = d.getDay();
    const isWeekend = dow === 0 || dow === 6;

    const first = timeToMinutes(s.firstActive);
    const last = timeToMinutes(s.lastActive);
    allFirst.push(first);
    allLast.push(last);

    if (isWeekend) {
      weekendFirst.push(first);
      weekendLast.push(last);
    } else {
      weekdayFirst.push(first);
      weekdayLast.push(last);
    }
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const avgFirst = avg(allFirst);
  const avgLast = avg(allLast);
  const avgMid = (avgFirst + avgLast) / 2;

  const profile: ActivityProfile = {
    avgFirstActive: minutesToTime(avgFirst),
    avgLastActive: minutesToTime(avgLast),
    avgMidpoint: minutesToTime(avgMid),
    weekday: {
      avgFirstActive: minutesToTime(weekdayFirst.length ? avg(weekdayFirst) : avgFirst),
      avgLastActive: minutesToTime(weekdayLast.length ? avg(weekdayLast) : avgLast),
    },
    weekend: {
      avgFirstActive: minutesToTime(weekendFirst.length ? avg(weekendFirst) : avgFirst),
      avgLastActive: minutesToTime(weekendLast.length ? avg(weekendLast) : avgLast),
    },
    confidence: Math.min(days.length / 14, 1),
    dataPoints: days.length,
    lastComputed: new Date().toISOString(),
  };

  data.profile = profile;
  saveActivity(data);
  return profile;
}

export function getDayType(): 'weekday' | 'weekend' {
  const dow = new Date().getDay();
  return (dow === 0 || dow === 6) ? 'weekend' : 'weekday';
}

export interface AdaptiveSchedule {
  morning: string;
  midday: string;
  evening: string;
}

const DEFAULT_SCHEDULE: AdaptiveSchedule = {
  morning: '08:30',
  midday: '12:30',
  evening: '18:00',
};

export function getAdaptiveSchedule(): AdaptiveSchedule {
  const data = loadActivity();
  let profile = data.profile;
  if (!profile) profile = computeProfile();
  if (!profile || profile.confidence < 0.3) return { ...DEFAULT_SCHEDULE };

  const dayType = getDayType();
  const dayProfile = profile[dayType];

  const firstMin = timeToMinutes(dayProfile.avgFirstActive);
  const lastMin = timeToMinutes(dayProfile.avgLastActive);
  const midMin = (firstMin + lastMin) / 2;

  return {
    morning: minutesToTime(firstMin + 30),
    midday: minutesToTime(midMin),
    evening: minutesToTime(lastMin - 60),
  };
}

export function getActivityStatus(): { data: ActivityData; profile: ActivityProfile | null; schedule: AdaptiveSchedule } {
  const data = loadActivity();
  let profile = data.profile;
  if (!profile) profile = computeProfile();
  const schedule = getAdaptiveSchedule();
  return { data, profile, schedule };
}

export function resetActivity(): void {
  saveActivity(getDefaultData());
}

export { formatTime12h, loadActivity };
