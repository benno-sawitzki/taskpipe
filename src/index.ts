#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { v4 as uuid } from 'uuid';
import * as fs from 'fs';
import { Task, GhostTask } from './types';
import {
  initStore, loadTasks, saveTasks, loadConfig, saveConfig,
  loadPatterns, savePatterns, loadGhosts, saveGhosts,
  findTask, today, parseDate, isInitialized,
} from './utils/store';
import { formatTaskLine, formatTaskFull, printTasks, shortId } from './utils/display';
import { rankTasks, getOpenTasks, scoreTask } from './utils/scoring';

const program = new Command();
program.name('taskpipe').description('Marketing task engine for the terminal').version('0.1.0');

// ─── INIT ───
program.command('init').description('Initialize taskpipe').action(() => {
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
  .action((content, opts) => {
    const tasks = loadTasks();
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
    saveTasks(tasks);
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
  .action((opts) => {
    let tasks = loadTasks();
    const config = loadConfig();

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
  .action((id, opts) => {
    const tasks = loadTasks();
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
  .action((id, opts) => {
    const tasks = loadTasks();
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
    saveTasks(tasks);
    if (opts.json) { console.log(JSON.stringify(task, null, 2)); return; }
    console.log(chalk.green(`✓ Updated: ${formatTaskLine(task)}`));
  });

// ─── DELETE ───
program.command('delete <id>').description('Delete a task')
  .option('--json', 'JSON output')
  .action((id, opts) => {
    let tasks = loadTasks();
    const task = findTask(tasks, id);
    if (!task) { console.error(chalk.red('Task not found.')); process.exit(1); }
    tasks = tasks.filter(t => t.id !== task.id);
    saveTasks(tasks);
    if (opts.json) { console.log(JSON.stringify({ deleted: task.id })); return; }
    console.log(chalk.green(`✓ Deleted: ${task.content}`));
  });

// ─── DONE ───
program.command('done <id>').description('Complete a task')
  .option('--time <min>', 'Actual time spent')
  .option('--difficulty <level>', 'easy/medium/hard')
  .option('--json', 'JSON output')
  .action((id, opts) => {
    const tasks = loadTasks();
    const task = findTask(tasks, id);
    if (!task) { console.error(chalk.red('Task not found.')); process.exit(1); }
    task.status = 'done';
    task.completedAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();
    if (opts.time) task.actual = parseInt(opts.time);
    if (opts.difficulty) task.difficulty = opts.difficulty;
    saveTasks(tasks);

    // Update patterns
    const patterns = loadPatterns();
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
    savePatterns(patterns);

    // Update streaks
    const config = loadConfig();
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
      saveConfig(config);
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
  .action((id, reason, opts) => {
    const tasks = loadTasks();
    const task = findTask(tasks, id);
    if (!task) { console.error(chalk.red('Task not found.')); process.exit(1); }
    task.status = 'blocked';
    task.blockedReason = reason || 'No reason given';
    task.updatedAt = new Date().toISOString();
    saveTasks(tasks);
    if (opts.json) { console.log(JSON.stringify(task, null, 2)); return; }
    console.log(chalk.yellow(`🚫 Blocked: ${task.content} — ${task.blockedReason}`));
  });

program.command('unblock <id>').description('Unblock a task')
  .option('--json', 'JSON output')
  .action((id, opts) => {
    const tasks = loadTasks();
    const task = findTask(tasks, id);
    if (!task) { console.error(chalk.red('Task not found.')); process.exit(1); }
    task.status = 'todo';
    task.blockedReason = undefined;
    task.updatedAt = new Date().toISOString();
    saveTasks(tasks);
    if (opts.json) { console.log(JSON.stringify(task, null, 2)); return; }
    console.log(chalk.green(`✓ Unblocked: ${task.content}`));
  });

// ─── DELEGATE ───
program.command('delegate <id>').description('Delegate a task')
  .requiredOption('--to <person>', 'Delegate to')
  .option('--json', 'JSON output')
  .action((id, opts) => {
    const tasks = loadTasks();
    const task = findTask(tasks, id);
    if (!task) { console.error(chalk.red('Task not found.')); process.exit(1); }
    task.status = 'delegated';
    task.delegatedTo = opts.to;
    task.updatedAt = new Date().toISOString();
    saveTasks(tasks);
    if (opts.json) { console.log(JSON.stringify(task, null, 2)); return; }
    console.log(chalk.cyan(`→ Delegated to ${opts.to}: ${task.content}`));
  });

// ─── NOW / PICK ───
program.command('now').description('The ONE thing to do next')
  .option('--json', 'JSON output')
  .action((opts) => {
    const tasks = loadTasks();
    const config = loadConfig();
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
  .action((opts) => {
    const tasks = loadTasks();
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
  .action((id, opts) => {
    const tasks = loadTasks();
    const task = findTask(tasks, id);
    if (!task) { console.error(chalk.red('Task not found.')); process.exit(1); }
    task.status = 'skipped';
    task.updatedAt = new Date().toISOString();
    saveTasks(tasks);
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
  .action((opts) => {
    const tasks = loadTasks();
    const quick = getOpenTasks(tasks).filter(t => t.estimate && t.estimate <= 15);
    if (opts.json) { console.log(JSON.stringify(quick, null, 2)); return; }
    if (quick.length === 0) { console.log(chalk.gray('No quick wins available.')); return; }
    console.log(chalk.bold('⚡ Quick wins (under 15 min):\n'));
    quick.forEach(t => console.log(`  ${formatTaskLine(t)}`));
  });

// ─── STUCK ───
program.command('stuck').description('Tasks you\'ve been avoiding')
  .option('--json', 'JSON output')
  .action((opts) => {
    const config = loadConfig();
    const staleDays = config.stale?.days || 3;
    const tasks = loadTasks();
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
  .action((opts) => {
    const tasks = loadTasks();
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
  .action((query) => {
    const config = loadConfig();
    if (!query) {
      if (config.focus) console.log(chalk.cyan(`🔍 Focused on: "${config.focus}"`));
      else console.log(chalk.gray('No focus set.'));
      return;
    }
    config.focus = query;
    saveConfig(config);
    console.log(chalk.cyan(`🔍 Focused on: "${query}". Run 'taskpipe unfocus' to clear.`));
  });

program.command('unfocus').description('Clear focus filter')
  .action(() => {
    const config = loadConfig();
    config.focus = null;
    saveConfig(config);
    console.log(chalk.green('✓ Focus cleared. Showing everything.'));
  });

// ─── PLAN ───
program.command('plan').description('Plan your session')
  .option('--2h', '2 hour session')
  .option('--1h', '1 hour session')
  .option('--30m', '30 min session')
  .option('--low-energy', 'Low energy mode')
  .option('--json', 'JSON output')
  .action((opts) => {
    const tasks = loadTasks();
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
  .action((opts) => {
    const tasks = loadTasks();
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
  .action((opts) => {
    const config = loadConfig();
    if (opts.json) { console.log(JSON.stringify(config.streaks)); return; }
    const s = config.streaks;
    console.log(`\n  🔥 Current streak: ${s.current} day${s.current !== 1 ? 's' : ''}`);
    console.log(`  🏆 Best streak: ${s.best} day${s.best !== 1 ? 's' : ''}`);
    if (s.lastCompletionDate) console.log(chalk.gray(`  Last completion: ${s.lastCompletionDate}`));
  });

// ─── MOMENTUM ───
program.command('momentum').description('Your momentum')
  .option('--json', 'JSON output')
  .action((opts) => {
    const patterns = loadPatterns();
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
  .action((opts) => {
    const tasks = loadTasks();
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
  .action((opts) => {
    const patterns = loadPatterns();
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
  .action((opts) => {
    const tasks = loadTasks();
    const patterns = loadPatterns();

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
  .action((query, opts) => {
    const tasks = loadTasks();
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
  .action((opts) => {
    const tasks = loadTasks();
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
  .action((opts) => {
    if (opts.accept) {
      const ghosts = loadGhosts();
      const ghost = ghosts.find(g => g.id.startsWith(opts.accept));
      if (!ghost) { console.error(chalk.red('Ghost task not found.')); process.exit(1); }
      const tasks = loadTasks();
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
      saveTasks(tasks);
      ghost.dismissed = true;
      saveGhosts(ghosts);
      if (opts.json) { console.log(JSON.stringify(task, null, 2)); return; }
      console.log(chalk.green(`✓ Accepted: ${task.content}`));
      return;
    }

    if (opts.dismiss) {
      const ghosts = loadGhosts();
      const ghost = ghosts.find(g => g.id.startsWith(opts.dismiss));
      if (!ghost) { console.error(chalk.red('Ghost task not found.')); process.exit(1); }
      ghost.dismissed = true;
      saveGhosts(ghosts);
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

    saveGhosts(ghosts);

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
  .action((opts) => {
    const config = loadConfig();
    if (opts.start) {
      config.buddy.enabled = true;
      saveConfig(config);
      console.log(chalk.green('✓ Buddy mode enabled. Stay accountable! 🤝'));
      return;
    }
    if (opts.stop) {
      config.buddy.enabled = false;
      saveConfig(config);
      console.log(chalk.gray('Buddy mode disabled.'));
      return;
    }
    // Status
    const tasks = loadTasks();
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

program.parse();
