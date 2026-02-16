#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { v4 as uuid } from 'uuid';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { Task, GhostTask, Reminder } from './types';
import { parseTime } from './time-parser';
import {
  initStore, loadTasks, saveTasks, loadConfig, saveConfig,
  loadPatterns, savePatterns, loadGhosts, saveGhosts,
  findTask, today, parseDate, isInitialized,
} from './utils/store';
import { formatTaskLine, formatTaskFull, printTasks, shortId } from './utils/display';
import { rankTasks, getOpenTasks, scoreTask } from './utils/scoring';
import { runSetup, showSetupStatus, resetSetup } from './commands/setup';
import { runNotify } from './commands/notify';
import {
  logActivity, computeProfile, getAdaptiveSchedule, getActivityStatus,
  resetActivity, formatTime12h, loadActivity,
} from './activity';

// Auto-log CLI activity
logActivity('cli', 'command');

const program = new Command();
program.name('taskpipe').description('Marketing task engine for the terminal').version('0.1.0');

// ─── INIT ───
program.command('init').description('Initialize taskpipe')
  .option('--cloud', 'Configure cloud mode')
  .option('--url <url>', 'Open Brain API URL')
  .option('--key <key>', 'API key')
  .action(async (opts: any) => {
    if (opts.cloud) {
      const { OpenBrainClient, saveOpenBrainConfig, getConfigPath } = await import('@openbrain/cli-client');
      const url = opts.url || process.env.OPENBRAIN_URL || 'https://openbrain.bennosan.com';
      const key = opts.key || process.env.OPENBRAIN_API_KEY;
      if (!key) { console.error(chalk.red('API key required. Use --key <key> or set OPENBRAIN_API_KEY')); process.exit(1); }
      process.stdout.write('Testing connection... ');
      try {
        const client = new OpenBrainClient(key, url);
        const ok = await client.testConnection();
        if (!ok) throw new Error('Connection failed');
        console.log(chalk.green('OK ✓'));
      } catch (e: any) { console.log(chalk.red('FAILED')); console.error(e.message); process.exit(1); }
      saveOpenBrainConfig({ api_url: url, api_key: key, mode: 'cloud' });
      console.log(chalk.green(`✓ Cloud mode configured. Config saved to ${getConfigPath()}`));
      return;
    }
    initStore();
    console.log(chalk.green('✓ Taskpipe initialized. Ready to ship.'));
  });

// ─── ADD ───
program.command('add <content>').description('Add a task')
  .option('--due <date>', 'Due date')
  .option('--energy <level>', 'Energy level', 'medium')
  .option('--priority <level>', 'Priority', 'medium')
  .option('--estimate <min>', 'Time estimate in minutes')
  .option('--campaign <name>', 'Campaign')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--stake <stake>', 'What\'s at stake')
  .option('--links <links>', 'key:value pairs comma-separated')
  .option('--json', 'JSON output')
  .action(async (content, opts) => {
    const tasks = await loadTasks();
    const links: Record<string, string | null> = {};
    if (opts.links) {
      opts.links.split(',').forEach((l: string) => {
        const [k, v] = l.split(':');
        links[k.trim()] = v?.trim() || null;
      });
    }
    const task: Task = {
      id: uuid(),
      content,
      status: 'todo',
      priority: opts.priority,
      energy: opts.energy,
      estimate: opts.estimate ? parseInt(opts.estimate) : null,
      actual: null,
      difficulty: null,
      campaign: opts.campaign || null,
      links,
      tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : [],
      stake: opts.stake || null,
      due: opts.due ? parseDate(opts.due) : null,
      delegatedTo: null,
      completedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      focusGroup: null,
      recurrence: null,
      notes: [],
    };
    tasks.push(task);
    await saveTasks(tasks);
    if (opts.json) { console.log(JSON.stringify(task, null, 2)); return; }
    console.log(chalk.green(`✓ Added: ${formatTaskLine(task)}`));
  });

// ─── LIST ───
program.command('list').description('List tasks')
  .option('--today', 'Due today or overdue')
  .option('--campaign <name>', 'Filter by campaign')
  .option('--tag <tag>', 'Filter by tag')
  .option('--energy <level>', 'Filter by energy')
  .option('--blocked', 'Show blocked tasks')
  .option('--all', 'Include done tasks')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    let tasks = await loadTasks();
    const config = await loadConfig();

    if (!opts.all) tasks = tasks.filter(t => !['done', 'skipped'].includes(t.status));
    if (opts.blocked) { tasks = tasks.filter(t => t.status === 'blocked'); }
    if (opts.today) {
      const td = today();
      tasks = tasks.filter(t => t.due && t.due <= td);
    }
    if (opts.campaign) tasks = tasks.filter(t => t.campaign?.includes(opts.campaign));
    if (opts.tag) tasks = tasks.filter(t => t.tags.includes(opts.tag));
    if (opts.energy) tasks = tasks.filter(t => t.energy === opts.energy);

    // Apply focus filter
    if (config.focus) {
      const f = config.focus.toLowerCase();
      tasks = tasks.filter(t =>
        t.content.toLowerCase().includes(f) ||
        (t.campaign && t.campaign.toLowerCase().includes(f)) ||
        t.tags.some(tag => tag.toLowerCase().includes(f))
      );
    }

    tasks = rankTasks(tasks);
    printTasks(tasks, opts.json);
  });

// ─── SHOW ───
program.command('show <id>').description('Show task details')
  .option('--json', 'JSON output')
  .action(async (id, opts) => {
    const tasks = await loadTasks();
    const task = findTask(tasks, id);
    if (!task) { console.error(chalk.red('Task not found.')); process.exit(1); }
    if (opts.json) { console.log(JSON.stringify(task, null, 2)); return; }
    console.log(formatTaskFull(task));
  });

// ─── EDIT ───
program.command('edit <id>').description('Edit a task')
  .option('--due <date>', 'Due date')
  .option('--energy <level>', 'Energy level')
  .option('--priority <level>', 'Priority')
  .option('--estimate <min>', 'Estimate')
  .option('--campaign <name>', 'Campaign')
  .option('--tags <tags>', 'Tags')
  .option('--stake <stake>', 'Stake')
  .option('--content <text>', 'Content')
  .option('--note <text>', 'Add a note')
  .option('--json', 'JSON output')
  .action(async (id, opts) => {
    const tasks = await loadTasks();
    const task = findTask(tasks, id);
    if (!task) { console.error(chalk.red('Task not found.')); process.exit(1); }
    if (opts.due) task.due = parseDate(opts.due);
    if (opts.energy) task.energy = opts.energy;
    if (opts.priority) task.priority = opts.priority;
    if (opts.estimate) task.estimate = parseInt(opts.estimate);
    if (opts.campaign) task.campaign = opts.campaign;
    if (opts.tags) task.tags = opts.tags.split(',').map((t: string) => t.trim());
    if (opts.stake) task.stake = opts.stake;
    if (opts.content) task.content = opts.content;
    if (opts.note) task.notes.push(opts.note);
    task.updatedAt = new Date().toISOString();
    await saveTasks(tasks);
    if (opts.json) { console.log(JSON.stringify(task, null, 2)); return; }
    console.log(chalk.green(`✓ Updated: ${formatTaskLine(task)}`));
  });

// ─── DELETE ───
program.command('delete <id>').description('Delete a task')
  .option('--json', 'JSON output')
  .action(async (id, opts) => {
    let tasks = await loadTasks();
    const task = findTask(tasks, id);
    if (!task) { console.error(chalk.red('Task not found.')); process.exit(1); }
    tasks = tasks.filter(t => t.id !== task.id);
    await saveTasks(tasks);
    if (opts.json) { console.log(JSON.stringify({ deleted: task.id })); return; }
    console.log(chalk.green(`✓ Deleted: ${task.content}`));
  });

// ─── DONE ───
program.command('done <id>').description('Complete a task')
  .option('--time <min>', 'Actual time spent')
  .option('--difficulty <level>', 'easy/medium/hard')
  .option('--json', 'JSON output')
  .action(async (id, opts) => {
    const tasks = await loadTasks();
    const task = findTask(tasks, id);
    if (!task) { console.error(chalk.red('Task not found.')); process.exit(1); }
    task.status = 'done';
    task.completedAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();
    if (opts.time) task.actual = parseInt(opts.time);
    if (opts.difficulty) task.difficulty = opts.difficulty;
    await saveTasks(tasks);

    // Update patterns
    const patterns = await loadPatterns();
    const now = new Date();
    patterns.completions.push({
      date: now.toISOString(),
      taskId: task.id,
      estimate: task.estimate,
      actual: task.actual,
      energy: task.energy,
      difficulty: task.difficulty,
      tags: task.tags,
      dayOfWeek: now.getDay(),
      hourOfDay: now.getHours(),
    });
    const td = today();
    patterns.dailyCompletions[td] = (patterns.dailyCompletions[td] || 0) + 1;
    await savePatterns(patterns);

    // Update streaks
    const config = await loadConfig();
    if (config.streaks.lastCompletionDate !== td) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yd = yesterday.toISOString().split('T')[0];
      if (config.streaks.lastCompletionDate === yd) {
        config.streaks.current += 1;
      } else if (config.streaks.lastCompletionDate !== td) {
        config.streaks.current = 1;
      }
      config.streaks.lastCompletionDate = td;
      if (config.streaks.current > config.streaks.best) config.streaks.best = config.streaks.current;
      await saveConfig(config);
    }

    if (opts.json) { console.log(JSON.stringify(task, null, 2)); return; }
    console.log(chalk.green.bold(`🎉 Done: ${task.content}`));
    if (task.actual && task.estimate) {
      const ratio = task.actual / task.estimate;
      if (ratio > 1.5) console.log(chalk.yellow(`  ⏱ Took ${task.actual}m vs ${task.estimate}m estimate — tracking for insights`));
      else if (ratio < 0.7) console.log(chalk.cyan(`  ⚡ Faster than expected! ${task.actual}m vs ${task.estimate}m`));
    }
  });

// ─── BLOCK / UNBLOCK ───
program.command('block <id> [reason]').description('Block a task')
  .option('--json', 'JSON output')
  .action(async (id, reason, opts) => {
    const tasks = await loadTasks();
    const task = findTask(tasks, id);
    if (!task) { console.error(chalk.red('Task not found.')); process.exit(1); }
    task.status = 'blocked';
    task.blockedReason = reason || 'No reason given';
    task.updatedAt = new Date().toISOString();
    await saveTasks(tasks);
    if (opts.json) { console.log(JSON.stringify(task, null, 2)); return; }
    console.log(chalk.yellow(`🚫 Blocked: ${task.content} — ${task.blockedReason}`));
  });

program.command('unblock <id>').description('Unblock a task')
  .option('--json', 'JSON output')
  .action(async (id, opts) => {
    const tasks = await loadTasks();
    const task = findTask(tasks, id);
    if (!task) { console.error(chalk.red('Task not found.')); process.exit(1); }
    task.status = 'todo';
    task.blockedReason = undefined;
    task.updatedAt = new Date().toISOString();
    await saveTasks(tasks);
    if (opts.json) { console.log(JSON.stringify(task, null, 2)); return; }
    console.log(chalk.green(`✓ Unblocked: ${task.content}`));
  });

// ─── DELEGATE ───
program.command('delegate <id>').description('Delegate a task')
  .requiredOption('--to <person>', 'Delegate to')
  .option('--json', 'JSON output')
  .action(async (id, opts) => {
    const tasks = await loadTasks();
    const task = findTask(tasks, id);
    if (!task) { console.error(chalk.red('Task not found.')); process.exit(1); }
    task.status = 'delegated';
    task.delegatedTo = opts.to;
    task.updatedAt = new Date().toISOString();
    await saveTasks(tasks);
    if (opts.json) { console.log(JSON.stringify(task, null, 2)); return; }
    console.log(chalk.cyan(`→ Delegated to ${opts.to}: ${task.content}`));
  });

// ─── NOW / PICK ───
program.command('now').description('The ONE thing to do next')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    const tasks = await loadTasks();
    const config = await loadConfig();
    let open = getOpenTasks(tasks);
    if (config.focus) {
      const f = config.focus.toLowerCase();
      open = open.filter(t =>
        t.content.toLowerCase().includes(f) ||
        (t.campaign && t.campaign.toLowerCase().includes(f)) ||
        t.tags.some(tag => tag.toLowerCase().includes(f))
      );
    }
    const ranked = rankTasks(open);
    if (ranked.length === 0) {
      if (opts.json) { console.log(JSON.stringify(null)); return; }
      console.log(chalk.green('🎉 Nothing to do! Enjoy your freedom.'));
      return;
    }
    const task = ranked[0];
    if (opts.json) { console.log(JSON.stringify(task, null, 2)); return; }
    console.log(chalk.bold('\n  🎯 DO THIS NOW:\n'));
    console.log(`  ${formatTaskFull(task)}`);
    console.log('');
  });

program.command('pick').description('Pick next task (skip if you don\'t like it)')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    const tasks = await loadTasks();
    let open = getOpenTasks(tasks).filter(t => t.status !== 'skipped');
    const ranked = rankTasks(open);
    if (ranked.length === 0) {
      console.log(chalk.green('Nothing to pick!'));
      return;
    }
    const task = ranked[0];
    if (opts.json) { console.log(JSON.stringify(task, null, 2)); return; }
    console.log(`\n  🎯 How about: ${formatTaskLine(task)}`);
    console.log(chalk.gray(`  Don't like it? Run: taskpipe skip ${shortId(task.id)}\n`));
  });

program.command('skip <id>').description('Skip a suggested task')
  .option('--json', 'JSON output')
  .action(async (id, opts) => {
    const tasks = await loadTasks();
    const task = findTask(tasks, id);
    if (!task) { console.error(chalk.red('Task not found.')); process.exit(1); }
    task.status = 'skipped';
    task.updatedAt = new Date().toISOString();
    await saveTasks(tasks);
    // Show next
    let open = getOpenTasks(tasks);
    const ranked = rankTasks(open);
    if (ranked.length > 0) {
      if (opts.json) { console.log(JSON.stringify(ranked[0], null, 2)); return; }
      console.log(`  ⏭ Skipped. Next up: ${formatTaskLine(ranked[0])}`);
    } else {
      console.log(chalk.gray('Nothing left to pick.'));
    }
  });

// ─── QUICK ───
program.command('quick').description('Quick wins under 15 min')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    const tasks = await loadTasks();
    const quick = getOpenTasks(tasks).filter(t => t.estimate && t.estimate <= 15);
    if (opts.json) { console.log(JSON.stringify(quick, null, 2)); return; }
    if (quick.length === 0) { console.log(chalk.gray('No quick wins available.')); return; }
    console.log(chalk.bold('⚡ Quick wins (under 15 min):\n'));
    quick.forEach(t => console.log(`  ${formatTaskLine(t)}`));
  });

// ─── STUCK ───
program.command('stuck').description('Tasks you\'ve been avoiding')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    const config = await loadConfig();
    const staleDays = config.stale?.days || 3;
    const tasks = await loadTasks();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - staleDays);
    const stuck = getOpenTasks(tasks).filter(t =>
      t.status === 'todo' &&
      ['critical', 'high'].includes(t.priority) &&
      new Date(t.createdAt) < cutoff
    );
    if (opts.json) { console.log(JSON.stringify(stuck, null, 2)); return; }
    if (stuck.length === 0) { console.log(chalk.green('Nothing stuck. You\'re on it! 💪')); return; }
    console.log(chalk.red.bold(`\n  😬 ${stuck.length} task${stuck.length > 1 ? 's' : ''} you've been avoiding:\n`));
    stuck.forEach(t => {
      const days = Math.ceil((Date.now() - new Date(t.createdAt).getTime()) / 86400000);
      console.log(`  ${formatTaskLine(t)} ${chalk.red(`(${days}d old)`)}`);
    });
  });

// ─── WINS ───
program.command('wins').description('Completed tasks')
  .option('--week', 'Show weekly wins')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    const tasks = await loadTasks();
    const now = new Date();
    let cutoff: Date;
    if (opts.week) {
      cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - 7);
    } else {
      cutoff = new Date(today());
    }
    const wins = tasks.filter(t =>
      t.status === 'done' && t.completedAt && new Date(t.completedAt) >= cutoff
    );
    if (opts.json) { console.log(JSON.stringify(wins, null, 2)); return; }
    if (wins.length === 0) { console.log(chalk.gray('No wins yet. Go crush something!')); return; }
    const period = opts.week ? 'This week' : 'Today';
    console.log(chalk.green.bold(`\n  🏆 ${period}'s wins (${wins.length}):\n`));
    wins.forEach(t => console.log(`  ● ${chalk.green(t.content)}${t.actual ? chalk.gray(` ${t.actual}m`) : ''}`));
    const totalTime = wins.reduce((sum, t) => sum + (t.actual || 0), 0);
    if (totalTime) console.log(chalk.gray(`\n  Total tracked time: ${totalTime}m`));
  });

// ─── FOCUS / UNFOCUS ───
program.command('focus [query]').description('Set focus filter')
  .action(async (query) => {
    const config = await loadConfig();
    if (!query) {
      if (config.focus) console.log(chalk.cyan(`🔍 Focused on: "${config.focus}"`));
      else console.log(chalk.gray('No focus set.'));
      return;
    }
    config.focus = query;
    await saveConfig(config);
    console.log(chalk.cyan(`🔍 Focused on: "${query}". Run 'taskpipe unfocus' to clear.`));
  });

program.command('unfocus').description('Clear focus filter')
  .action(async () => {
    const config = await loadConfig();
    config.focus = null;
    await saveConfig(config);
    console.log(chalk.green('✓ Focus cleared. Showing everything.'));
  });

// ─── PLAN ───
program.command('plan').description('Plan your session')
  .option('--2h', '2 hour session')
  .option('--1h', '1 hour session')
  .option('--30m', '30 min session')
  .option('--low-energy', 'Low energy mode')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    const tasks = await loadTasks();
    let open = getOpenTasks(tasks);

    if (opts.lowEnergy) open = open.filter(t => t.energy === 'low');

    let timeLimit: number | null = null;
    if (opts['2h']) timeLimit = 120;
    else if (opts['1h']) timeLimit = 60;
    else if (opts['30m']) timeLimit = 30;

    const ranked = rankTasks(open);

    if (timeLimit) {
      const plan: Task[] = [];
      let remaining = timeLimit;
      for (const t of ranked) {
        const est = t.estimate || 30;
        if (est <= remaining) {
          plan.push(t);
          remaining -= est;
        }
      }
      if (opts.json) { console.log(JSON.stringify(plan, null, 2)); return; }
      const totalEst = plan.reduce((s, t) => s + (t.estimate || 30), 0);
      console.log(chalk.bold(`\n  📋 Plan for ${timeLimit}m (${plan.length} tasks, ~${totalEst}m):\n`));
      plan.forEach((t, i) => console.log(`  ${i + 1}. ${formatTaskLine(t)}`));
      if (remaining > 10) console.log(chalk.gray(`\n  Buffer: ${remaining}m remaining`));
    } else {
      if (opts.json) { console.log(JSON.stringify(ranked, null, 2)); return; }
      console.log(chalk.bold('\n  📋 Today\'s plan (by priority):\n'));
      ranked.slice(0, 10).forEach((t, i) => console.log(`  ${i + 1}. ${formatTaskLine(t)}`));
      if (ranked.length > 10) console.log(chalk.gray(`\n  ... and ${ranked.length - 10} more`));
    }
  });

// ─── STAKES ───
program.command('stakes').description('Tasks with stakes')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    const tasks = await loadTasks();
    const staked = getOpenTasks(tasks).filter(t => t.stake);
    const ranked = rankTasks(staked);
    if (opts.json) { console.log(JSON.stringify(ranked, null, 2)); return; }
    if (ranked.length === 0) { console.log(chalk.gray('No stakes on the table.')); return; }

    // Extract € values
    const values = ranked.map(t => {
      const match = t.stake?.match(/€([\d,]+)/);
      return match ? parseInt(match[1].replace(',', '')) : 0;
    });
    const total = values.reduce((a, b) => a + b, 0);

    const overdue = ranked.filter(t => t.due && t.due < today());
    let overdueStr = '';
    if (overdue.length) {
      const oldest = Math.ceil((Date.now() - new Date(overdue[overdue.length - 1].due!).getTime()) / 86400000);
      overdueStr = ` Oldest overdue: ${oldest} days.`;
    }

    console.log(chalk.red.bold(`\n  ⚠️ ${ranked.length} task${ranked.length > 1 ? 's' : ''} at risk.${total ? ` Total value: €${total.toLocaleString()}.` : ''}${overdueStr}\n`));
    ranked.forEach(t => console.log(`  ${formatTaskLine(t)}\n    💬 ${chalk.yellow(t.stake!)}`));
  });

// ─── STREAK ───
program.command('streak').description('Show your streak')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    const config = await loadConfig();
    if (opts.json) { console.log(JSON.stringify(config.streaks)); return; }
    const s = config.streaks;
    console.log(`\n  🔥 Current streak: ${s.current} day${s.current !== 1 ? 's' : ''}`);
    console.log(`  🏆 Best streak: ${s.best} day${s.best !== 1 ? 's' : ''}`);
    if (s.lastCompletionDate) console.log(chalk.gray(`  Last completion: ${s.lastCompletionDate}`));
  });

// ─── MOMENTUM ───
program.command('momentum').description('Your momentum')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    const patterns = await loadPatterns();
    const last7: number[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      last7.push(patterns.dailyCompletions[key] || 0);
    }
    const avg = last7.reduce((a, b) => a + b, 0) / 7;
    const todayCount = last7[0];
    let flow = '🧊 Cold';
    if (avg >= 5) flow = '🔥 On Fire';
    else if (avg >= 3) flow = '💪 Rolling';
    else if (avg >= 1) flow = '🌊 Flowing';

    if (opts.json) { console.log(JSON.stringify({ avg: Math.round(avg * 10) / 10, todayCount, flow, last7 })); return; }
    console.log(`\n  ${flow}`);
    console.log(`  Today: ${todayCount} done | 7-day avg: ${avg.toFixed(1)}/day`);
    console.log(chalk.gray(`  Last 7 days: ${last7.reverse().map(n => n || '·').join(' ')}`));
  });

// ─── COOLDOWN ───
program.command('cooldown').description('Should you take a break?')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    const tasks = await loadTasks();
    const td = today();
    const todayDone = tasks.filter(t => t.status === 'done' && t.completedAt?.startsWith(td) && t.energy === 'high');
    if (opts.json) { console.log(JSON.stringify({ highEnergyDone: todayDone.length, needsBreak: todayDone.length >= 3 })); return; }
    if (todayDone.length >= 3) {
      console.log(chalk.cyan(`\n  ☕ You've done ${todayDone.length} high-energy tasks today. Take a break!`));
      console.log(chalk.gray('  Try: taskpipe quick (for some easy wins) or step away.\n'));
    } else {
      console.log(chalk.green(`  ${todayDone.length}/3 high-energy tasks done. Keep going! 💪`));
    }
  });

// ─── INSIGHTS ───
program.command('insights').description('Learned patterns')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    const patterns = await loadPatterns();
    if (patterns.completions.length < 3) {
      console.log(chalk.gray('Not enough data yet. Complete more tasks with --time and --difficulty.'));
      return;
    }

    const insights: string[] = [];

    // Estimate accuracy by tag
    const withEstimates = patterns.completions.filter(c => c.estimate && c.actual);
    if (withEstimates.length > 0) {
      const ratio = withEstimates.reduce((s, c) => s + (c.actual! / c.estimate!), 0) / withEstimates.length;
      if (ratio > 1.3) insights.push(`📊 You underestimate tasks — actual time is ${(ratio * 100).toFixed(0)}% of estimates`);
      else if (ratio < 0.7) insights.push(`⚡ You overestimate — you finish in ${(ratio * 100).toFixed(0)}% of estimated time`);
      else insights.push(`✅ Your estimates are pretty accurate (${(ratio * 100).toFixed(0)}%)`);
    }

    // Best hours
    const hourCounts: Record<number, number> = {};
    patterns.completions.forEach(c => {
      hourCounts[c.hourOfDay] = (hourCounts[c.hourOfDay] || 0) + 1;
    });
    const bestHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
    if (bestHour) insights.push(`🕐 Most productive hour: ${bestHour[0]}:00 (${bestHour[1]} tasks)`);

    // Best day
    const dayCounts: Record<number, number> = {};
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    patterns.completions.forEach(c => {
      dayCounts[c.dayOfWeek] = (dayCounts[c.dayOfWeek] || 0) + 1;
    });
    const bestDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0];
    if (bestDay) insights.push(`📅 Best day: ${dayNames[parseInt(bestDay[0])]} (${bestDay[1]} tasks)`);

    // Tag patterns
    const tagTimes: Record<string, { total: number; count: number }> = {};
    withEstimates.forEach(c => {
      c.tags.forEach(tag => {
        if (!tagTimes[tag]) tagTimes[tag] = { total: 0, count: 0 };
        tagTimes[tag].total += c.actual! / c.estimate!;
        tagTimes[tag].count += 1;
      });
    });
    Object.entries(tagTimes).forEach(([tag, data]) => {
      const r = data.total / data.count;
      if (data.count >= 2 && r > 1.5) insights.push(`🏷 "${tag}" tasks take ${r.toFixed(1)}x your estimate`);
    });

    if (opts.json) { console.log(JSON.stringify(insights)); return; }
    console.log(chalk.bold('\n  🧠 Insights:\n'));
    insights.forEach(i => console.log(`  ${i}`));
    console.log('');
  });

// ─── REVIEW ───
program.command('review').description('Weekly review')
  .option('--week <date>', 'Week start date (Monday)')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    const tasks = await loadTasks();
    const patterns = await loadPatterns();

    let weekStart: Date;
    if (opts.week) {
      weekStart = new Date(opts.week);
    } else {
      weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Monday
    }
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const done = tasks.filter(t =>
      t.status === 'done' && t.completedAt &&
      new Date(t.completedAt) >= weekStart && new Date(t.completedAt) < weekEnd
    );

    const carried = getOpenTasks(tasks);
    const totalTime = done.reduce((s, t) => s + (t.actual || 0), 0);

    // Best day
    const dailyCounts: Record<string, number> = {};
    done.forEach(t => {
      const d = t.completedAt!.split('T')[0];
      dailyCounts[d] = (dailyCounts[d] || 0) + 1;
    });
    const bestDay = Object.entries(dailyCounts).sort((a, b) => b[1] - a[1])[0];

    // Value moved
    let valueMoved = 0;
    done.forEach(t => {
      const match = t.stake?.match(/€([\d,]+)/);
      if (match) valueMoved += parseInt(match[1].replace(',', ''));
    });

    if (opts.json) {
      console.log(JSON.stringify({ done: done.length, carried: carried.length, totalTime, valueMoved, bestDay: bestDay?.[0] }));
      return;
    }

    const ws = weekStart.toISOString().split('T')[0];
    console.log(chalk.bold(`\n  📊 Week of ${ws}\n`));
    console.log(`  ✅ Completed: ${done.length} tasks`);
    if (totalTime) console.log(`  ⏱ Time tracked: ${totalTime}m`);
    if (valueMoved) console.log(`  💰 Value moved: €${valueMoved.toLocaleString()}`);
    if (bestDay) console.log(`  📅 Best day: ${bestDay[0]} (${bestDay[1]} tasks)`);
    console.log(`  📋 Carried over: ${carried.length} open tasks`);

    // Campaigns
    const campaigns = new Set(done.map(t => t.campaign).filter(Boolean));
    if (campaigns.size) console.log(`  🎯 Active campaigns: ${[...campaigns].join(', ')}`);

    console.log(chalk.gray('\n  Suggested: Review carried-over tasks and re-prioritize.\n'));
  });

// ─── SEARCH ───
program.command('search <query>').description('Search tasks')
  .option('--json', 'JSON output')
  .action(async (query, opts) => {
    const tasks = await loadTasks();
    const q = query.toLowerCase();
    const results = tasks.filter(t =>
      t.content.toLowerCase().includes(q) ||
      t.tags.some(tag => tag.toLowerCase().includes(q)) ||
      (t.campaign && t.campaign.toLowerCase().includes(q)) ||
      t.notes.some(n => n.toLowerCase().includes(q))
    );
    printTasks(results, opts.json);
  });

// ─── STATS ───
program.command('stats').description('Overview statistics')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    const tasks = await loadTasks();
    const open = tasks.filter(t => ['todo', 'doing'].includes(t.status));
    const done = tasks.filter(t => t.status === 'done');
    const blocked = tasks.filter(t => t.status === 'blocked');
    const delegated = tasks.filter(t => t.status === 'delegated');

    const byCampaign: Record<string, number> = {};
    open.forEach(t => { if (t.campaign) byCampaign[t.campaign] = (byCampaign[t.campaign] || 0) + 1; });

    const byEnergy: Record<string, number> = { high: 0, medium: 0, low: 0 };
    open.forEach(t => byEnergy[t.energy] = (byEnergy[t.energy] || 0) + 1);

    if (opts.json) {
      console.log(JSON.stringify({ open: open.length, done: done.length, blocked: blocked.length, delegated: delegated.length, byCampaign, byEnergy }));
      return;
    }

    console.log(chalk.bold('\n  📈 Stats\n'));
    console.log(`  Open: ${open.length} | Done: ${done.length} | Blocked: ${blocked.length} | Delegated: ${delegated.length}`);
    console.log(`  Energy: ⚡${byEnergy.high} 🔋${byEnergy.medium} 🪫${byEnergy.low}`);
    if (Object.keys(byCampaign).length) {
      console.log(chalk.bold('\n  Campaigns:'));
      Object.entries(byCampaign).forEach(([c, n]) => console.log(`    ${chalk.cyan(c)}: ${n} tasks`));
    }
  });

// ─── GHOST TASKS ───
program.command('ghost').description('Auto-suggested tasks')
  .option('--accept <id>', 'Accept a ghost task')
  .option('--dismiss <id>', 'Dismiss a ghost task')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    if (opts.accept) {
      const ghosts = await loadGhosts();
      const ghost = ghosts.find(g => g.id.startsWith(opts.accept));
      if (!ghost) { console.error(chalk.red('Ghost task not found.')); process.exit(1); }
      const tasks = await loadTasks();
      const task: Task = {
        id: uuid(), content: ghost.content, status: 'todo',
        priority: ghost.suggestedPriority as any, energy: ghost.suggestedEnergy as any,
        estimate: null, actual: null, difficulty: null, campaign: null,
        links: {}, tags: [ghost.source], stake: null, due: null,
        delegatedTo: null, completedAt: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        focusGroup: null, recurrence: null, notes: [`Auto-generated: ${ghost.reason}`],
      };
      tasks.push(task);
      await saveTasks(tasks);
      ghost.dismissed = true;
      await saveGhosts(ghosts);
      if (opts.json) { console.log(JSON.stringify(task, null, 2)); return; }
      console.log(chalk.green(`✓ Accepted: ${task.content}`));
      return;
    }

    if (opts.dismiss) {
      const ghosts = await loadGhosts();
      const ghost = ghosts.find(g => g.id.startsWith(opts.dismiss));
      if (!ghost) { console.error(chalk.red('Ghost task not found.')); process.exit(1); }
      ghost.dismissed = true;
      await saveGhosts(ghosts);
      console.log(chalk.gray('Dismissed.'));
      return;
    }

    // Generate ghost tasks
    const ghosts: GhostTask[] = [];

    // Check leadpipe
    try {
      const leadsPath = '.leadpipe/leads.json';
      if (fs.existsSync(leadsPath)) {
        const leads = JSON.parse(fs.readFileSync(leadsPath, 'utf-8'));
        const now = new Date();
        leads.forEach((lead: any) => {
          if (lead.followUps) {
            lead.followUps.forEach((fu: any) => {
              if (fu.date && new Date(fu.date) < now && !fu.done) {
                ghosts.push({
                  id: uuid(), content: `Follow up with ${lead.name || lead.id}`,
                  source: 'leadpipe', reason: `Overdue follow-up since ${fu.date}`,
                  suggestedPriority: 'high', suggestedEnergy: 'medium',
                  createdAt: now.toISOString(), dismissed: false,
                });
              }
            });
          }
        });
      }
    } catch {}

    // Check contentq
    try {
      const cqPath = '.contentq/queue.json';
      if (fs.existsSync(cqPath)) {
        const queue = JSON.parse(fs.readFileSync(cqPath, 'utf-8'));
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        queue.forEach((item: any) => {
          if (item.status === 'draft' && new Date(item.createdAt) < threeDaysAgo) {
            const preview = (item.text || item.content || '').substring(0, 50);
            ghosts.push({
              id: uuid(), content: `Review and publish draft: ${preview}...`,
              source: 'contentq', reason: `Draft older than 3 days`,
              suggestedPriority: 'medium', suggestedEnergy: 'low',
              createdAt: new Date().toISOString(), dismissed: false,
            });
          }
        });

        // Check content gaps
        const scheduled = queue.filter((i: any) => i.scheduledFor);
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
        const dayAfter = new Date(); dayAfter.setDate(dayAfter.getDate() + 2);
        [tomorrow, dayAfter].forEach(d => {
          const ds = d.toISOString().split('T')[0];
          const hasContent = scheduled.some((i: any) => i.scheduledFor?.startsWith(ds));
          if (!hasContent) {
            const dayName = d.toLocaleDateString('en', { weekday: 'long' });
            ghosts.push({
              id: uuid(), content: `Create content for ${dayName} (${ds})`,
              source: 'contentq', reason: 'No content scheduled',
              suggestedPriority: 'medium', suggestedEnergy: 'high',
              createdAt: new Date().toISOString(), dismissed: false,
            });
          }
        });
      }
    } catch {}

    await saveGhosts(ghosts);

    const active = ghosts.filter(g => !g.dismissed);
    if (opts.json) { console.log(JSON.stringify(active, null, 2)); return; }
    if (active.length === 0) { console.log(chalk.gray('No ghost tasks. Your tools are quiet.')); return; }
    console.log(chalk.bold('\n  👻 Ghost tasks (auto-suggested):\n'));
    active.forEach(g => {
      console.log(`  ${shortId(g.id)} ${g.content}`);
      console.log(chalk.gray(`    Source: ${g.source} | ${g.reason}`));
    });
    console.log(chalk.gray('\n  Accept: taskpipe ghost --accept <id>'));
    console.log(chalk.gray('  Dismiss: taskpipe ghost --dismiss <id>\n'));
  });

// ─── BUDDY ───
program.command('buddy').description('Accountability buddy')
  .option('--start', 'Enable')
  .option('--stop', 'Disable')
  .option('--status', 'Show status')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    const config = await loadConfig();
    if (opts.start) {
      config.buddy.enabled = true;
      await saveConfig(config);
      console.log(chalk.green('✓ Buddy mode enabled. Stay accountable! 🤝'));
      return;
    }
    if (opts.stop) {
      config.buddy.enabled = false;
      await saveConfig(config);
      console.log(chalk.gray('Buddy mode disabled.'));
      return;
    }
    // Status
    const tasks = await loadTasks();
    const doing = tasks.find(t => t.status === 'doing');
    if (opts.json) { console.log(JSON.stringify({ enabled: config.buddy.enabled, currentTask: doing || null })); return; }
    console.log(`\n  🤝 Buddy: ${config.buddy.enabled ? chalk.green('ON') : chalk.gray('OFF')}`);
    if (doing) {
      const elapsed = Math.round((Date.now() - new Date(doing.updatedAt).getTime()) / 60000);
      console.log(`  Current: ${doing.content} (${elapsed}m elapsed)`);
    } else {
      console.log(chalk.gray('  No task in progress. Pick one with: taskpipe now'));
    }
  });

// ─── REMIND ───
program.command('remind <id> [time...]').description('Add/remove reminders on a task')
  .option('--remove', 'Clear all reminders')
  .option('--note <text>', 'Custom reminder message')
  .option('--json', 'JSON output')
  .action(async (id, timeArgs, opts) => {
    const tasks = await loadTasks();
    const task = findTask(tasks, id);
    if (!task) { console.error(chalk.red('Task not found.')); process.exit(1); }
    if (!task.reminders) task.reminders = [];

    if (opts.remove) {
      task.reminders = [];
      task.updatedAt = new Date().toISOString();
      await saveTasks(tasks);
      if (opts.json) { console.log(JSON.stringify(task, null, 2)); return; }
      console.log(chalk.green(`✓ Cleared reminders for: ${task.content}`));
      return;
    }

    const timeStr = (timeArgs as string[]).join(' ');
    if (!timeStr) { console.error(chalk.red('Provide a time. E.g.: taskpipe remind <id> "in 2h"')); process.exit(1); }
    const parsed = parseTime(timeStr);
    if (!parsed) { console.error(chalk.red(`Could not parse time: "${timeStr}"`)); process.exit(1); }

    const reminder: Reminder = { id: uuid(), at: parsed, sent: false };
    if (opts.note) reminder.note = opts.note;
    task.reminders.push(reminder);
    task.updatedAt = new Date().toISOString();
    await saveTasks(tasks);

    if (opts.json) { console.log(JSON.stringify(task, null, 2)); return; }
    const when = new Date(parsed);
    console.log(chalk.green(`✓ Reminder set for ${when.toLocaleString()}: ${task.content}`));
    if (opts.note) console.log(chalk.gray(`  Note: ${opts.note}`));
  });

// ─── REMINDERS ───
program.command('reminders').description('List all upcoming reminders')
  .option('--due', 'Show only due (unfired) reminders')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    const tasks = await loadTasks();
    const now = new Date();
    const all: Array<{ task: Task; reminder: Reminder }> = [];

    for (const task of tasks) {
      if (!task.reminders) continue;
      for (const r of task.reminders) {
        if (opts.due) {
          if (!r.sent && new Date(r.at) <= now) all.push({ task, reminder: r });
        } else {
          if (!r.sent) all.push({ task, reminder: r });
        }
      }
    }

    all.sort((a, b) => new Date(a.reminder.at).getTime() - new Date(b.reminder.at).getTime());

    if (opts.json) { console.log(JSON.stringify(all, null, 2)); return; }
    if (all.length === 0) {
      console.log(chalk.gray(opts.due ? 'No due reminders.' : 'No upcoming reminders.'));
      return;
    }

    const label = opts.due ? '🔔 Due reminders' : '⏰ Upcoming reminders';
    console.log(chalk.bold(`\n  ${label}:\n`));
    for (const { task, reminder } of all) {
      const when = new Date(reminder.at);
      const isPast = when <= now;
      const timeStr = isPast ? chalk.red(when.toLocaleString()) : chalk.cyan(when.toLocaleString());
      console.log(`  ${timeStr}  ${formatTaskLine(task)}`);
      if (reminder.note) console.log(chalk.gray(`    💬 ${reminder.note}`));
    }
    console.log('');
  });

// ─── CALENDAR ───
function fetchCalendarEvents(from: string, to: string): any[] {
  try {
    const output = execSync(`gog calendar list --from "${from}" --to "${to}" --json`, {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    try {
      const parsed = JSON.parse(output);
      return Array.isArray(parsed) ? parsed : (parsed.events || parsed.items || []);
    } catch {
      return parseCalendarText(output);
    }
  } catch (e: any) {
    if (e.stdout) {
      try { const p = JSON.parse(e.stdout); return Array.isArray(p) ? p : (p.events || p.items || []); } catch {}
      return parseCalendarText(e.stdout);
    }
    return [];
  }
}

function parseCalendarText(text: string): any[] {
  const events: any[] = [];
  const lines = text.split('\n').filter(l => l.trim());
  for (const line of lines) {
    const match = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2})\s*[-–]\s*(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2})\s+(.*)/);
    if (match) {
      events.push({ start: { dateTime: match[1] }, end: { dateTime: match[2] }, summary: match[3].trim() });
    }
  }
  return events;
}

function getEventTimes(event: any): { start: Date; end: Date; summary: string } {
  const startStr = event.start?.dateTime || event.start?.date || event.Start || '';
  const endStr = event.end?.dateTime || event.end?.date || event.End || '';
  return {
    start: new Date(startStr),
    end: new Date(endStr),
    summary: event.summary || event.Summary || event.title || event.Title || '(no title)',
  };
}

function calculateFreeSlots(events: any[], dayStart: Date, dayEnd: Date): Array<{ start: Date; end: Date; minutes: number }> {
  const sorted = events
    .map(getEventTimes)
    .filter(e => !isNaN(e.start.getTime()) && !isNaN(e.end.getTime()))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const slots: Array<{ start: Date; end: Date; minutes: number }> = [];
  let cursor = dayStart;

  for (const ev of sorted) {
    if (ev.start > cursor) {
      const mins = Math.round((ev.start.getTime() - cursor.getTime()) / 60000);
      if (mins >= 15) slots.push({ start: new Date(cursor), end: new Date(ev.start), minutes: mins });
    }
    if (ev.end > cursor) cursor = new Date(ev.end);
  }

  if (cursor < dayEnd) {
    const mins = Math.round((dayEnd.getTime() - cursor.getTime()) / 60000);
    if (mins >= 15) slots.push({ start: new Date(cursor), end: new Date(dayEnd), minutes: mins });
  }

  return slots;
}

function formatTimeRange(start: Date, end: Date): string {
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${fmt(start)} – ${fmt(end)}`;
}

function formatMinutes(m: number): string {
  if (m >= 60) return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
  return `${m}m`;
}

program.command('calendar').description('Show calendar events and free slots')
  .option('--tomorrow', 'Show tomorrow')
  .option('--week', 'Show this week')
  .option('--json', 'JSON output')
  .action((opts) => {
    const now = new Date();
    let from: string, to: string, label: string;

    if (opts.week) {
      const start = new Date(now);
      const end = new Date(now);
      end.setDate(end.getDate() + 7);
      from = start.toISOString().split('T')[0];
      to = end.toISOString().split('T')[0];
      label = 'This week';
    } else if (opts.tomorrow) {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      from = to = d.toISOString().split('T')[0];
      label = 'Tomorrow';
    } else {
      from = to = today();
      label = 'Today';
    }

    const events = fetchCalendarEvents(from, to);

    if (opts.json) { console.log(JSON.stringify(events, null, 2)); return; }

    if (events.length === 0) {
      console.log(chalk.green(`\n  📅 ${label}: No events — completely free! 🎉\n`));
      return;
    }

    console.log(chalk.bold(`\n  📅 ${label}'s Calendar:\n`));
    const sorted = events.map(getEventTimes).sort((a, b) => a.start.getTime() - b.start.getTime());
    for (const ev of sorted) {
      if (isNaN(ev.start.getTime())) {
        console.log(`  📌 ${ev.summary}`);
      } else {
        console.log(`  ${chalk.cyan(formatTimeRange(ev.start, ev.end))}  ${ev.summary}`);
      }
    }

    if (!opts.week) {
      const targetDate = opts.tomorrow ? new Date(now.getTime() + 86400000) : now;
      const dayStart = new Date(targetDate); dayStart.setHours(8, 0, 0, 0);
      const dayEnd = new Date(targetDate); dayEnd.setHours(18, 0, 0, 0);
      const slots = calculateFreeSlots(events, dayStart, dayEnd);

      if (slots.length > 0) {
        const totalFree = slots.reduce((s, sl) => s + sl.minutes, 0);
        console.log(chalk.bold(`\n  🟢 Free slots (${formatMinutes(totalFree)} total):\n`));
        for (const slot of slots) {
          console.log(`  ${chalk.green(formatTimeRange(slot.start, slot.end))}  ${chalk.gray(`(${formatMinutes(slot.minutes)})`)}`);
        }
      }
    }
    console.log('');
  });

// ─── BRIEFING ───
program.command('briefing').description('Smart daily briefing')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    const tasks = await loadTasks();
    const config = await loadConfig();
    const td = today();
    const now = new Date();

    const events = fetchCalendarEvents(td, td);
    const sortedEvents = events.map(getEventTimes).sort((a, b) => a.start.getTime() - b.start.getTime());

    const dueToday = getOpenTasks(tasks).filter(t => t.due === td);
    const overdue = getOpenTasks(tasks).filter(t => t.due && t.due < td);

    const tomorrow = new Date(now.getTime() + 86400000);
    const upcomingReminders: Array<{ task: Task; reminder: Reminder }> = [];
    for (const task of tasks) {
      if (!task.reminders) continue;
      for (const r of task.reminders) {
        if (!r.sent && new Date(r.at) >= now && new Date(r.at) <= tomorrow) {
          upcomingReminders.push({ task, reminder: r });
        }
      }
    }
    upcomingReminders.sort((a, b) => new Date(a.reminder.at).getTime() - new Date(b.reminder.at).getTime());

    let ghostCount = 0;
    try {
      const ghosts = await loadGhosts();
      ghostCount = ghosts.filter(g => !g.dismissed).length;
    } catch {}

    const ranked = rankTasks(getOpenTasks(tasks)).slice(0, 5);

    if (opts.json) {
      console.log(JSON.stringify({ events: sortedEvents, dueToday, overdue, upcomingReminders, streak: config.streaks, ghostCount, plan: ranked }, null, 2));
      return;
    }

    console.log(chalk.bold.cyan(`\n  ☀️  Good ${now.getHours() < 12 ? 'morning' : now.getHours() < 17 ? 'afternoon' : 'evening'}! Here's your briefing:\n`));

    if (config.streaks.current > 0) {
      console.log(chalk.yellow(`  🔥 Streak: ${config.streaks.current} day${config.streaks.current !== 1 ? 's' : ''} (best: ${config.streaks.best})`));
      console.log('');
    }

    if (sortedEvents.length > 0) {
      console.log(chalk.bold('  📅 Today\'s Calendar:'));
      for (const ev of sortedEvents) {
        if (isNaN(ev.start.getTime())) {
          console.log(`    📌 ${ev.summary}`);
        } else {
          console.log(`    ${chalk.cyan(formatTimeRange(ev.start, ev.end))}  ${ev.summary}`);
        }
      }
      console.log('');
    } else {
      console.log(chalk.green('  📅 No calendar events today — open day!\n'));
    }

    if (overdue.length > 0) {
      console.log(chalk.red.bold(`  ⚠️  Overdue (${overdue.length}):`));
      overdue.forEach(t => console.log(`    ${formatTaskLine(t)}`));
      console.log('');
    }

    if (dueToday.length > 0) {
      console.log(chalk.bold(`  📋 Due Today (${dueToday.length}):`));
      dueToday.forEach(t => console.log(`    ${formatTaskLine(t)}`));
      console.log('');
    }

    if (upcomingReminders.length > 0) {
      console.log(chalk.bold(`  ⏰ Upcoming Reminders:`));
      for (const { task, reminder } of upcomingReminders) {
        const when = new Date(reminder.at);
        console.log(`    ${chalk.cyan(when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}  ${task.content}${reminder.note ? chalk.gray(` — ${reminder.note}`) : ''}`);
      }
      console.log('');
    }

    if (ghostCount > 0) {
      console.log(chalk.gray(`  👻 ${ghostCount} ghost task${ghostCount !== 1 ? 's' : ''} waiting — run: taskpipe ghost\n`));
    }

    if (ranked.length > 0) {
      console.log(chalk.bold('  🎯 Suggested Plan:'));
      ranked.forEach((t, i) => console.log(`    ${i + 1}. ${formatTaskLine(t)}`));
      console.log('');
    }
  });

// ─── ENHANCED PLAN (calendar/morning/afternoon) ───
const existingPlan = program.commands.find(c => c.name() === 'plan');
if (existingPlan) {
  existingPlan
    .option('--calendar', 'Factor in calendar free time')
    .option('--morning', 'Plan morning only (until 12:00)')
    .option('--afternoon', 'Plan afternoon (12:00-18:00)');

  const originalAction = (existingPlan as any)._actionHandler;
  existingPlan.action(async (opts: any) => {
    if (!opts.calendar && !opts.morning && !opts.afternoon) {
      const tasks = await loadTasks();
      let open = getOpenTasks(tasks);
      if (opts.lowEnergy) open = open.filter(t => t.energy === 'low');

      let timeLimit: number | null = null;
      if (opts['2h']) timeLimit = 120;
      else if (opts['1h']) timeLimit = 60;
      else if (opts['30m']) timeLimit = 30;

      const ranked = rankTasks(open);

      if (timeLimit) {
        const plan: Task[] = [];
        let remaining = timeLimit;
        for (const t of ranked) {
          const est = t.estimate || 30;
          if (est <= remaining) { plan.push(t); remaining -= est; }
        }
        if (opts.json) { console.log(JSON.stringify(plan, null, 2)); return; }
        const totalEst = plan.reduce((s, t) => s + (t.estimate || 30), 0);
        console.log(chalk.bold(`\n  📋 Plan for ${timeLimit}m (${plan.length} tasks, ~${totalEst}m):\n`));
        plan.forEach((t, i) => console.log(`  ${i + 1}. ${formatTaskLine(t)}`));
        if (remaining > 10) console.log(chalk.gray(`\n  Buffer: ${remaining}m remaining`));
      } else {
        if (opts.json) { console.log(JSON.stringify(ranked, null, 2)); return; }
        console.log(chalk.bold('\n  📋 Today\'s plan (by priority):\n'));
        ranked.slice(0, 10).forEach((t, i) => console.log(`  ${i + 1}. ${formatTaskLine(t)}`));
        if (ranked.length > 10) console.log(chalk.gray(`\n  ... and ${ranked.length - 10} more`));
      }
      return;
    }

    const tasks = await loadTasks();
    let open = getOpenTasks(tasks);
    if (opts.lowEnergy) open = open.filter(t => t.energy === 'low');
    const ranked = rankTasks(open);

    const td = today();
    const targetDate = new Date();
    let dayStart: Date, dayEnd: Date, label: string;

    if (opts.morning) {
      dayStart = new Date(targetDate); dayStart.setHours(8, 0, 0, 0);
      dayEnd = new Date(targetDate); dayEnd.setHours(12, 0, 0, 0);
      label = 'Morning (8:00–12:00)';
    } else if (opts.afternoon) {
      dayStart = new Date(targetDate); dayStart.setHours(12, 0, 0, 0);
      dayEnd = new Date(targetDate); dayEnd.setHours(18, 0, 0, 0);
      label = 'Afternoon (12:00–18:00)';
    } else {
      dayStart = new Date(targetDate); dayStart.setHours(8, 0, 0, 0);
      dayEnd = new Date(targetDate); dayEnd.setHours(18, 0, 0, 0);
      label = 'Today (8:00–18:00)';
    }

    if (opts.calendar) {
      const events = fetchCalendarEvents(td, td);
      const slots = calculateFreeSlots(events, dayStart, dayEnd);
      const totalFree = slots.reduce((s, sl) => s + sl.minutes, 0);

      const plan: Array<{ task: Task; slot: typeof slots[0] }> = [];
      const usedSlots = slots.map(s => ({ ...s, remaining: s.minutes }));

      for (const task of ranked) {
        const est = task.estimate || 30;
        const slot = usedSlots.find(s => s.remaining >= est);
        if (slot) {
          plan.push({ task, slot });
          slot.remaining -= est;
        }
      }

      if (opts.json) { console.log(JSON.stringify(plan.map(p => p.task), null, 2)); return; }

      console.log(chalk.bold(`\n  📋 Calendar-Aware Plan — ${label}\n`));
      console.log(chalk.cyan(`  You have ${formatMinutes(totalFree)} free across ${slots.length} slot${slots.length !== 1 ? 's' : ''}.\n`));

      for (const slot of slots) {
        const slotTasks = plan.filter(p => p.slot.start === slot.start);
        console.log(`  ${chalk.green(formatTimeRange(slot.start, slot.end))} ${chalk.gray(`(${formatMinutes(slot.minutes)})`)}`);
        if (slotTasks.length > 0) {
          slotTasks.forEach(p => console.log(`    → ${formatTaskLine(p.task)}`));
        } else {
          console.log(chalk.gray('    (no tasks fit this slot)'));
        }
      }

      const fitted = plan.length;
      const unfitted = ranked.length - fitted;
      if (unfitted > 0) console.log(chalk.gray(`\n  ${unfitted} more task${unfitted !== 1 ? 's' : ''} don't fit in today's free time.`));
      console.log('');
    } else {
      const totalMin = Math.round((dayEnd.getTime() - dayStart.getTime()) / 60000);
      const plan: Task[] = [];
      let remaining = totalMin;
      for (const t of ranked) {
        const est = t.estimate || 30;
        if (est <= remaining) { plan.push(t); remaining -= est; }
      }

      if (opts.json) { console.log(JSON.stringify(plan, null, 2)); return; }
      const totalEst = plan.reduce((s, t) => s + (t.estimate || 30), 0);
      console.log(chalk.bold(`\n  📋 Plan — ${label} (${plan.length} tasks, ~${totalEst}m):\n`));
      plan.forEach((t, i) => console.log(`  ${i + 1}. ${formatTaskLine(t)}`));
      if (remaining > 10) console.log(chalk.gray(`\n  Buffer: ${remaining}m remaining`));
      console.log('');
    }
  });
}

// ─── SETUP ───
program.command('setup').description('Interactive setup wizard')
  .option('--status', 'Show current setup')
  .option('--reset', 'Reset to defaults')
  .action(async (opts) => {
    if (opts.status) { showSetupStatus(); return; }
    if (opts.reset) { resetSetup(); return; }
    await runSetup();
  });

// ─── NOTIFY ───
program.command('notify').description('Send notification via configured channel')
  .option('--title <title>', 'Notification title', 'taskpipe')
  .action(async (opts) => {
    await runNotify(opts.title);
  });

// ─── ACTIVITY ───
const activityCmd = program.command('activity').description('Activity tracking and adaptive timing');

activityCmd.command('log').description('Log an external activity event')
  .requiredOption('--source <source>', 'Event source (whatsapp, agent, etc.)')
  .requiredOption('--type <type>', 'Event type (message, checkin, etc.)')
  .option('--at <timestamp>', 'Event timestamp (ISO format)')
  .option('--json', 'JSON output')
  .action((opts) => {
    logActivity(opts.source, opts.type, opts.at);
    if (opts.json) {
      console.log(JSON.stringify({ logged: true, source: opts.source, type: opts.type }));
      return;
    }
    console.log(chalk.green(`✓ Logged ${opts.type} from ${opts.source}`));
  });

activityCmd.command('status').description('Show activity profile')
  .option('--json', 'JSON output')
  .action((opts) => {
    const { data, profile, schedule } = getActivityStatus();

    if (opts.json) {
      console.log(JSON.stringify({ profile, schedule }, null, 2));
      return;
    }

    if (!profile || profile.dataPoints === 0) {
      console.log(chalk.gray('\n  No activity data yet. Use taskpipe commands to build your profile.\n'));
      return;
    }

    const pct = Math.round(profile.confidence * 100);
    console.log(chalk.bold(`\n  📊 Activity Profile (${profile.dataPoints} days of data, ${pct}% confidence)\n`));

    console.log(chalk.bold('  Weekdays:'));
    console.log(`    Usually active: ${formatTime12h(profile.weekday.avgFirstActive)} — ${formatTime12h(profile.weekday.avgLastActive)}`);

    console.log(chalk.bold('\n  Weekends:'));
    console.log(`    Usually active: ${formatTime12h(profile.weekend.avgFirstActive)} — ${formatTime12h(profile.weekend.avgLastActive)}`);

    console.log(chalk.bold('\n  Suggested check-in times:'));
    console.log(`    ☀️  Morning briefing: ${formatTime12h(schedule.morning)}`);
    console.log(`    🔥 Midday pulse: ${formatTime12h(schedule.midday)}`);
    console.log(`    🏁 End of day: ${formatTime12h(schedule.evening)}`);

    try {
      const setupYaml = fs.readFileSync('.taskpipe/config.yaml', 'utf-8');
      const setupRaw = require('js-yaml').load(setupYaml) as any;
      if (setupRaw?.schedule?.checkins) {
        const ci = setupRaw.schedule.checkins;
        console.log(chalk.bold('\n  Current schedule vs suggested:'));
        if (ci.morning?.time) console.log(`    Morning: ${ci.morning.time} → suggest ${schedule.morning}`);
        if (ci.midday?.time) console.log(`    Midday: ${ci.midday.time} → suggest ${schedule.midday}`);
        if (ci.evening?.time) console.log(`    Evening: ${ci.evening.time} → suggest ${schedule.evening}`);
      }
    } catch {}

    console.log('');
  });

activityCmd.command('apply').description('Apply learned schedule to config')
  .option('--yes', 'Skip confirmation')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    const { profile, schedule } = getActivityStatus();

    if (!profile || profile.confidence < 0.3) {
      console.log(chalk.yellow('  Not enough data yet. Need at least 5 days of activity.'));
      return;
    }

    if (!opts.yes) {
      console.log(chalk.bold('\n  Suggested schedule update:\n'));
      console.log(`    ☀️  Morning: ${formatTime12h(schedule.morning)}`);
      console.log(`    🔥 Midday: ${formatTime12h(schedule.midday)}`);
      console.log(`    🏁 Evening: ${formatTime12h(schedule.evening)}`);
      console.log('');

      const { confirm } = require('./prompt');
      const ok = await confirm('  Update check-in times based on your activity?', true);
      if (!ok) {
        console.log(chalk.gray('  Cancelled.'));
        return;
      }
    }

    try {
      const configPath = '.taskpipe/config.yaml';
      const raw = require('js-yaml').load(fs.readFileSync(configPath, 'utf-8')) as any || {};
      if (!raw.schedule) raw.schedule = {};
      if (!raw.schedule.checkins) raw.schedule.checkins = {};
      if (raw.schedule.checkins.morning) raw.schedule.checkins.morning.time = schedule.morning;
      if (raw.schedule.checkins.midday) raw.schedule.checkins.midday.time = schedule.midday;
      if (raw.schedule.checkins.evening) raw.schedule.checkins.evening.time = schedule.evening;
      fs.writeFileSync(configPath, require('js-yaml').dump(raw, { lineWidth: -1 }));

      if (opts.json) {
        console.log(JSON.stringify({ applied: true, schedule }));
        return;
      }
      console.log(chalk.green('  ✓ Schedule updated!'));

      try {
        const existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' });
        if (existing.includes('# taskpipe')) {
          console.log(chalk.cyan('  ℹ  Cron jobs detected — run `taskpipe setup` to update crontab times.'));
        }
      } catch {}
    } catch (err: any) {
      console.error(chalk.red(`  ✗ Failed to update config: ${err.message}`));
    }
  });

activityCmd.command('reset').description('Clear all activity data')
  .option('--json', 'JSON output')
  .action((opts) => {
    resetActivity();
    if (opts.json) {
      console.log(JSON.stringify({ reset: true }));
      return;
    }
    console.log(chalk.green('  ✓ Activity data cleared.'));
  });

program.parse();
