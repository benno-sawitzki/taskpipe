import * as readline from 'readline';

function createRl(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

export async function ask(question: string): Promise<string> {
  const rl = createRl();
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function choose(question: string, options: string[]): Promise<number> {
  console.log(question);
  options.forEach((opt, i) => console.log(`  [${i + 1}] ${opt}`));
  const answer = await ask('  → ');
  const idx = parseInt(answer) - 1;
  if (idx >= 0 && idx < options.length) return idx;
  return 0;
}

export async function confirm(question: string, defaultVal: boolean = true): Promise<boolean> {
  const hint = defaultVal ? 'Y/n' : 'y/N';
  const answer = await ask(`${question} (${hint}) `);
  if (!answer) return defaultVal;
  return answer.toLowerCase().startsWith('y');
}

export async function multiSelect(
  question: string,
  options: { label: string; default: boolean }[]
): Promise<boolean[]> {
  console.log(question);
  const results = options.map(o => o.default);
  options.forEach((opt, i) => {
    const check = results[i] ? 'x' : ' ';
    console.log(`  [${check}] ${i + 1}. ${opt.label}`);
  });
  const answer = await ask('  Toggle (comma-separated numbers, or Enter to keep): ');
  if (answer) {
    answer.split(',').forEach(s => {
      const idx = parseInt(s.trim()) - 1;
      if (idx >= 0 && idx < results.length) results[idx] = !results[idx];
    });
  }
  return results;
}
