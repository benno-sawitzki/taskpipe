import chalk from 'chalk';
import { Task } from '../types';

const priorityColor: Record<string, (s: string) => string> = {
  critical: chalk.red.bold,
  high: chalk.yellow,
  medium: chalk.white,
  low: chalk.gray,
};

const energyIcon: Record<string, string> = {
  high: '⚡',
  medium: '🔋',
  low: '🪫',
};

const statusIcon: Record<string, string> = {
  todo: '○',
  doing: '◐',
  done: '●',
  blocked: '🚫',
  delegated: '→',
  skipped: '⏭',
};

export function shortId(id: string): string {
  return id.substring(0, 8);
}

export function formatTaskLine(task: Task): string {
  const color = priorityColor[task.priority] || chalk.white;
  const icon = statusIcon[task.status] || '?';
  const eIcon = energyIcon[task.energy] || '';
  const dueStr = task.due ? ` 📅 ${task.due}` : '';
  const campStr = task.campaign ? chalk.cyan(` [${task.campaign}]`) : '';
  const stakeStr = task.stake ? chalk.red(` 💰`) : '';
  const estStr = task.estimate ? chalk.gray(` ~${task.estimate}m`) : '';
  const tagStr = task.tags.length ? chalk.gray(` #${task.tags.join(' #')}`) : '';

  return `${icon} ${color(shortId(task.id))} ${color(task.content)}${eIcon}${estStr}${dueStr}${campStr}${stakeStr}${tagStr}`;
}

export function formatTaskFull(task: Task): string {
  const lines = [
    chalk.bold(`${statusIcon[task.status]} ${task.content}`),
    '',
    `  ID:       ${task.id}`,
    `  Status:   ${task.status}`,
    `  Priority: ${task.priority}`,
    `  Energy:   ${task.energy} ${energyIcon[task.energy] || ''}`,
  ];
  if (task.estimate) lines.push(`  Estimate: ${task.estimate}m`);
  if (task.actual) lines.push(`  Actual:   ${task.actual}m`);
  if (task.difficulty) lines.push(`  Difficulty: ${task.difficulty}`);
  if (task.campaign) lines.push(`  Campaign: ${task.campaign}`);
  if (task.due) lines.push(`  Due:      ${task.due}`);
  if (task.stake) lines.push(`  Stake:    ${task.stake}`);
  if (task.delegatedTo) lines.push(`  Delegated: ${task.delegatedTo}`);
  if (task.blockedReason) lines.push(`  Blocked:  ${task.blockedReason}`);
  if (task.tags.length) lines.push(`  Tags:     ${task.tags.join(', ')}`);
  if (Object.keys(task.links).length) {
    const linkStr = Object.entries(task.links).filter(([,v]) => v).map(([k,v]) => `${k}:${v}`).join(', ');
    if (linkStr) lines.push(`  Links:    ${linkStr}`);
    // Show linked file contents
    for (const [key, val] of Object.entries(task.links)) {
      if (!val) continue;
      try {
        const fs = require('fs');
        const path = require('path');
        // Try relative to cwd, then absolute
        const candidates = [path.resolve(process.cwd(), val), val];
        for (const fp of candidates) {
          if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
            const content = fs.readFileSync(fp, 'utf-8');
            lines.push('');
            lines.push(chalk.cyan(`  ── ${key} (${val}) ──`));
            content.split('\n').forEach((l: string) => lines.push(`  ${l}`));
            lines.push(chalk.cyan(`  ── end ──`));
            break;
          }
        }
      } catch { /* skip unreadable */ }
    }
  }
  if (task.notes.length) {
    lines.push(`  Notes:`);
    task.notes.forEach(n => lines.push(`    - ${n}`));
  }
  lines.push(`  Created:  ${task.createdAt}`);
  lines.push(`  Updated:  ${task.updatedAt}`);
  if (task.completedAt) lines.push(`  Completed: ${task.completedAt}`);
  return lines.join('\n');
}

export function printTasks(tasks: Task[], jsonFlag: boolean): void {
  if (jsonFlag) {
    console.log(JSON.stringify(tasks, null, 2));
    return;
  }
  if (tasks.length === 0) {
    console.log(chalk.gray('No tasks found.'));
    return;
  }
  tasks.forEach(t => console.log(formatTaskLine(t)));
}
