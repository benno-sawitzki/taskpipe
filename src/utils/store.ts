import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Task, Config, Patterns, GhostTask } from '../types';

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

export function loadTasks(): Task[] {
  ensureInit();
  return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
}

export function saveTasks(tasks: Task[]): void {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

export function loadConfig(): Config {
  ensureInit();
  return yaml.load(fs.readFileSync(CONFIG_FILE, 'utf-8')) as Config;
}

export function saveConfig(config: Config): void {
  fs.writeFileSync(CONFIG_FILE, yaml.dump(config));
}

export function loadPatterns(): Patterns {
  ensureInit();
  return JSON.parse(fs.readFileSync(PATTERNS_FILE, 'utf-8'));
}

export function savePatterns(patterns: Patterns): void {
  fs.writeFileSync(PATTERNS_FILE, JSON.stringify(patterns, null, 2));
}

export function loadGhosts(): GhostTask[] {
  ensureInit();
  return JSON.parse(fs.readFileSync(GHOSTS_FILE, 'utf-8'));
}

export function saveGhosts(ghosts: GhostTask[]): void {
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
