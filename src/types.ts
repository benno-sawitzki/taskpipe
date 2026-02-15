export interface Task {
  id: string;
  content: string;
  status: 'todo' | 'doing' | 'done' | 'blocked' | 'delegated' | 'skipped';
  priority: 'critical' | 'high' | 'medium' | 'low';
  energy: 'high' | 'medium' | 'low';
  estimate: number | null;
  actual: number | null;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  campaign: string | null;
  links: Record<string, string | null>;
  tags: string[];
  stake: string | null;
  due: string | null;
  delegatedTo: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  focusGroup: string | null;
  recurrence: string | null;
  notes: string[];
  blockedReason?: string;
  reminders?: Reminder[];
}

export interface Reminder {
  id: string;
  at: string;
  sent: boolean;
  note?: string;
}

export interface Config {
  focus: string | null;
  energy: {
    schedule: {
      morning: string;
      afternoon: string;
      evening: string;
    };
  };
  streaks: {
    current: number;
    best: number;
    lastCompletionDate: string | null;
  };
  stale: {
    days: number;
  };
  buddy: {
    enabled: boolean;
    intervalMinutes: number;
  };
  campaigns: Array<{ name: string; goal: string }>;
}

export interface Patterns {
  completions: Array<{
    date: string;
    taskId: string;
    estimate: number | null;
    actual: number | null;
    energy: string;
    difficulty: string | null;
    tags: string[];
    dayOfWeek: number;
    hourOfDay: number;
  }>;
  dailyCompletions: Record<string, number>;
}

export interface GhostTask {
  id: string;
  content: string;
  source: string;
  reason: string;
  suggestedPriority: string;
  suggestedEnergy: string;
  createdAt: string;
  dismissed: boolean;
}
