import { Task } from '../types';

const priorityScore: Record<string, number> = { critical: 100, high: 70, medium: 40, low: 10 };
const energyScore: Record<string, number> = { high: 3, medium: 2, low: 1 };

export function scoreTask(task: Task): number {
  let score = priorityScore[task.priority] || 0;

  // Due date urgency
  if (task.due) {
    const days = Math.ceil((new Date(task.due).getTime() - Date.now()) / 86400000);
    if (days < 0) score += 80; // overdue
    else if (days === 0) score += 60;
    else if (days === 1) score += 40;
    else if (days <= 3) score += 20;
  }

  // Stakes boost
  if (task.stake) score += 30;

  // Energy match (boost current energy level tasks)
  const hour = new Date().getHours();
  const currentEnergy = hour < 12 ? 'high' : hour < 17 ? 'medium' : 'low';
  if (task.energy === currentEnergy) score += 15;

  return score;
}

export function rankTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => scoreTask(b) - scoreTask(a));
}

export function getOpenTasks(tasks: Task[]): Task[] {
  return tasks.filter(t => t.status === 'todo' || t.status === 'doing');
}
