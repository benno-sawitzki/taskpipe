import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Task, Config, Patterns, GhostTask } from '../types';
import { isCloudMode, getClient } from '@openbrain/cli-client';

const TASKPIPE_DIR = '.taskpipe';
const TASKS_FILE = path.join(TASKPIPE_DIR, 'tasks.json');
const CONFIG_FILE = path.join(TASKPIPE_DIR, 'config.yaml');
const PATTERNS_FILE = path.join(TASKPIPE_DIR, 'patterns.json');
const GHOSTS_FILE = path.join(TASKPIPE_DIR, 'ghosts.json');

export function ensureInit(): void {
  if (!fs.existsSync(TASKPIPE_DIR)) {
    console.error('Not initialized. Run: taskpipe init');
    process.exit(1);
  }
}

export function isInitialized(): boolean {
  return fs.existsSync(TASKPIPE_DIR);
}

export function initStore(): void {
  if (!fs.existsSync(TASKPIPE_DIR)) {
    fs.mkdirSync(TASKPIPE_DIR, { recursive: true });
    fs.mkdirSync(path.join(TASKPIPE_DIR, 'templates'), { recursive: true });
  }
  if (!fs.existsSync(TASKS_FILE)) {
    fs.writeFileSync(TASKS_FILE, '[]');
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    const defaultConfig: Config = {
      focus: null,
      energy: { schedule: { morning: 'high', afternoon: 'medium', evening: 'low' } },
      streaks: { current: 0, best: 0, lastCompletionDate: null },
      stale: { days: 3 },
      buddy: { enabled: false, intervalMinutes: 30 },
      campaigns: [],
    };
    fs.writeFileSync(CONFIG_FILE, yaml.dump(defaultConfig));
  }
  if (!fs.existsSync(PATTERNS_FILE)) {
    fs.writeFileSync(PATTERNS_FILE, JSON.stringify({ completions: [], dailyCompletions: {} }, null, 2));
  }
  if (!fs.existsSync(GHOSTS_FILE)) {
    fs.writeFileSync(GHOSTS_FILE, '[]');
  }
}

export async function loadTasks(): Promise<Task[]> {
  if (isCloudMode()) return getClient().listTasks();
  ensureInit();
  return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
}

export async function saveTasks(tasks: Task[]): Promise<void> {
  if (isCloudMode()) { await getClient().bulkWriteTasks(tasks); return; }
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

export async function loadConfig(): Promise<Config> {
  if (isCloudMode()) return getClient().getConfig('taskpipe');
  ensureInit();
  return yaml.load(fs.readFileSync(CONFIG_FILE, 'utf-8')) as Config;
}

export async function saveConfig(config: Config): Promise<void> {
  if (isCloudMode()) { await getClient().writeConfig('taskpipe', config); return; }
  fs.writeFileSync(CONFIG_FILE, yaml.dump(config));
}

export async function loadPatterns(): Promise<Patterns> {
  if (isCloudMode()) return getClient().getPatterns();
  ensureInit();
  return JSON.parse(fs.readFileSync(PATTERNS_FILE, 'utf-8'));
}

export async function savePatterns(patterns: Patterns): Promise<void> {
  if (isCloudMode()) { await getClient().writePatterns(patterns); return; }
  fs.writeFileSync(PATTERNS_FILE, JSON.stringify(patterns, null, 2));
}

export async function loadGhosts(): Promise<GhostTask[]> {
  if (isCloudMode()) return []; // ghosts are local-only
  ensureInit();
  return JSON.parse(fs.readFileSync(GHOSTS_FILE, 'utf-8'));
}

export async function saveGhosts(ghosts: GhostTask[]): Promise<void> {
  if (isCloudMode()) return; // ghosts are local-only
  fs.writeFileSync(GHOSTS_FILE, JSON.stringify(ghosts, null, 2));
}

export function findTask(tasks: Task[], idPrefix: string): Task | undefined {
  return tasks.find(t => t.id.startsWith(idPrefix));
}

export function today(): string {
  return new Date().toISOString().split('T')[0];
}

export function parseDate(input: string): string {
  const now = new Date();
  const lower = input.toLowerCase();
  if (lower === 'today') return today();
  if (lower === 'tomorrow') {
    now.setDate(now.getDate() + 1);
    return now.toISOString().split('T')[0];
  }
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayIdx = days.indexOf(lower);
  if (dayIdx >= 0) {
    const diff = (dayIdx - now.getDay() + 7) % 7 || 7;
    now.setDate(now.getDate() + diff);
    return now.toISOString().split('T')[0];
  }
  // Try ISO parse
  const d = new Date(input);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return input;
}
