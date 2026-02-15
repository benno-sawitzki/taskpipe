import chalk from 'chalk';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { execSync } from 'child_process';
import { ask, choose, confirm, multiSelect } from '../prompt';
import { loadConfig, saveConfig, isInitialized, initStore } from '../utils/store';

const TASKPIPE_DIR = '.taskpipe';
const SETUP_CONFIG_FILE = path.join(TASKPIPE_DIR, 'config.yaml');

interface SetupConfig {
  notifications: {
    channel: string;
    slack?: { webhookUrl: string };
    discord?: { webhookUrl: string };
    email?: { smtp: string; to: string };
    webhook?: { url: string; method: string };
    terminal?: { sound: boolean };
  };
  schedule: {
    timezone: string;
    workDays: number[];
    workHours: { start: string; end: string };
    checkins: {
      morning: { enabled: boolean; time: string };
      midday: { enabled: boolean; time: string };
      afternoon: { enabled: boolean; time: string };
      evening: { enabled: boolean; time: string };
    };
  };
  nudges: {
    streakProtection: boolean;
    staleTasks: boolean;
    quickWins: boolean;
    cooldownAlerts: boolean;
  };
  integrations: {
    contentq: boolean;
    leadpipe: boolean;
  };
}

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

function getDefaultSetupConfig(): SetupConfig {
  return {
    notifications: {
      channel: 'none',
      terminal: { sound: true },
    },
    schedule: {
      timezone: detectTimezone(),
      workDays: [1, 2, 3, 4, 5],
      workHours: { start: '08:00', end: '18:00' },
      checkins: {
        morning: { enabled: true, time: '08:30' },
        midday: { enabled: true, time: '12:30' },
        afternoon: { enabled: false, time: '16:00' },
        evening: { enabled: true, time: '18:00' },
      },
    },
    nudges: {
      streakProtection: true,
      staleTasks: true,
      quickWins: true,
      cooldownAlerts: true,
    },
    integrations: {
      contentq: false,
      leadpipe: false,
    },
  };
}

function loadSetupConfig(): SetupConfig | null {
  try {
    const raw = yaml.load(fs.readFileSync(SETUP_CONFIG_FILE, 'utf-8')) as any;
    if (raw && raw.notifications) return raw as SetupConfig;
    return null;
  } catch {
    return null;
  }
}

function saveSetupConfig(setup: SetupConfig): void {
  // Merge with existing config
  let existing: any = {};
  try {
    existing = yaml.load(fs.readFileSync(SETUP_CONFIG_FILE, 'utf-8')) || {};
  } catch {}
  const merged = { ...existing, ...setup };
  fs.writeFileSync(SETUP_CONFIG_FILE, yaml.dump(merged, { lineWidth: -1 }));
}

export async function runSetup(): Promise<void> {
  if (!isInitialized()) initStore();

  console.log(chalk.bold.cyan('\n  🔧 Taskpipe Setup Wizard\n'));

  const config = getDefaultSetupConfig();

  // 1. Notification Channel
  console.log(chalk.bold('  1. Notification Channel'));
  const channelIdx = await choose('  How should I reach you?', [
    'Terminal notifications (macOS/Linux native)',
    'Slack webhook',
    'Discord webhook',
    'Email digest (via SMTP)',
    'Webhook (custom URL)',
    'None (CLI only)',
  ]);
  const channels = ['terminal', 'slack', 'discord', 'email', 'webhook', 'none'];
  config.notifications.channel = channels[channelIdx];

  if (config.notifications.channel === 'slack') {
    const url = await ask('  Slack webhook URL: ');
    config.notifications.slack = { webhookUrl: url };
  } else if (config.notifications.channel === 'discord') {
    const url = await ask('  Discord webhook URL: ');
    config.notifications.discord = { webhookUrl: url };
  } else if (config.notifications.channel === 'email') {
    const smtp = await ask('  SMTP URL (smtp://user:pass@host:port): ');
    const to = await ask('  Recipient email: ');
    config.notifications.email = { smtp, to };
  } else if (config.notifications.channel === 'webhook') {
    const url = await ask('  Webhook URL: ');
    const method = await ask('  HTTP method (POST): ') || 'POST';
    config.notifications.webhook = { url, method };
  } else if (config.notifications.channel === 'terminal') {
    const sound = await confirm('  Play sound on notification?', true);
    config.notifications.terminal = { sound };
  }

  console.log('');

  // 2. Check-in Schedule
  console.log(chalk.bold('  2. Check-in Schedule'));
  const checkinResults = await multiSelect('  When should I check in?', [
    { label: 'Morning briefing — 8:30am', default: true },
    { label: 'Midday pulse — 12:30pm', default: true },
    { label: 'Afternoon nudge — 4:00pm', default: false },
    { label: 'End of day wrap — 6:00pm', default: true },
  ]);
  config.schedule.checkins.morning.enabled = checkinResults[0];
  config.schedule.checkins.midday.enabled = checkinResults[1];
  config.schedule.checkins.afternoon.enabled = checkinResults[2];
  config.schedule.checkins.evening.enabled = checkinResults[3];

  const customTimes = await confirm('  Customize times?', false);
  if (customTimes) {
    if (config.schedule.checkins.morning.enabled) {
      config.schedule.checkins.morning.time = await ask('  Morning time (HH:MM): ') || '08:30';
    }
    if (config.schedule.checkins.midday.enabled) {
      config.schedule.checkins.midday.time = await ask('  Midday time (HH:MM): ') || '12:30';
    }
    if (config.schedule.checkins.afternoon.enabled) {
      config.schedule.checkins.afternoon.time = await ask('  Afternoon time (HH:MM): ') || '16:00';
    }
    if (config.schedule.checkins.evening.enabled) {
      config.schedule.checkins.evening.time = await ask('  Evening time (HH:MM): ') || '18:00';
    }
  }

  console.log('');

  // 3. Smart Nudges
  console.log(chalk.bold('  3. Smart Nudges'));
  const nudgeResults = await multiSelect('  Which nudges do you want?', [
    { label: 'Streak protection — nudge if streak about to break', default: true },
    { label: 'Stale tasks — alert on tasks overdue 2+ days', default: true },
    { label: 'Quick wins — suggest easy tasks during low energy', default: true },
    { label: 'Cooldown alerts — suggest breaks after 3+ hard tasks', default: true },
  ]);
  config.nudges.streakProtection = nudgeResults[0];
  config.nudges.staleTasks = nudgeResults[1];
  config.nudges.quickWins = nudgeResults[2];
  config.nudges.cooldownAlerts = nudgeResults[3];

  console.log('');

  // 4. Work Schedule
  console.log(chalk.bold('  4. Work Schedule'));
  const tz = detectTimezone();
  const useDetected = await confirm(`  Timezone detected: ${tz}. Use this?`, true);
  config.schedule.timezone = useDetected ? tz : (await ask('  Enter timezone: ') || tz);

  const workDays = await ask('  Work days (e.g. Mon-Fri or Mon,Tue,Wed): ') || 'Mon-Fri';
  config.schedule.workDays = parseWorkDays(workDays);

  const startHour = await ask('  Work start time (08:00): ') || '08:00';
  const endHour = await ask('  Work end time (18:00): ') || '18:00';
  config.schedule.workHours = { start: startHour, end: endHour };

  console.log('');

  // 5. Integration Check
  console.log(chalk.bold('  5. Integration Check'));
  console.log('  Checking for other tools...');
  if (fs.existsSync('.contentq') || fs.existsSync('.contentq/')) {
    console.log(chalk.green('  ✅ contentq detected (.contentq/)'));
    config.integrations.contentq = true;
  } else {
    console.log(chalk.gray('  ○ contentq not found'));
  }
  if (fs.existsSync('.leadpipe') || fs.existsSync('.leadpipe/')) {
    console.log(chalk.green('  ✅ leadpipe detected (.leadpipe/)'));
    config.integrations.leadpipe = true;
  } else {
    console.log(chalk.gray('  ○ leadpipe not found'));
  }
  if (config.integrations.contentq || config.integrations.leadpipe) {
    console.log(chalk.cyan('  → Ghost tasks enabled (auto-suggest from leads + content)'));
  }

  console.log('');

  // 6. Adaptive Timing
  console.log(chalk.bold('  6. Adaptive Timing (Optional)'));
  console.log(chalk.gray('  Taskpipe can learn your schedule by tracking when you use commands'));
  console.log(chalk.gray('  and adjusts check-in times over time.\n'));
  const enableAdaptive = await confirm('  Enable adaptive timing?', true);
  if (enableAdaptive) {
    (config as any).adaptive = {
      enabled: true,
      minDataPoints: 5,
      autoApply: false,
    };
    const autoApply = await confirm('  Auto-apply schedule changes without asking?', false);
    if (autoApply) (config as any).adaptive.autoApply = true;
    console.log(chalk.green('  ✓ Adaptive timing enabled'));
  } else {
    (config as any).adaptive = { enabled: false, minDataPoints: 5, autoApply: false };
  }

  console.log('');

  // Save
  saveSetupConfig(config);
  console.log(chalk.green.bold('  Done! ✨'));
  console.log(chalk.gray(`  Your setup is saved in ${SETUP_CONFIG_FILE}\n`));

  // Crontab
  if (config.notifications.channel !== 'none') {
    const installCron = await confirm('  Install system cron jobs for check-ins?', false);
    if (installCron) {
      installCronJobs(config);
    }
  }
}

export function showSetupStatus(): void {
  const setup = loadSetupConfig();
  if (!setup) {
    console.log(chalk.gray('  No setup configured. Run: taskpipe setup'));
    return;
  }

  console.log(chalk.bold.cyan('\n  🔧 Taskpipe Setup Status\n'));

  console.log(chalk.bold('  Notifications:'));
  console.log(`    Channel: ${chalk.cyan(setup.notifications.channel)}`);
  if (setup.notifications.channel === 'slack' && setup.notifications.slack) {
    console.log(`    Webhook: ${chalk.gray(setup.notifications.slack.webhookUrl.substring(0, 40) + '...')}`);
  }
  if (setup.notifications.channel === 'discord' && setup.notifications.discord) {
    console.log(`    Webhook: ${chalk.gray(setup.notifications.discord.webhookUrl.substring(0, 40) + '...')}`);
  }

  console.log(chalk.bold('\n  Schedule:'));
  console.log(`    Timezone: ${setup.schedule.timezone}`);
  const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  console.log(`    Work days: ${setup.schedule.workDays.map(d => dayNames[d]).join(', ')}`);
  console.log(`    Work hours: ${setup.schedule.workHours.start}–${setup.schedule.workHours.end}`);

  console.log(chalk.bold('\n  Check-ins:'));
  const ci = setup.schedule.checkins;
  const checkins = [
    { name: 'Morning', ...ci.morning },
    { name: 'Midday', ...ci.midday },
    { name: 'Afternoon', ...ci.afternoon },
    { name: 'Evening', ...ci.evening },
  ];
  checkins.forEach(c => {
    const status = c.enabled ? chalk.green('✓') : chalk.gray('○');
    console.log(`    ${status} ${c.name} — ${c.time}`);
  });

  console.log(chalk.bold('\n  Nudges:'));
  const nudgeItems = [
    { name: 'Streak protection', val: setup.nudges.streakProtection },
    { name: 'Stale tasks', val: setup.nudges.staleTasks },
    { name: 'Quick wins', val: setup.nudges.quickWins },
    { name: 'Cooldown alerts', val: setup.nudges.cooldownAlerts },
  ];
  nudgeItems.forEach(n => {
    console.log(`    ${n.val ? chalk.green('✓') : chalk.gray('○')} ${n.name}`);
  });

  console.log(chalk.bold('\n  Integrations:'));
  console.log(`    contentq: ${setup.integrations.contentq ? chalk.green('✓') : chalk.gray('○')}`);
  console.log(`    leadpipe: ${setup.integrations.leadpipe ? chalk.green('✓') : chalk.gray('○')}`);
  console.log('');
}

export function resetSetup(): void {
  // Remove cron entries
  try {
    const existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' });
    const filtered = existing.split('\n').filter(l => !l.includes('# taskpipe')).join('\n');
    execSync('crontab -', { input: filtered, encoding: 'utf-8' });
    console.log(chalk.green('  ✓ Removed taskpipe cron entries'));
  } catch {}

  // Reset config to defaults
  const defaults = getDefaultSetupConfig();
  saveSetupConfig(defaults);
  console.log(chalk.green('  ✓ Setup reset to defaults'));
}

function parseWorkDays(input: string): number[] {
  const dayMap: Record<string, number> = {
    mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7,
  };
  // Handle range like Mon-Fri
  const rangeMatch = input.match(/^(\w{3})-(\w{3})$/i);
  if (rangeMatch) {
    const start = dayMap[rangeMatch[1].toLowerCase()];
    const end = dayMap[rangeMatch[2].toLowerCase()];
    if (start && end) {
      const days: number[] = [];
      for (let i = start; i <= end; i++) days.push(i);
      return days;
    }
  }
  // Handle comma-separated
  const parts = input.split(',').map(s => s.trim().toLowerCase());
  const days = parts.map(p => dayMap[p.substring(0, 3)]).filter(Boolean);
  return days.length > 0 ? days : [1, 2, 3, 4, 5];
}

function installCronJobs(config: SetupConfig): void {
  try {
    // Get taskpipe path
    let taskpipePath: string;
    try {
      taskpipePath = execSync('which taskpipe', { encoding: 'utf-8' }).trim();
    } catch {
      taskpipePath = 'taskpipe';
    }

    let existing = '';
    try {
      existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' });
    } catch {}

    // Remove old taskpipe entries
    const lines = existing.split('\n').filter(l => !l.includes('# taskpipe'));

    const ci = config.schedule.checkins;
    const entries: string[] = [];

    if (ci.morning.enabled) {
      const [h, m] = ci.morning.time.split(':');
      entries.push(`${m} ${h} * * 1-5 ${taskpipePath} briefing | ${taskpipePath} notify # taskpipe`);
    }
    if (ci.midday.enabled) {
      const [h, m] = ci.midday.time.split(':');
      entries.push(`${m} ${h} * * 1-5 ${taskpipePath} wins && ${taskpipePath} list --today | ${taskpipePath} notify # taskpipe`);
    }
    if (ci.evening.enabled) {
      const [h, m] = ci.evening.time.split(':');
      entries.push(`${m} ${h} * * 1-5 ${taskpipePath} wins && ${taskpipePath} streak | ${taskpipePath} notify # taskpipe`);
    }
    if (ci.afternoon.enabled) {
      const [h, m] = ci.afternoon.time.split(':');
      entries.push(`${m} ${h} * * 1-5 ${taskpipePath} stuck | ${taskpipePath} notify # taskpipe`);
    }

    const newCrontab = [...lines.filter(l => l.trim()), ...entries].join('\n') + '\n';
    execSync('crontab -', { input: newCrontab, encoding: 'utf-8' });

    console.log(chalk.green(`  ✓ Installed ${entries.length} cron job${entries.length !== 1 ? 's' : ''}`));
    entries.forEach(e => console.log(chalk.gray(`    ${e}`)));
  } catch (err: any) {
    console.error(chalk.red(`  ✗ Failed to install cron jobs: ${err.message}`));
  }
}
