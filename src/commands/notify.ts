import chalk from 'chalk';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { execSync } from 'child_process';

const SETUP_CONFIG_FILE = path.join('.taskpipe', 'config.yaml');

interface NotifyConfig {
  notifications: {
    channel: string;
    slack?: { webhookUrl: string };
    discord?: { webhookUrl: string };
    email?: { smtp: string; to: string };
    webhook?: { url: string; method: string };
    terminal?: { sound: boolean };
  };
}

function loadNotifyConfig(): NotifyConfig | null {
  try {
    const raw = yaml.load(fs.readFileSync(SETUP_CONFIG_FILE, 'utf-8')) as any;
    if (raw && raw.notifications) return raw as NotifyConfig;
    return null;
  } catch {
    return null;
  }
}

function postJson(urlStr: string, body: object): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const data = JSON.stringify(body);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
  });
}

export async function runNotify(title: string = 'taskpipe'): Promise<void> {
  const config = loadNotifyConfig();
  if (!config) {
    console.error(chalk.red('No notification config. Run: taskpipe setup'));
    process.exit(1);
  }

  const body = await readStdin();
  if (!body) {
    console.error(chalk.red('No input. Pipe something in: taskpipe briefing | taskpipe notify'));
    process.exit(1);
  }

  // Strip ANSI codes for notification channels
  const clean = body.replace(/\x1b\[[0-9;]*m/g, '');

  const channel = config.notifications.channel;

  try {
    switch (channel) {
      case 'terminal':
        sendTerminal(title, clean, config.notifications.terminal?.sound ?? true);
        break;
      case 'slack':
        if (!config.notifications.slack?.webhookUrl) throw new Error('Slack webhook URL not configured');
        await postJson(config.notifications.slack.webhookUrl, { text: `*${title}*\n${clean}` });
        break;
      case 'discord':
        if (!config.notifications.discord?.webhookUrl) throw new Error('Discord webhook URL not configured');
        await postJson(config.notifications.discord.webhookUrl, { content: `**${title}**\n${clean}` });
        break;
      case 'email':
        sendEmail(title, clean, config.notifications.email!);
        break;
      case 'webhook':
        if (!config.notifications.webhook?.url) throw new Error('Webhook URL not configured');
        await postJson(config.notifications.webhook.url, { title, body: clean });
        break;
      case 'none':
        // Just print to stdout
        console.log(body);
        break;
      default:
        console.log(body);
    }
    if (channel !== 'none') {
      console.log(chalk.green(`✓ Notification sent via ${channel}`));
    }
  } catch (err: any) {
    console.error(chalk.red(`✗ Failed to send notification: ${err.message}`));
    // Fallback: print to stdout
    console.log(body);
  }
}

function sendTerminal(title: string, body: string, sound: boolean): void {
  const platform = process.platform;
  // Truncate for notification
  const short = body.length > 200 ? body.substring(0, 197) + '...' : body;
  const escaped = short.replace(/"/g, '\\"').replace(/\n/g, ' ');

  if (platform === 'darwin') {
    const soundPart = sound ? ' sound name "default"' : '';
    try {
      execSync(`osascript -e 'display notification "${escaped}" with title "${title}"${soundPart}'`);
    } catch {}
  } else {
    try {
      execSync(`notify-send "${title}" "${escaped}"`);
    } catch {}
  }
}

function sendEmail(title: string, body: string, config: { smtp: string; to: string }): void {
  try {
    // Try sendmail/mail
    execSync(`echo "${body.replace(/"/g, '\\"')}" | mail -s "${title}" "${config.to}"`, {
      encoding: 'utf-8',
      timeout: 10000,
    });
  } catch {
    console.error(chalk.yellow('  Email sending requires mail/sendmail. Install or use another channel.'));
  }
}
